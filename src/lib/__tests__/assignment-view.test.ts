import { describe, expect, it } from "vitest";
import { selectAssignments, groupAssignments, type PlannerAssignment } from "@/lib/assignment-view";

const now = Date.parse("2026-10-01T18:00:00Z");
const day = 86400000;
const item = (id: string, days: number | null, extra: Partial<PlannerAssignment> = {}): PlannerAssignment => ({
  id, title: id, due_at: days === null ? null : new Date(now + days * day).toISOString(),
  updated_at: new Date(now - day).toISOString(), is_completed: false, course_id: "math",
  courses: { name: "Calculus", color: "#047857" }, points_possible: 0, canvas_assignment_id: 1, ...extra,
});
const items = [item("old", -20), item("recent", -1), item("today", 0.1), item("week", 6), item("two-weeks", 13), item("later", 20), item("undated", null), item("done", -5, { is_completed: true }), item("older-done", -2, { is_completed: true, updated_at: new Date(now - 9 * day).toISOString() })];

describe("assignment views", () => {
  it("defaults to upcoming work in the next 14 days without losing overdue or undated work", () => {
    expect(selectAssignments(items, { filter: "upcoming", days: 14, now }).map(a => a.id)).toEqual(["today", "week", "two-weeks"]);
    expect(selectAssignments(items, { filter: "overdue", days: 14, now }).map(a => a.id)).toEqual(["recent", "old"]);
    expect(selectAssignments(items, { filter: "no-date", days: 14, now }).map(a => a.id)).toEqual(["undated"]);
  });
  it("filters completed work by its recorded completion, not its deadline", () => {
    expect(selectAssignments(items, { filter: "completed", days: 7, now }).map(a => a.id)).toEqual(["done"]);
    expect(selectAssignments(items, { filter: "completed", days: 14, now }).map(a => a.id)).toEqual(["done", "older-done"]);
  });
  it("keeps all open work accessible outside the default window", () => {
    expect(selectAssignments(items, { filter: "all", days: 14, now })).toHaveLength(7);
  });
  it("combines course and case-insensitive search filters", () => {
    expect(selectAssignments(items, { filter: "all", days: 14, now, course: "other" })).toEqual([]);
    expect(selectAssignments(items, { filter: "all", days: 14, now, search: "  CALCULUS " })).toHaveLength(7);
    expect(selectAssignments(items, { filter: "all", days: 14, now, search: "two-weeks" }).map(a => a.id)).toEqual(["two-weeks"]);
  });
  it("keeps dashboard this-week links consistent with a rolling 7-day window", () => {
    expect(selectAssignments(items, { filter: "this-week", days: 14, now }).map(a => a.id)).toEqual(["today", "week"]);
  });
  it("groups by the student's local calendar day across midnight", () => {
    const groups = groupAssignments([item("late", 0, { due_at: "2026-10-02T02:00:00Z" })], "upcoming", now, "America/Chicago");
    expect(groups[0].label).toBe("Today");
  });
  it("separates older overdue work and keeps missing dates readable", () => {
    const groups = groupAssignments([items[1], items[0], items[6]], "all", now, "America/Chicago");
    expect(groups.map(g => g.label)).toEqual(["Recently overdue", "Older overdue", "No due date"]);
  });
  it("does not mutate input order", () => {
    const copy = [...items];
    selectAssignments(items, { filter: "all", days: 14, now });
    expect(items).toEqual(copy);
  });
});
