import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type SubscriptionRow = { user_id: string; endpoint: string; p256dh: string; auth: string };
const boundary = vi.hoisted(() => ({
  from: vi.fn(),
  getUser: vi.fn(),
  limit: vi.fn(),
  sendPush: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ env: {} }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: boundary.getUser }, from: boundary.from }),
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ from: boundary.from }) }));
vi.mock("@upstash/redis", () => ({ Redis: class {} }));
vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class {
    static slidingWindow() { return {}; }
    limit = boundary.limit;
  },
}));
vi.mock("@/lib/webpush", () => ({ sendPushNotification: boundary.sendPush }));

import { POST as subscribe, DELETE as unsubscribe } from "@/app/api/push/subscribe/route";
import { POST as testPush } from "@/app/api/push/test/route";

const device = { endpoint: "https://fcm.googleapis.com/fcm/send/device", p256dh: "device-public-key", auth: "device-secret" };
let rows: SubscriptionRow[];
let beforeWrite: (() => void) | undefined;
let readError: { message: string } | null;

// Only the database boundary is faked; handlers, JSON parsing and validation
// remain real. Filters apply to mutations so ownership races are testable.
class SubscriptionQuery {
  private operation = "select";
  private value?: SubscriptionRow;
  private filters: Array<(row: SubscriptionRow) => boolean> = [];
  select() { return this; }
  delete() { this.operation = "delete"; return this; }
  upsert(value: SubscriptionRow) { this.operation = "upsert"; this.value = value; return this; }
  insert(value: SubscriptionRow) { this.operation = "insert"; this.value = value; return this; }
  update(value: SubscriptionRow) { this.operation = "update"; this.value = value; return this; }
  eq(key: keyof SubscriptionRow, value: string) { this.filters.push((row) => row[key] === value); return this; }
  neq(key: keyof SubscriptionRow, value: string) { this.filters.push((row) => row[key] !== value); return this; }
  throwOnError() { return this; }
  maybeSingle() { return this; }
  single() { return this; }
  then(resolve: (result: { data: SubscriptionRow | null; error: { message: string } | null }) => unknown, reject: (error: unknown) => unknown) {
    try {
      if (this.operation === "select" && readError) return resolve({ data: null, error: readError });
      if (this.operation !== "select") { beforeWrite?.(); beforeWrite = undefined; }
      const matches = (row: SubscriptionRow) => this.filters.every((filter) => filter(row));
      let data = rows.find(matches) ?? null;
      if (this.operation === "delete") rows = rows.filter((row) => !matches(row));
      if (this.operation === "insert" || this.operation === "upsert") {
        const value = this.value!;
        const index = rows.findIndex((row) => row.endpoint === value.endpoint);
        if (index >= 0 && this.operation === "insert") throw { code: "23505" };
        if (index >= 0) rows[index] = value;
        else rows.push(value);
        data = value;
      }
      if (this.operation === "update" && data) {
        const index = rows.indexOf(data);
        data = { ...data, ...this.value };
        rows[index] = data;
      }
      return resolve({ data, error: null });
    } catch (error) { return reject(error); }
  }
}

