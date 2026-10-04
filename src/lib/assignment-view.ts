import { getLocalDate } from "@/lib/time";

export type PlannerAssignment = {
  id: string; title: string; due_at: string | null; updated_at: string;
  is_completed: boolean; course_id: string; canvas_assignment_id: number;
  points_possible: number | null; html_url?: string | null; courses: { name: string; color: string } | null;
};
export const ASSIGNMENT_FILTERS = {
  upcoming: "Next up", overdue: "Overdue", completed: "Completed", all: "All open",
  "no-date": "No due date", "due-soon": "Due in 24 hours", "this-week": "Due this week",
} as const;
export type AssignmentFilter = keyof typeof ASSIGNMENT_FILTERS;
const DAY = 86400000;

export function parseAssignmentFilter(value: string | null): AssignmentFilter {
  return value && Object.hasOwn(ASSIGNMENT_FILTERS, value) ? value as AssignmentFilter : "upcoming";
}

export function selectAssignments(assignments: PlannerAssignment[], options: {
  filter: AssignmentFilter; days: number; now: number; course?: string; search?: string;
}): PlannerAssignment[] {
  const { filter, days, now, course } = options;
  const search = options.search?.trim().toLocaleLowerCase() ?? "";
  return assignments.filter(a => {
    if (course && a.course_id !== course) return false;
    if (search && !`${a.title} ${a.courses?.name ?? ""}`.toLocaleLowerCase().includes(search)) return false;
    if (filter === "completed") {
      const recorded = Date.parse(a.updated_at);
      return a.is_completed && recorded >= now - days * DAY && recorded <= now;
    }
    if (a.is_completed) return false;
    if (filter === "all") return true;
    const due = a.due_at ? Date.parse(a.due_at) : NaN;
    if (filter === "no-date") return !Number.isFinite(due);
    if (filter === "overdue") return due < now;
    const horizon = filter === "this-week" ? 7 : filter === "due-soon" ? 1 : days;
    return due >= now && due <= now + horizon * DAY;
  }).sort((a, b) => {
    if (filter === "completed") return Date.parse(b.updated_at) - Date.parse(a.updated_at) || a.id.localeCompare(b.id);
    const ad = a.due_at ? Date.parse(a.due_at) : Infinity;
    const bd = b.due_at ? Date.parse(b.due_at) : Infinity;
    // Recent overdue first; upcoming deadlines ascend. Missing dates go last.
    return (ad < now && bd < now ? bd - ad : ad - bd) || a.id.localeCompare(b.id);
  });
}

export function groupAssignments(assignments: PlannerAssignment[], filter: AssignmentFilter, now: number, timezone: string) {
  const groups = new Map<string, { label: string; items: PlannerAssignment[] }>();
  const today = getLocalDate(new Date(now), timezone);
  // Advance the calendar label rather than adding 24h to a local instant (DST).
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + DAY).toISOString().slice(0, 10);
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long", month: "short", day: "numeric" });
  for (const a of assignments) {
    const timestamp = filter === "completed" ? a.updated_at : a.due_at;
    let key = "undated", label = "No due date";
    if (timestamp && Number.isFinite(Date.parse(timestamp))) {
      const date = new Date(timestamp);
      key = getLocalDate(date, timezone);
      label = key === today ? "Today" : key === tomorrow ? "Tomorrow" : formatter.format(date);
      if (filter !== "completed" && date.getTime() < now) {
        key = now - date.getTime() >= 3 * DAY ? "older-overdue" : "recent-overdue";
        label = key === "older-overdue" ? "Older overdue" : "Recently overdue";
      }
    }
    const group = groups.get(key) ?? { label, items: [] };
    group.items.push(a);
    groups.set(key, group);
  }
  return [...groups.values()];
}
