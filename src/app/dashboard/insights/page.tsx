import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { analyzeProductiveWindows, decayedScore, isActiveSlot } from "@/lib/ml";
import { formatLocalHour, getDefaultTimezone, getLocalDay } from "@/lib/time";
import BehavioralInsightCard from "@/components/BehavioralInsightCard";
import ProductiveWindowsChart from "@/components/ProductiveWindowsChart";
import { CheckCircle2, AlertTriangle, Calendar, BookOpen, Clock, Activity } from "lucide-react";

export const metadata = { title: "Insights — DuePulse" };

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const NUDGE_TYPE_LABELS: Record<string, string> = {
  productive_window: "Productive Window",
  "12h": "12h Before Due",
  "6h": "6h Before Due",
  "1h": "1h Before Due",
  overdue: "Overdue Reminder",
  token_expired: "Canvas Disconnect Alert",
};

export default async function InsightsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const userId = user.id;
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - THIRTY_DAYS_MS).toISOString();

  const [
    { data: pwRows },
    { data: profile },
    { data: nudgeEvents },
    { data: allAssignments },
    { data: courses },
  ] = await Promise.all([
    supabase.from("productive_windows").select("hour_of_day, day_of_week, score, updated_at").eq("user_id", userId),
    supabase.from("profiles").select("timezone").eq("id", userId).single(),
    // nudge_events = append-only send log (one row per delivered nudge).
    // NOT nudge_logs — that's a dedup/claim table whose rows merge re-sends
    // and cascade-delete on assignment completion, so it can't count sends.
    supabase.from("nudge_events").select("nudge_type").eq("user_id", userId).gte("sent_at", thirtyDaysAgo),
    supabase.from("assignments").select("id, title, due_at, is_completed, course_id, points_possible").eq("user_id", userId).is("dismissed_at", null),
    supabase.from("courses").select("id, name, color").eq("user_id", userId),
  ]);

  const userTz = profile?.timezone ?? getDefaultTimezone();
  // Stored scores are all-time cumulative; decayedScore applies a 30-day
  // half-life so peak hour / heatmap / focus windows track current habits.
  const rows = (pwRows ?? []).map((r) => ({
    hour_of_day: r.hour_of_day,
    day_of_week: r.day_of_week,
    score: decayedScore(r.score, r.updated_at, now),
  }));
  // Canvas only syncs the -30d/+60d window, so anything due earlier than
  // 30 days ago is stale (never refreshed or deleted). Excluding it keeps
  // completion/overdue numbers truthful instead of drifting forever.
  const windowStart = new Date(now.getTime() - THIRTY_DAYS_MS);
  const assignments = (allAssignments ?? []).filter(
    (a) => !a.due_at || new Date(a.due_at) >= windowStart
  );
  const courseList = courses ?? [];
  const courseMap = new Map(courseList.map((c) => [c.id, c]));

  // ── Assignment Workload Analytics ────────────────────────────────────────────
  const totalAssignments = assignments.length;
  const completedCount = assignments.filter((a) => a.is_completed).length;
  // Overdue counts ALL incomplete past-due rows, not the 30-day window —
  // this number must match the dashboard's Overdue stat, which has no floor.
  const allRows = allAssignments ?? [];
  const overdueCount = allRows.filter((a) => !a.is_completed && a.due_at && new Date(a.due_at) < now).length;
  const completionRate = totalAssignments > 0 ? Math.round((completedCount / totalAssignments) * 100) : 0;

  // Deadline distribution by day of week
  const dowCounts = [0, 0, 0, 0, 0, 0, 0];
  for (const a of assignments) {
    if (a.due_at) {
      const d = getLocalDay(new Date(a.due_at), userTz);
      dowCounts[d]++;
    }
  }
  const maxDowCount = Math.max(...dowCounts, 1);
  const heaviestDowIdx = dowCounts.indexOf(Math.max(...dowCounts));
  const heaviestDayName = dowCounts[heaviestDowIdx] > 0 ? DOW_FULL[heaviestDowIdx] : null;

  // Course breakdown
  const courseCounts = new Map<string, { count: number; completed: number; points: number }>();
  for (const a of assignments) {
    const cid = a.course_id;
    const existing = courseCounts.get(cid) ?? { count: 0, completed: 0, points: 0 };
    existing.count++;
    if (a.is_completed) existing.completed++;
    if (a.points_possible) existing.points += Number(a.points_possible);
    courseCounts.set(cid, existing);
  }

  const courseAnalytics = Array.from(courseCounts.entries())
    .map(([cid, data]) => {
      const course = courseMap.get(cid);
      return {
        id: cid,
        name: course?.name ?? "Course",
        color: course?.color ?? "var(--primary)",
        ...data,
      };
    })
    .sort((a, b) => b.count - a.count);

  // ── Behavioral Focus Insights ────────────────────────────────────────────────
  const insights = analyzeProductiveWindows(rows, userTz);
  // Count active (day, hour) slots — honest "enough data" signal. Counting
  // distinct weekdays instead would lock out users who study on a fixed
  // weekly schedule no matter how many days they've used the app.
  const activeSlots = (pwRows ?? []).filter((r) => isActiveSlot(r.score, r.updated_at, now)).length;

  const nudgeCounts = (nudgeEvents ?? []).reduce<Record<string, number>>((acc, l) => {
    acc[l.nudge_type] = (acc[l.nudge_type] ?? 0) + 1;
    return acc;
  }, {});
  const totalNudges = Object.values(nudgeCounts).reduce((a, b) => a + b, 0);

  // 7×24 activity grid
  const scoreGrid: Record<number, Record<number, number>> = {};
  for (const r of rows) {
    if (!scoreGrid[r.day_of_week]) scoreGrid[r.day_of_week] = {};
    scoreGrid[r.day_of_week][r.hour_of_day] = r.score;
  }
  const maxScore = Math.max(...rows.map((r) => r.score), 0.01);
  // Peak = best hour summed across all days — same definition the D3 chart
  // uses, so the two "peak" displays on this page can't disagree.
  const hourlyTotals = new Array<number>(24).fill(0);
  for (const r of rows) hourlyTotals[r.hour_of_day] += r.score;
  const maxHourly = Math.max(...hourlyTotals);
  const peakHour = maxHourly > 0 ? hourlyTotals.indexOf(maxHourly) : null;

  return (
    <>
      <header className="border-b border-border bg-background sticky top-0 z-30 h-[57px]">
        <div className="pl-14 lg:pl-0 px-5 h-full flex items-center justify-between gap-4 max-w-7xl mx-auto">
          <div className="flex items-center gap-2">
            <Activity size={18} className="text-primary" />
            <h1 className="text-foreground font-semibold text-base">Insights & Analytics</h1>
          </div>
          <span className="text-muted-foreground text-xs hidden sm:block">Timezone: {userTz}</span>
        </div>
      </header>

      <main className="flex-1 px-5 py-6 sm:px-6 sm:py-7 max-w-7xl w-full mx-auto flex flex-col gap-6">
        {/* Top KPI strip: Real Assignment Performance */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="rounded-sm bg-card border border-border p-5">
            <div className="flex items-center justify-between">
              <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Completion</p>
              <CheckCircle2 size={16} className="text-success" />
            </div>
            <p className="font-bold text-3xl text-success mt-2 leading-none">{completionRate}%</p>
            <p className="text-muted-foreground text-xs mt-2">{completedCount} of {totalAssignments} completed</p>
          </div>

          <div className="rounded-sm bg-card border border-border p-5">
            <div className="flex items-center justify-between">
              <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Overdue</p>
              <AlertTriangle size={16} className={overdueCount > 0 ? "text-danger" : "text-muted-foreground"} />
            </div>
            <p className={`font-bold text-3xl mt-2 leading-none ${overdueCount > 0 ? "text-danger" : "text-foreground"}`}>{overdueCount}</p>
            <p className="text-muted-foreground text-xs mt-2">{overdueCount === 0 ? "All caught up!" : "Needs attention"}</p>
          </div>

          <div className="rounded-sm bg-card border border-border p-5">
            <div className="flex items-center justify-between">
              <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Peak Hour</p>
              <Clock size={16} className="text-primary" />
            </div>
            <p className="font-bold text-2xl text-primary mt-2 leading-none">
              {peakHour !== null ? formatLocalHour(peakHour, userTz) : "—"}
            </p>
            <p className="text-muted-foreground text-xs mt-2">Highest app activity</p>
          </div>

          <div className="rounded-sm bg-card border border-border p-5">
            <div className="flex items-center justify-between">
              <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Crunch Day</p>
              <Calendar size={16} className="text-warning" />
            </div>
            <p className="font-bold text-2xl text-warning mt-2 leading-none">
              {heaviestDayName ?? "—"}
            </p>
            <p className="text-muted-foreground text-xs mt-2">Most deadlines due</p>
          </div>
        </div>

        {/* Focus profile + D3 Productive Windows Chart */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2">
            <BehavioralInsightCard insights={insights} activeSlots={activeSlots} />
          </div>
          <ProductiveWindowsChart data={rows} userTz={userTz} />
        </div>

        {/* Workload Deadline Pattern by Day of Week & Course Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Deadline distribution by day */}
          <div className="rounded-sm bg-card border border-border p-5 sm:p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-foreground font-semibold text-base flex items-center gap-2">
                  <Calendar size={18} className="text-primary" />
                  Deadline Concentration by Day
                </h2>
              </div>
              <p className="text-muted-foreground text-xs mb-4">When your assignments are due throughout the week</p>
            </div>

            <div className="space-y-2.5 my-2">
              {DOW_SHORT.map((dow, idx) => {
                const count = dowCounts[idx];
                const pct = Math.round((count / maxDowCount) * 100);
                const isPeak = count === maxDowCount && count > 0;
                return (
                  <div key={dow} className="flex items-center gap-3">
                    <span className={`text-xs w-8 shrink-0 font-medium ${isPeak ? "text-warning" : "text-muted-foreground"}`}>{dow}</span>
                    <div className="flex-1 h-2 bg-surface-subtle rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${isPeak ? "bg-warning" : count > 0 ? "bg-primary" : "bg-transparent"}`}
                        style={{ width: `${Math.max(pct, count > 0 ? 5 : 0)}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground w-8 text-right font-medium">{count}</span>
                  </div>
                );
              })}
            </div>

            <p className="text-muted-foreground text-xs mt-3">
              {heaviestDayName
                ? `Tip: Plan head starts before ${heaviestDayName}s to avoid pile-ups.`
                : "Sync assignments to see your weekly deadline load."}
            </p>
          </div>

          {/* Course workload breakdown */}
          <div className="rounded-sm bg-card border border-border p-5 sm:p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-foreground font-semibold text-base flex items-center gap-2">
                  <BookOpen size={18} className="text-primary" />
                  Course Workload Breakdown
                </h2>
                <span className="text-muted-foreground text-xs">{courseAnalytics.length} course{courseAnalytics.length !== 1 ? "s" : ""}</span>
              </div>
              <p className="text-muted-foreground text-xs mb-4">Assignments and completion progress per course</p>
            </div>

            {courseAnalytics.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground text-xs">
                No course data yet. Connect Canvas to view course workload analytics.
              </div>
            ) : (
              <div className="space-y-3 my-1">
                {courseAnalytics.slice(0, 4).map((c) => {
                  const coursePct = c.count > 0 ? Math.round((c.completed / c.count) * 100) : 0;
                  return (
                    <div key={c.id} className="rounded-sm bg-surface-subtle border border-border p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-semibold text-foreground truncate max-w-[200px]">
                          {c.name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {c.completed}/{c.count} done ({coursePct}%)
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-background rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${coursePct}%`, backgroundColor: c.color }} />
                      </div>
                    </div>
                  );
                })}
                {courseAnalytics.length > 4 && (
                  <p className="text-muted-foreground text-xs text-center pt-1">
                    +{courseAnalytics.length - 4} more course{courseAnalytics.length - 4 !== 1 ? "s" : ""}
                  </p>
                )}
              </div>
            )}

            <p className="text-muted-foreground text-xs mt-2">
              Based on active courses imported from your Canvas account.
            </p>
          </div>
        </div>

        {/* Activity Heatmap 7x24 */}
        <div className="rounded-sm bg-card border border-border p-5 sm:p-6 overflow-x-auto">
          <h2 className="text-foreground font-semibold text-base mb-1">Activity Heatmap (7 × 24)</h2>
          <p className="text-muted-foreground text-xs mb-5">When you&apos;re active on the dashboard, local time ({userTz}) — darker maroon = higher engagement</p>
          <div className="min-w-[560px]">
            {/* Hour labels */}
            <div className="flex items-center mb-1 ml-9">
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="flex-1 text-center text-[10px] text-muted-foreground">
                  {h % 6 === 0 ? `${h}h` : ""}
                </div>
              ))}
            </div>
            {/* Grid rows */}
            {DOW_SHORT.map((day, dow) => (
              <div key={day} className="flex items-center gap-1 mb-1">
                <span className="w-8 text-right text-[10px] text-muted-foreground shrink-0">{day}</span>
                <div className="flex flex-1 gap-px">
                  {Array.from({ length: 24 }, (_, h) => {
                    const score = scoreGrid[dow]?.[h] ?? 0;
                    const rel = score / maxScore;
                    const alpha = rel < 0.01 ? 0.06 : 0.08 + rel * 0.85;
                    return (
                      <div
                        key={h}
                        className="flex-1 aspect-square rounded-[2px]"
                        style={{
                          backgroundColor: `color-mix(in srgb, var(--primary) ${(alpha * 100).toFixed(0)}%, var(--background))`,
                          border: score > 0 ? "none" : "1px solid var(--border)",
                        }}
                        title={`${day} ${formatLocalHour(h, userTz)}: ${(score * 100).toFixed(0)} pts`}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
            {/* Legend */}
            <div className="flex items-center gap-2 mt-3 ml-9">
              <span className="text-muted-foreground text-[10px]">Less active</span>
              <div className="flex gap-px">
                {[0.06, 0.2, 0.4, 0.65, 0.93].map((a) => (
                  <div key={a} className="w-3 h-3 rounded-[2px]" style={{ backgroundColor: `color-mix(in srgb, var(--primary) ${a * 100}%, var(--background))` }} />
                ))}
              </div>
              <span className="text-muted-foreground text-[10px]">More active</span>
            </div>
          </div>
        </div>

        {/* Nudge summary */}
        {totalNudges > 0 && (
          <div className="rounded-sm bg-card border border-border p-5 sm:p-6">
            <h2 className="text-foreground font-semibold text-base mb-1">Nudge Summary</h2>
            <p className="text-muted-foreground text-xs mb-5">Push notifications sent in the last 30 days</p>
            <div className="flex flex-col gap-3">
              {Object.entries(nudgeCounts).map(([type, count]) => {
                const pct = Math.round((count / totalNudges) * 100);
                return (
                  <div key={type}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-muted-foreground text-sm">{NUDGE_TYPE_LABELS[type] ?? type}</span>
                      <span className="text-foreground text-sm font-medium">{count}</span>
                    </div>
                    <div className="w-full h-1.5 bg-surface-subtle rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-muted-foreground text-xs mt-4">{totalNudges} total nudge{totalNudges !== 1 ? "s" : ""} in the last 30 days</p>
          </div>
        )}
      </main>
    </>
  );
}