function request(body: unknown, method = "POST") {
  return new NextRequest("https://coursecue.example/api/push/subscribe", {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rows = [];
  beforeWrite = undefined;
  readError = null;
  boundary.from.mockImplementation(() => new SubscriptionQuery());
  boundary.getUser.mockResolvedValue({ data: { user: { id: "current-user" } } });
  boundary.limit.mockResolvedValue({ success: true });
  boundary.sendPush.mockResolvedValue(undefined);
});

describe("test notification subscription lookup", () => {
  it.each([true, false])("sends the selected test mode only to the current account's device: silent=%s", async silent => {
    rows = [{ ...device, user_id: "current-user" }];
    const response = await testPush(request({ endpoint: device.endpoint, silent }));
    expect(response.status).toBe(200);
    expect(boundary.sendPush).toHaveBeenCalledWith(expect.objectContaining({ endpoint: device.endpoint }),
      expect.any(String), "CourseCue test", 60, undefined, silent);
  });
  it("keeps a healthy device subscribed when the database lookup fails", async () => {
    const existing = { ...device, user_id: "current-user" };
    rows = [existing];
    readError = { message: "database unavailable" };
    const response = await testPush(request({ endpoint: device.endpoint }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Could not check subscription. Try again later." });
    expect(boundary.sendPush).not.toHaveBeenCalled();
    expect(rows).toEqual([existing]);
  });

  it("reports a genuinely missing subscription as expired", async () => {
    const response = await testPush(request({ endpoint: device.endpoint }));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ expired: true });
    expect(boundary.sendPush).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
  });

  it("removes an expired subscription that has not changed", async () => {
    rows = [{ ...device, user_id: "current-user" }];
    boundary.sendPush.mockRejectedValue({ statusCode: 410 });
    const response = await testPush(request({ endpoint: device.endpoint }));
    expect(response.status).toBe(410);
    expect(rows).toEqual([]);
  });

  it.each(["account", "keys"])("preserves a subscription whose %s changed during an expired test", async change => {
    rows = [{ ...device, user_id: "current-user" }];
    const replacement = { ...device, user_id: change === "account" ? "other-user" : "current-user",
      auth: change === "keys" ? "rotated-key" : device.auth };
    boundary.sendPush.mockRejectedValue({ statusCode: 410 });
    beforeWrite = () => { rows = [replacement]; };
    const response = await testPush(request({ endpoint: device.endpoint }));
    expect(response.status).toBe(410);
    expect(rows).toEqual([replacement]);
  });
});

describe("push request boundaries", () => {
  it.each([
    ["subscribe POST", subscribe, "POST"],
    ["subscribe DELETE", unsubscribe, "DELETE"],
    ["test POST", testPush, "POST"],
  ] as const)("returns 400 for malformed JSON in %s", async (_name, handler, method) => {
    const malformed = new NextRequest("https://coursecue.example/api/push/subscribe", {
      method, headers: { "Content-Type": "application/json" }, body: "{broken",
    });
    const response = await handler(malformed);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid JSON body" });
    expect(boundary.from).not.toHaveBeenCalled();
    expect(boundary.sendPush).not.toHaveBeenCalled();
  });

  it.each([
    ["unauthenticated", 401], ["rate limited", 429],
  ] as const)("leaves subscriptions untouched when %s", async (_name, status) => {
    if (status === 401) boundary.getUser.mockResolvedValue({ data: { user: null } });
    else boundary.limit.mockResolvedValue({ success: false });
    const response = await subscribe(request(device));
    expect(response.status).toBe(status);
    expect(boundary.from).not.toHaveBeenCalled();
  });
});

describe("device subscription ownership", () => {
  it.each(["p256dh", "auth"] as const)("rejects another account's endpoint when %s does not match", async (key) => {
    const existing = { ...device, user_id: "other-user" };
    rows = [existing];
    const response = await subscribe(request({ ...device, [key]: "wrong-key" }));
    expect(response.status).toBe(409);
    expect(rows).toEqual([existing]);
  });

  it("transfers a device to the signed-in account when both stored keys match", async () => {
    rows = [{ ...device, user_id: "other-user" }];
    const response = await subscribe(request(device));
    expect(response.status).toBe(200);
    expect(rows).toEqual([{ ...device, user_id: "current-user" }]);
  });

  it("refreshes keys for an endpoint already owned by the signed-in account", async () => {
    rows = [{ ...device, user_id: "current-user", auth: "previous-key" }];
    const response = await subscribe(request(device));
    expect(response.status).toBe(200);
    expect(rows).toEqual([{ ...device, user_id: "current-user" }]);
  });

  it("creates a new device subscription", async () => {
    const response = await subscribe(request(device));
    expect(response.status).toBe(200);
    expect(rows).toEqual([{ ...device, user_id: "current-user" }]);
  });

  it("does not overwrite an endpoint inserted concurrently after the ownership read", async () => {
    const concurrent = { ...device, user_id: "other-user", auth: "unrelated-device-key" };
    beforeWrite = () => rows.push(concurrent);
    const response = await subscribe(request(device));
    expect(response.status).toBe(409);
    expect(rows).toEqual([concurrent]);
  });

  it("does not overwrite keys changed concurrently after the ownership read", async () => {
    rows = [{ ...device, user_id: "other-user" }];
    const concurrent = { ...device, user_id: "other-user", auth: "rotated-key" };
    beforeWrite = () => { rows = [concurrent]; };
    const response = await subscribe(request(device));
    expect(response.status).toBe(409);
    expect(rows).toEqual([concurrent]);
  });
});
