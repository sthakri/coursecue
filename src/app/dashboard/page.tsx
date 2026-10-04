import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SyncNowButton from "@/components/canvas/SyncNowButton";
import WorkloadHeatmap from "@/components/insights/WorkloadHeatmap";
import PushNotificationButton from "@/components/push/PushNotificationButton";
import MobileInstallGuide from "@/components/pwa/MobileInstallGuide";
import { getLocalDate, getDefaultTimezone } from "@/lib/time";
import { BookOpen, AlertTriangle, CalendarClock, RefreshCw } from "lucide-react";
import Link from "next/link";
import { readAllPages } from "@/lib/read-all-pages";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const userId = user.id;
  const now = new Date();
  // No due-date bounds: Canvas syncs a -30d/+60d window into the DB, and
  // every stat on this page (overdue with no floor, 6-week heatmap) needs
  // the full set. Clipping here is what silently hid old overdue items and
  // zeroed out weeks 3–6 of the heatmap.
  const [assignments, { data: profile }] = await Promise.all([
    readAllPages((from, to) => supabase
      .from("assignments")
      .select("due_at")
      .eq("user_id", userId)
      .eq("is_completed", false)
      .is("dismissed_at", null).order("id").range(from, to)),
    supabase.from("profiles").select("canvas_token, canvas_domain, timezone, last_synced_at").eq("id", userId).single().throwOnError(),
  ]);

  const userTz = profile?.timezone ?? getDefaultTimezone();

  // Heatmap data
  const heatmapCounts = (assignments ?? []).reduce<Record<string, number>>((acc, a) => {
    if (!a.due_at) return acc;
    const d = getLocalDate(new Date(a.due_at), userTz);
    acc[d] = (acc[d] ?? 0) + 1;
    return acc;
  }, {});
  const heatmapData = Object.entries(heatmapCounts).map(([due_at, assignment_count]) => ({ due_at, assignment_count }));

  // Stats
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const totalCount = (assignments ?? []).length;
  const overdueCount = (assignments ?? []).filter((a) => a.due_at && new Date(a.due_at) < now).length;
  const dueThisWeekCount = (assignments ?? []).filter((a) => a.due_at && new Date(a.due_at) >= now && new Date(a.due_at) <= weekFromNow).length;
  const hasCanvas = !!(profile?.canvas_token && profile?.canvas_domain);

  const lastSynced = profile?.last_synced_at ? (() => {
    const diff = Math.floor((now.getTime() - new Date(profile.last_synced_at!).getTime()) / 60000);
    if (diff < 1) return "just now";
    if (diff < 60) return `${diff}m ago`;
    const h = Math.floor(diff / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  })() : null;

  return (
    <>
      <header className="border-b border-border bg-background sticky top-0 z-30 min-h-20">
        <div className="pl-14 lg:pl-6 pr-5 py-5 flex flex-wrap items-center justify-between gap-3 max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <h1 className="text-foreground text-2xl sm:text-3xl font-semibold">Dashboard</h1>
            {lastSynced && (
              <span className="hidden sm:flex items-center gap-1.5 text-muted-foreground text-xs">
                <RefreshCw size={11} />
                Last sync: {lastSynced}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <PushNotificationButton userId={userId} />
            {hasCanvas && <SyncNowButton />}
          </div>
        </div>
      </header>

      <main className="flex-1 px-5 py-6 sm:px-6 sm:py-7 max-w-7xl w-full mx-auto">
        <MobileInstallGuide />
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
          <div>
            <h2 className="text-2xl font-semibold">Course work</h2>
            <p className="mt-2 text-sm text-muted-foreground">{dueThisWeekCount} {dueThisWeekCount === 1 ? "assignment due" : "assignments due"} in the next 7 days.</p>
          </div>
          <Link href="/dashboard/assignments" className="inline-flex min-h-11 items-center gap-3 rounded-sm border border-input bg-secondary px-4 text-sm text-foreground hover:bg-muted">Open planner <span aria-hidden="true">→</span></Link>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          {/* Heatmap */}
          <div className="xl:col-span-2">
            <WorkloadHeatmap data={heatmapData} userTz={userTz} />
          </div>

          {/* Stats */}
          <div className="xl:col-span-1 flex flex-col gap-4">
            <div className="rounded-md bg-card border border-border p-6 shadow-sm">
              <p className="text-muted-foreground text-xs font-semibold uppercase tracking-widest mb-6">Overview</p>
              <div className="flex flex-col gap-5">
                <Link href="/dashboard/assignments?filter=all" className="flex items-start gap-4 group">
                  <div className="w-10 h-10 rounded-sm bg-info-soft flex items-center justify-center shrink-0">
                    <BookOpen size={17} className="text-info" />
                  </div>
                  <div>
                    <p className="text-info font-bold text-3xl leading-none group-hover:text-info-hover transition-colors">{totalCount}</p>
                    <p className="text-muted-foreground text-sm mt-1">Open assignments</p>
                  </div>
                </Link>
                <div className="h-px bg-muted" />
                <Link href="/dashboard/assignments?filter=overdue" className="flex items-start gap-4 group">
                  <div className="w-10 h-10 rounded-sm bg-danger-soft flex items-center justify-center shrink-0">
                    <AlertTriangle size={17} className="text-danger" />
                  </div>
                  <div>
                    <p className="text-danger font-bold text-3xl leading-none">{overdueCount}</p>
                    <p className="text-muted-foreground text-sm mt-1">Overdue</p>
                  </div>
                </Link>
                <div className="h-px bg-muted" />
                <Link href="/dashboard/assignments?filter=this-week" className="flex items-start gap-4 group">
                  <div className="w-10 h-10 rounded-sm bg-success-soft flex items-center justify-center shrink-0">
                    <CalendarClock size={17} className="text-success" />
                  </div>
                  <div>
                    <p className="text-success font-bold text-3xl leading-none">{dueThisWeekCount}</p>
                    <p className="text-muted-foreground text-sm mt-1">Due this week</p>
                  </div>
                </Link>
              </div>
            </div>

            <Link href="/dashboard/insights" className="rounded-md border border-border bg-card p-5 flex items-center justify-between group text-info hover:bg-surface-subtle transition-colors shadow-sm">
              <div>
                <p className="font-semibold text-sm">Your Focus Insights</p>
                <p className="text-xs mt-0.5">See your productive patterns</p>
              </div>
              <span className="text-lg group-hover:translate-x-1 transition-transform">→</span>
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
