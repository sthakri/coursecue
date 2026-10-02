"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import SyncNowButton from "@/components/SyncNowButton";
import AssignmentGroups from "@/components/assignments/AssignmentGroups";
import { ASSIGNMENT_FILTERS, parseAssignmentFilter, selectAssignments, type AssignmentFilter, type PlannerAssignment } from "@/lib/assignment-view";
import { ArrowRight, Search } from "lucide-react";

const PAGE_SIZE = 20;
const PRIMARY_FILTERS: AssignmentFilter[] = ["upcoming", "overdue", "completed", "all", "no-date"];

export default function AssignmentsClient({ assignments, hasCanvas, userTz, initialNow }: {
  assignments: PlannerAssignment[]; hasCanvas: boolean; userTz: string; initialNow: string;
}) {
  const params = useSearchParams();
  const pathname = usePathname();
  const filter = parseAssignmentFilter(params.get("filter"));
  const focusedId = params.get("assignment");
  const course = params.get("course") ?? "";
  const search = params.get("q") ?? "";
  const rangeKey = filter === "completed" ? "history" : "ahead";
  const requestedDays = Number(params.get(rangeKey));
  const days = [7, 14, 30].includes(requestedDays) ? requestedDays : filter === "completed" ? 7 : 14;
  const [clock, setNow] = useState(() => Date.parse(initialNow));
  const now = Math.max(clock, Date.parse(initialNow));
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const courses = [...new Map(assignments.filter(a => a.courses).map(a => [a.course_id, a.courses!])).entries()]
    .sort((a, b) => a[1].name.localeCompare(b[1].name));
  const options = { filter, days, now, course, search };
  const results = focusedId ? assignments.filter(a => a.id === focusedId) : selectAssignments(assignments, options);
  const pages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const requestedPage = Number(params.get("page"));
  const page = Math.min(pages, Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1));
  const visible = results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const overdueCount = selectAssignments(assignments, { ...options, filter: "overdue" }).length;
  const tabs = PRIMARY_FILTERS.includes(filter) ? PRIMARY_FILTERS : [...PRIMARY_FILTERS, filter];

  function update(values: Record<string, string>, replace = false) {
    const next = new URLSearchParams(params.toString());
    next.delete("page");
    next.delete("assignment");
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    window.history[replace ? "replaceState" : "pushState"](null, "", `${pathname}?${next}`);
  }

  if (!hasCanvas) return (
    <section className="rounded-sm border border-border bg-card p-8 text-center">
      <h2 className="text-xl font-bold">Connect your coursework</h2>
      <p className="mt-2 text-muted-foreground">Add your Canvas connection in Settings to see your real assignments here.</p>
      <Link href="/dashboard/settings" className="mt-5 inline-flex min-h-11 items-center rounded-sm bg-primary px-5 font-bold text-primary-foreground">Connect Canvas</Link>
    </section>
  );
  if (!assignments.length) return (
    <section className="rounded-sm border border-border bg-card p-8 text-center">
      <h2 className="text-xl font-bold">No assignments to show</h2>
      <p className="my-3 text-muted-foreground">Sync Canvas to check for new work. Completed history covers the last 30 days.</p>
      <SyncNowButton />
    </section>
  );

  return (
    <div className="space-y-6">
      <section className="border-b border-border pb-5">
        <h2 className="text-2xl font-semibold">{focusedId ? "Review assignment" : filter === "completed" ? "Completed course work" : "Course work"}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{filter === "completed" ? "Choose how much of your completed work to see." : "Your Canvas assignments, organised by deadline."}</p>
      </section>

      {focusedId ? <button type="button" onClick={() => update({})} className="min-h-11 text-info hover:text-info-hover font-semibold underline">Back to assignments</button> : <>
        <nav aria-label="Assignment views" className="flex flex-wrap gap-2">
          {tabs.map(tab => {
            const key = tab === "completed" ? "history" : "ahead";
            const requested = Number(params.get(key));
            const tabDays = [7, 14, 30].includes(requested) ? requested : tab === "completed" ? 7 : 14;
            const count = selectAssignments(assignments, { ...options, days: tabDays, filter: tab }).length;
            return <button key={tab} type="button" aria-pressed={filter === tab} onClick={() => update({ filter: tab })}
              className={`min-h-11 inline-flex items-center gap-2 rounded-sm border px-3 py-2 text-sm font-bold transition-colors ${filter === tab ? "bg-primary border-primary text-primary-foreground" : "bg-card border-input text-foreground hover:bg-muted"}`}>
              {ASSIGNMENT_FILTERS[tab]} <span className="text-xs tabular-nums">{count}</span>
            </button>;
          })}
        </nav>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-sm font-semibold">Search assignments
            <span className="mt-1.5 flex items-center gap-2 rounded-sm border border-input bg-background px-3"><Search size={16} aria-hidden="true" />
              <input value={search} onChange={e => update({ q: e.target.value }, true)} placeholder="Title or course name" className="min-h-11 min-w-0 w-full bg-transparent text-sm font-normal" />
            </span>
          </label>
          <label className="text-sm font-semibold">Course
            <select value={course} onChange={e => update({ course: e.target.value })} className="mt-1.5 min-h-11 w-full rounded-sm border border-input bg-background px-3 text-sm font-normal">
              <option value="">All courses</option>{courses.map(([id, c]) => <option key={id} value={id}>{c.name}</option>)}
            </select>
          </label>
          {(filter === "upcoming" || filter === "completed") && <label className="text-sm font-semibold">{filter === "completed" ? "Completed history" : "Look ahead"}
            <select value={days} onChange={e => update({ [rangeKey]: e.target.value })} className="mt-1.5 min-h-11 w-full rounded-sm border border-input bg-background px-3 text-sm font-normal">
              {[7, 14, 30].map(d => <option key={d} value={d}>{filter === "completed" ? "Last" : "Next"} {d} days</option>)}
            </select>
          </label>}
        </div>
        {filter === "upcoming" && overdueCount > 0 && <button type="button" onClick={() => update({ filter: "overdue" })} className="flex w-full items-center justify-between gap-3 rounded-sm border-l-4 border-danger bg-danger-soft p-4 text-left text-danger">
          <span><strong>{overdueCount} overdue {overdueCount === 1 ? "assignment" : "assignments"}</strong><span className="block text-sm mt-1">Review, mark complete, or dismiss. Reminders stop after 3 days.</span></span><ArrowRight size={20} className="shrink-0" />
        </button>}
      </>}

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <h3 className="font-bold text-lg">{focusedId ? "Assignment details" : filter === "completed" ? `Completed · last ${days} days` : filter === "upcoming" ? `Next ${days} days` : ASSIGNMENT_FILTERS[filter]}</h3>
        <p aria-live="polite" className="text-sm text-muted-foreground">{results.length ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, results.length)} of ${results.length}` : "0 assignments"}</p>
      </div>
      {filter === "completed" && <p className="text-sm text-muted-foreground">Dates show when DuePulse recorded completion, which may be later than your Canvas submission.</p>}
      {results.length ? <AssignmentGroups assignments={visible} filter={focusedId ? (visible[0]?.is_completed ? "completed" : "all") : filter} now={now} userTz={userTz} /> : <section className="rounded-sm border border-border bg-card p-8 text-center">
        <h3 className="font-bold text-lg">{focusedId ? "This assignment is no longer in your current view" : "Nothing in this view"}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{focusedId ? "It may have been dismissed or moved outside recent history." : "Try another date range, search, or course. Your other assignments are still available."}</p>
        <button type="button" onClick={() => update({ filter: "all", q: "", course: "" })} className="mt-4 min-h-11 rounded-sm bg-primary px-4 text-sm font-bold text-primary-foreground">View all open work</button>
      </section>}
      {pages > 1 && <nav aria-label="Assignment pages" className="flex items-center justify-between gap-3">
        <button type="button" disabled={page === 1} onClick={() => update({ page: String(page - 1) })} className="min-h-11 rounded-sm border border-input bg-card px-4 font-semibold disabled:opacity-40">Previous</button>
        <span className="text-sm">Page {page} of {pages}</span>
        <button type="button" disabled={page === pages} onClick={() => update({ page: String(page + 1) })} className="min-h-11 rounded-sm bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-40">Next</button>
      </nav>}
    </div>
  );
}
