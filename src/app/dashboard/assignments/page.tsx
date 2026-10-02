import { redirect } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import StressAlert from "@/components/assignments/StressAlert";
import SyncNowButton from "@/components/canvas/SyncNowButton";
import AssignmentsClient from "@/components/assignments/AssignmentsClient";
import { coerceTimezone, COMPLETED_RETENTION_DAYS } from "@/lib/time";
import { RefreshCw } from "lucide-react";
import { readAllPages } from "@/lib/read-all-pages";

export const metadata = { title: "Assignments — DuePulse" };

export default async function AssignmentsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const userId = user.id;
  const now = new Date();
  // Limit visible history while retaining stored completion decisions.
  const completedCutoff = new Date(now.getTime() - COMPLETED_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  // Every incomplete assignment (any due date — old overdue ones must stay
  // visible so the overdue filter can't silently undercount) plus completed
  // rows touched in the retention window. updated_at moves on manual toggles
  // (complete route) and on Canvas-detected completions (canvas-sync), so
  // "recently completed" is honest both ways.
  const [assignments, { data: profile }] = await Promise.all([
    readAllPages((from, to) => supabase
      .from("assignments")
      .select("id, title, due_at, updated_at, points_possible, canvas_assignment_id, course_id, is_completed, courses(name, color)")
      .eq("user_id", userId)
      .is("dismissed_at", null)
      .or(`is_completed.eq.false,and(is_completed.eq.true,updated_at.gte.${completedCutoff.toISOString()})`)
      .order("due_at", { ascending: true, nullsFirst: false }).order("id").range(from, to)),
    supabase.from("profiles").select("canvas_token, canvas_domain, timezone, last_synced_at").eq("id", userId).single().throwOnError(),
  ]);

  const userTz = coerceTimezone(profile?.timezone);
  const hasCanvas = !!(profile?.canvas_token && profile?.canvas_domain);

  const lastSynced = profile?.last_synced_at ? (() => {
    const diff = Math.floor((now.getTime() - new Date(profile.last_synced_at!).getTime()) / 60000);
    if (diff < 1) return "just now";
    if (diff < 60) return `${diff}m ago`;
    const h = Math.floor(diff / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  })() : null;

  const normalised = (assignments ?? []).map((a) => ({
    ...a,
    courses: Array.isArray(a.courses) ? (a.courses[0] ?? null) : (a.courses ?? null),
  }));

  return (
    <>
      <header className="border-b border-border bg-background sticky top-0 z-30 min-h-20">
        <div className="pl-14 lg:pl-6 pr-5 py-5 min-h-20 flex items-center justify-between gap-4 max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <h1 className="text-foreground font-semibold text-2xl sm:text-3xl">Assignments</h1>
            {lastSynced && (
              <span className="hidden sm:flex items-center gap-1.5 text-muted-foreground text-xs">
                <RefreshCw size={11} />
                Last sync: {lastSynced}
              </span>
            )}
          </div>
          {hasCanvas && <SyncNowButton />}
        </div>
      </header>

      <main className="flex-1 px-5 py-6 sm:px-6 sm:py-7 max-w-7xl w-full mx-auto">
        <div className="mb-5">
          <StressAlert userId={userId} />
        </div>
        <Suspense>
          <AssignmentsClient assignments={normalised} hasCanvas={hasCanvas} userTz={userTz} initialNow={now.toISOString()} />
        </Suspense>
      </main>
    </>
  );
}
