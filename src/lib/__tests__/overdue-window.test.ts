import { describe, expect, it } from "vitest";
import { overdueReminderTtl } from "@/lib/overdue-dedup";

describe("overdue reminder window", () => {
  const due = "2026-10-01T12:00:00Z";
  it.each([
    ["2026-10-01T11:59:59Z", 0],
    ["2026-10-01T12:00:00Z", 0],
    ["2026-10-01T12:00:01Z", 86400],
    ["2026-10-03T12:00:00Z", 86400],
    ["2026-10-04T11:59:59Z", 1],
    ["2026-10-04T12:00:00Z", 0],
    ["2026-10-10T12:00:00Z", 0],
  ])("at %s expires within the three-day window", (now, ttl) => {
    expect(overdueReminderTtl(due, new Date(now))).toBe(ttl);
  });
  it("does not send for missing or invalid deadlines", () => {
    expect(overdueReminderTtl(null)).toBe(0);
    expect(overdueReminderTtl("invalid")).toBe(0);
  });
  it("uses elapsed hours across timezone changes", () => {
    expect(overdueReminderTtl("2026-11-01T01:30:00-05:00", new Date("2026-11-04T00:30:00-06:00"))).toBe(0);
  });
});
