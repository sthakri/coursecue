import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), send: vi.fn(), generate: vi.fn(), env: { NUDGE_ENABLED: "true" } }));
vi.mock("@trigger.dev/sdk", () => ({ queue: (value: unknown) => value, schedules: { task: (value: unknown) => value } }));
vi.mock("@trigger.dev/sdk/v3", () => ({ queue: (value: unknown) => value, schedules: { task: (value: unknown) => value } }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ from: mocks.from }) }));
vi.mock("@/lib/env", () => ({ env: mocks.env }));
vi.mock("@/lib/webpush", () => ({ sendPushNotification: mocks.send }));
vi.mock("@/lib/nim", () => ({ generateProductiveWindowNudge: mocks.generate }));

import { nudgeEngine } from "@/trigger/nudge-engine";
import { notifyTokenExpired } from "@/trigger/canvas-sync";

const NOW = "2026-10-03T12:00:00.000Z";
const profile = { id: "user", timezone: "UTC", quiet_hours_start: null, quiet_hours_end: null, nudge_paused_until: null, nudge_frequency: "normal" };
const assignment = { id: "assignment", title: "Homework", due_at: "2026-10-03T13:00:00.000Z" };
type Scenario = { missingProfile?: boolean; profileError?: boolean; historyError?: boolean; claimError?: boolean; claimLost?: boolean; paused?: boolean; productive?: boolean; quiet?: boolean; overdue?: boolean };
const device = { user_id: "user", endpoint: "https://fcm.googleapis.com/device", p256dh: "key", auth: "auth" };

// Exercise the actual scheduled run, mocking only integration boundaries. Queries
// retain operation/filter state so failed reads differ from successful empty reads.
function arrange(scenario: Scenario = {}, subscriptions = [{ ...device }]) {
  mocks.from.mockImplementation((table: string) => {
    let operation = "read";
    let throwing = false;
    let overdue = false;
    let single = false;
    const filters: Array<[string, unknown]> = [];
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "is", "gt", "gte", "lte", "order", "limit", "range"]) {
      builder[method] = () => builder;
    }
    builder.eq = (key: string, value: unknown) => { filters.push([key, value]); return builder; };
    builder.lt = (column: string) => { if (column === "due_at") overdue = true; return builder; };
    builder.throwOnError = () => { throwing = true; return builder; };
    builder.single = () => { single = true; return builder; };
    for (const method of ["insert", "upsert", "delete"]) builder[method] = () => { operation = method; return builder; };
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
      let data: unknown[] = [];
      let error: Error | null = null;
      if (table === "profiles") {
        data = scenario.missingProfile ? [] : [{ ...profile, quiet_hours_start: scenario.quiet ? 11 : null, quiet_hours_end: scenario.quiet ? 13 : null, nudge_paused_until: scenario.paused ? "2026-10-04T12:00:00Z" : null }];
        if (scenario.profileError) error = new Error("Preference read failed");
      }
      if (table === "push_subscriptions") {
        if (operation === "delete") {
          const remaining = subscriptions.filter(row => !filters.every(([key, value]) => row[key as keyof typeof row] === value));
          subscriptions.splice(0, subscriptions.length, ...remaining);
        }
        data = [...subscriptions];
      }
      if (table === "productive_windows" && scenario.productive) data = [{ user_id: "user", day_of_week: 6, hour_of_day: 12, score: 0.1, updated_at: NOW }];
      if (table === "assignments" && !overdue && !scenario.overdue) data = [assignment];
      if (table === "assignments" && overdue && scenario.overdue) data = [{ ...assignment, due_at: "2026-10-03T11:00:00.000Z" }];
      if (table === "nudge_logs" && operation === "read" && scenario.historyError) error = new Error("History read failed");
      if (table === "nudge_logs" && operation === "upsert") {
        data = scenario.claimLost ? [] : [{ assignment_id: assignment.id }];
        if (scenario.claimError) error = new Error("Claim write failed");
      }
      return (error && throwing ? Promise.reject(error) : Promise.resolve({ data: error ? null : single ? data[0] ?? null : data, error })).then(resolve, reject);
    };
    return builder;
  });
}

const run = () => (nudgeEngine as unknown as { run: () => Promise<unknown> }).run();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  mocks.env.NUDGE_ENABLED = "true";
  mocks.send.mockResolvedValue(undefined);
  mocks.generate.mockResolvedValue("Study time");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Canvas token expiry notification safety", () => {
  const notify = () => notifyTokenExpired({ from: mocks.from } as unknown as Parameters<typeof notifyTokenExpired>[0], "user");

  it("does not read preferences or send when notifications are globally disabled", async () => {
    arrange();
    mocks.env.NUDGE_ENABLED = "false";
    await notify();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each([{ paused: true }, { quiet: true }, { missingProfile: true }])("respects unavailable/disabled preferences: %j", async scenario => {
    arrange(scenario);
    await notify();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalledWith("nudge_logs");
  });

  it.each([{ profileError: true }, { historyError: true }])("fails closed on a database read error: %j", async scenario => {
    arrange(scenario);
    await expect(notify()).rejects.toThrow();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("sends when preferences permit and no recent notification exists", async () => {
    arrange();
    await notify();
    expect(mocks.send).toHaveBeenCalledOnce();
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("scheduled nudge safety", () => {
  it("fails the run before sending when preferences cannot be loaded", async () => {
    arrange({ profileError: true });
    await expect(run()).rejects.toThrow();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each([{ missingProfile: true }, { paused: true }, { historyError: true }, { claimError: true }, { claimLost: true }])(
    "does not send deadline nudges when safety preconditions fail: %j", async scenario => {
      arrange(scenario);
      await run();
      expect(mocks.send).not.toHaveBeenCalled();
    },
  );

  it("does not generate or send a productive nudge when history is unavailable", async () => {
    arrange({ productive: true, historyError: true });
    await run();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("sends a deadline nudge only after successfully claiming it", async () => {
    arrange();
    await run();
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledWith(expect.any(Object), expect.stringContaining("Homework"), expect.any(String), 3600, "assignment");
  });
});

describe("expired scheduled subscription cleanup", () => {
  const senders = [
    { name: "Canvas token", scenario: {}, run: () => notifyTokenExpired({ from: mocks.from } as unknown as Parameters<typeof notifyTokenExpired>[0], "user") },
    { name: "deadline", scenario: {}, run },
    { name: "productive window", scenario: { productive: true }, run },
    { name: "overdue", scenario: { overdue: true }, run },
  ];

  it.each(senders)("removes an unchanged expired device for $name", async sender => {
    const subscriptions = [{ ...device }];
    arrange(sender.scenario, subscriptions);
    mocks.send.mockRejectedValue({ statusCode: 410 });
    await sender.run();
    expect(mocks.send).toHaveBeenCalled();
    expect(subscriptions).toEqual([]);
  });

  it.each(senders)("preserves a device changed during delivery for $name", async sender => {
    for (const change of [{ user_id: "other-user" }, { auth: "new-auth" }, { p256dh: "new-key" }]) {
      const subscriptions = [{ ...device }];
      const replacement = { ...device, ...change };
      arrange(sender.scenario, subscriptions);
      mocks.send.mockImplementation(async () => {
        subscriptions.splice(0, subscriptions.length, replacement);
        throw { statusCode: 410 };
      });
      await sender.run();
      expect(mocks.send).toHaveBeenCalled();
      expect(subscriptions).toEqual([replacement]);
    }
  });
});
