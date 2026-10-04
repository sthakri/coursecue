import { describe, expect, it } from "vitest";
import { canNotify } from "@/lib/notification-preferences";

const profile = { timezone: "America/Chicago", quiet_hours_start: 22, quiet_hours_end: 8, nudge_paused_until: null };
describe("scheduled notification preferences", () => {
  it("fails closed if preferences are missing", () => expect(canNotify(null, new Date())).toBe(false));
  it.each([
    ["2026-10-03T12:59:00Z", false], ["2026-10-03T13:00:00Z", true],
    ["2026-10-04T02:59:00Z", true], ["2026-10-04T03:00:00Z", false],
  ])("respects overnight quiet hours at %s", (now, allowed) => expect(canNotify(profile, new Date(now))).toBe(allowed));
  it("honors pauses even outside quiet hours", () => {
    expect(canNotify({ ...profile, nudge_paused_until: "2026-10-04T00:00:00Z" }, new Date("2026-10-03T18:00:00Z"))).toBe(false);
  });
  it("resumes at the exact pause end", () => {
    expect(canNotify({ ...profile, nudge_paused_until: "2026-10-03T18:00:00Z" }, new Date("2026-10-03T18:00:00Z"))).toBe(true);
  });
  it("supports daytime and disabled quiet hours", () => {
    expect(canNotify({ ...profile, quiet_hours_start: 9, quiet_hours_end: 17 }, new Date("2026-10-03T18:00:00Z"))).toBe(false);
    expect(canNotify({ ...profile, quiet_hours_start: null, quiet_hours_end: null }, new Date("2026-10-04T05:00:00Z"))).toBe(true);
  });
});
