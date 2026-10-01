"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import AssignmentCard from "@/components/AssignmentCard";
import SyncNowButton from "@/components/SyncNowButton";
import { BookOpen, RefreshCw } from "lucide-react";

type Course = { name: string; color: string };
type Assignment = {
  id: string;
  title: string;
  due_at: string | null;
  points_possible: number | null;
  canvas_assignment_id: number;
  course_id: string;
  courses: Course | null;
  is_completed?: boolean;
};
type Filter = "all" | "overdue" | "due-soon" | "this-week" | "upcoming" | "no-date" | "completed";

interface Props { assignments: Assignment[]; hasCanvas: boolean; userTz: string }

function classifyAssignment(a: Assignment): Filter {
  if (a.is_completed) return "completed";
  if (!a.due_at) return "no-date";
  const now = new Date();
  const due = new Date(a.due_at);
  const ms = due.getTime() - now.getTime();
  if (ms < 0) return "overdue";
  if (ms <= 24 * 60 * 60 * 1000) return "due-soon";
  return "upcoming";
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The dashboard "Due this week" stat is [now, now+7d] — keep identical here. */
function isDueThisWeek(a: Assignment): boolean {
  if (a.is_completed || !a.due_at) return false;
  const ms = new Date(a.due_at).getTime() - Date.now();
  return ms >= 0 && ms <= WEEK_MS;
}

const FILTER_LABELS: Record<Filter, string> = {
  all: "All",
  overdue: "Overdue",
  "due-soon": "Due Soon",
  "this-week": "This Week",
  upcoming: "Upcoming",
  "no-date": "No Date",
  completed: "Completed",
};
const FILTER_COLORS: Record<Filter, string> = {
  all: "",
  overdue: "text-danger",
  "due-soon": "text-warning",
  "this-week": "text-warning",
  upcoming: "text-success",
  "no-date": "text-muted-foreground",
  completed: "text-success",
};

export default function AssignmentsClient({ assignments, hasCanvas, userTz }: Props) {
  const searchParams = useSearchParams();
  const urlFilter = searchParams.get("filter") as Filter | null;
  const isValidFilter = urlFilter && ["all", "overdue", "due-soon", "this-week", "upcoming", "no-date", "completed"].includes(urlFilter);
  const [activeFilter, setActiveFilter] = useState<Filter>(isValidFilter ? urlFilter : "all");
  const [activeCourse, setActiveCourse] = useState<string | null>(null);

  const courses = Array.from(
    new Map(assignments.filter((a) => a.courses).map((a) => [a.course_id, a.courses!])).entries()
  ).map(([id, course]) => ({ id, ...course }));

  const activeAssignments = assignments.filter((a) => !a.is_completed);
  const counts: Record<Filter, number> = {
    all: activeAssignments.length,
    overdue: 0,
    "due-soon": 0,
    "this-week": 0,
    upcoming: 0,
    "no-date": 0,
    completed: 0,
  };
  for (const a of assignments) {
    counts[classifyAssignment(a)]++;
    if (isDueThisWeek(a)) counts["this-week"]++;
  }

  const filtered = assignments.filter((a) => {
    let matchesFilter = false;
    if (activeFilter === "all") {
      matchesFilter = !a.is_completed;
    } else if (activeFilter === "completed") {
      matchesFilter = !!a.is_completed;
    } else if (activeFilter === "this-week") {
      matchesFilter = isDueThisWeek(a);
    } else {
      matchesFilter = !a.is_completed && classifyAssignment(a) === activeFilter;
    }
    const matchesCourse = !activeCourse || a.course_id === activeCourse;
    return matchesFilter && matchesCourse;
  });

  if (!hasCanvas) return (
    <div className="flex flex-col items-center justify-center py-24 text-center px-4">
      <div className="w-16 h-16 rounded-sm bg-surface-subtle border border-border flex items-center justify-center mb-5"><BookOpen size={26} className="text-muted-foreground" /></div>
      <h2 className="text-foreground font-bold text-xl mb-2">Connect Canvas first</h2>
      <p className="text-muted-foreground text-sm leading-relaxed max-w-xs mb-6">Go to Settings and add your Canvas domain and API token to start pulling in your assignments.</p>
      <a href="/dashboard/settings" className="rounded-sm bg-primary hover:bg-primary-hover text-white font-semibold text-sm px-5 py-2.5 transition-colors">Go to Settings</a>
    </div>
  );

  if (assignments.length === 0) return (
    <div className="flex flex-col items-center justify-center py-24 text-center px-4">
      <div className="w-16 h-16 rounded-sm bg-surface-subtle border border-border flex items-center justify-center mb-5"><RefreshCw size={24} className="text-muted-foreground" /></div>
      <h2 className="text-foreground font-bold text-xl mb-2">No assignments yet</h2>
      <p className="text-muted-foreground text-sm leading-relaxed max-w-xs mb-6">Sync your Canvas account to load your assignments.</p>
      <SyncNowButton />
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Filter tabs */}
      <div className="flex items-center gap-1 flex-wrap">
        {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => {
          const count = counts[f];
          // Never hide the ACTIVE tab — landing on ?filter=overdue with zero
          // overdue would otherwise render no selected tab at all.
          if (f !== "all" && count === 0 && f !== activeFilter) return null;
          const isActive = activeFilter === f;
          return (
            <button key={f} type="button" aria-pressed={isActive} onClick={() => setActiveFilter(f)}
              className={`flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-sm font-medium transition-all border ${isActive ? "bg-primary-soft border-primary/25 text-primary" : "bg-card border-border text-muted-foreground hover:text-muted-foreground hover:bg-card"}`}>
              <span className={isActive ? "text-primary" : FILTER_COLORS[f]}>{FILTER_LABELS[f]}</span>
              <span className={`text-xs rounded-md px-1.5 py-0.5 ${isActive ? "bg-primary-soft text-primary" : "bg-muted text-muted-foreground"}`}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Course pills */}
      {courses.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-muted-foreground text-xs">Course:</span>
          <button type="button" aria-pressed={!activeCourse} onClick={() => setActiveCourse(null)}
            className={`rounded-sm px-2.5 py-1 text-xs font-medium border transition-colors ${!activeCourse ? "bg-primary-soft border-primary/25 text-primary" : "bg-card border-border text-muted-foreground hover:text-muted-foreground"}`}>
            All
          </button>
          {courses.map(({ id, name, color }) => (
            <button key={id} type="button" aria-pressed={activeCourse === id} onClick={() => setActiveCourse(activeCourse === id ? null : id)}
              className={`inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium border transition-colors ${activeCourse === id ? "bg-primary-soft border-primary text-foreground" : "bg-card border-border text-muted-foreground hover:bg-surface-subtle"}`}>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
              {name}
            </button>
          ))}
        </div>
      )}

      {/* Results */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-foreground font-semibold text-base mb-1">No assignments match this filter</p>
          <p className="text-muted-foreground text-sm">Try selecting a different filter above.</p>
          <button type="button" onClick={() => { setActiveFilter("all"); setActiveCourse(null); }} className="mt-4 text-primary hover:text-primary-hover text-sm font-medium transition-colors bg-transparent">Clear filters</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((a) => (
            <AssignmentCard
              key={a.id}
              id={a.id}
              title={a.title}
              course_name={a.courses?.name ?? "Unknown Course"}
              due_at={a.due_at}
              points_possible={a.points_possible !== null ? Number(a.points_possible) : null}
              canvas_assignment_id={String(a.canvas_assignment_id)}
              course_color={a.courses?.color ?? "var(--primary)"}
              userTz={userTz}
              is_completed={a.is_completed ?? false}
            />
          ))}
        </div>
      )}
    </div>
  );
}
