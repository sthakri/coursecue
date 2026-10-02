export const OVERDUE_REMINDER_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/** Zero means ineligible. Never let a queued push outlive the reminder window. */
export function overdueReminderTtl(dueAt: string | null, now = new Date()): number {
  const elapsed = now.getTime() - new Date(dueAt ?? "").getTime();
  if (!Number.isFinite(elapsed) || elapsed <= 0 || elapsed >= OVERDUE_REMINDER_WINDOW_MS) return 0;
  return Math.max(0, Math.min(86400, Math.floor((OVERDUE_REMINDER_WINDOW_MS - elapsed) / 1000)));
}

/**
 * Deduplication helper for overdue assignment notifications.
 * Spec: Once an assignment is overdue and uncompleted, send a notification
 * once a day (not more than once every 24 hours).
 */
export function filterDailyOverdueNudge<
  A extends { id: string },
  L extends { assignment_id: string | null; sent_at?: string },
>(
  assignments: A[],
  recentLogs: L[],
  now: Date = new Date(),
  windowMs: number = 24 * 60 * 60 * 1000,
): A[] {
  const recentThreshold = now.getTime() - windowMs;
  const recentlyNudged = new Set(
    recentLogs
      .filter((l) => {
        if (!l.assignment_id) return false;
        if (!l.sent_at) return true; // If sent_at not specified, treated as recent
        return new Date(l.sent_at).getTime() >= recentThreshold;
      })
      .map((l) => l.assignment_id as string),
  );
  return assignments.filter((a) => !recentlyNudged.has(a.id));
}

/** Backward-compatible alias for existing imports */
export const filterNeverNudgedOverdue = filterDailyOverdueNudge;
