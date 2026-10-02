"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { useDuePulseStore } from "@/lib/store";

interface AssignmentCardProps {
  id: string;
  title: string;
  course_name: string;
  due_at: string | null;
  points_possible: number | null;
  canvas_assignment_id: string;
  course_color?: string;
  userTz: string;
  is_completed?: boolean;
}

function getDueDateInfo(due_at: string, userTz: string): { label: string; isOverdue: boolean; isDueSoon: boolean } {
  const due = new Date(due_at)
  const now = new Date()
  const msUntilDue = due.getTime() - now.getTime()
  const isOverdue = msUntilDue < 0
  const isDueSoon = !isOverdue && msUntilDue <= 24 * 60 * 60 * 1000

  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: userTz })
  const todayStr = fmt.format(now)
  const dueDayStr = fmt.format(due)
  const todayMidnight = new Date(`${todayStr}T00:00:00Z`)
  const dueMidnight = new Date(`${dueDayStr}T00:00:00Z`)
  const diffDays = Math.round((dueMidnight.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24))

  const exactTime = new Intl.DateTimeFormat("en-US", { timeZone: userTz, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(due)

  let label: string
  if (isOverdue) {
    if (diffDays <= -1) {
      const daysAgo = Math.abs(diffDays)
      label = `Overdue by ${daysAgo} day${daysAgo > 1 ? "s" : ""}`
    } else {
      const hoursOverdue = Math.floor(Math.abs(msUntilDue) / 3_600_000)
      label = hoursOverdue >= 1 ? `Overdue by ${hoursOverdue}h (was due at ${exactTime})` : `Overdue (was due at ${exactTime})`
    }
  } else {
    const relativeLabel = diffDays === 0 ? "Due today" : diffDays === 1 ? "Due tomorrow" : `Due in ${diffDays} days`
    label = `${relativeLabel} at ${exactTime}`
  }

  return { label, isOverdue, isDueSoon }
}

export default function AssignmentCard({
  id,
  title,
  course_name,
  due_at,
  points_possible,
  course_color = "var(--primary)",
  userTz,
  is_completed = false,
}: AssignmentCardProps) {
  const router = useRouter();
  const bumpAssignmentsVersion = useDuePulseStore((s) => s.bumpAssignmentsVersion);
  const [dismissing, setDismissing] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [completed, setCompleted] = useState(is_completed);
  const [previousCompleted, setPreviousCompleted] = useState(is_completed);
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  if (previousCompleted !== is_completed) {
    setPreviousCompleted(is_completed);
    setCompleted(is_completed);
  }

  const dueInfo = due_at ? getDueDateInfo(due_at, userTz) : null;
  const isOverdue = !completed && (dueInfo?.isOverdue ?? false);
  const isDueSoon = !completed && (dueInfo?.isDueSoon ?? false);

  async function handleToggleComplete() {
    if (completing || dismissing) return;
    setCompleting(true);
    const nextState = !completed;
    setCompleted(nextState);
    try {
      const res = await fetch("/api/assignments/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId: id, completed: nextState }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok) {
        setCompleted(!nextState); // rollback
        toast.error(data.error ?? "Failed to update status");
        return;
      }
      toast.success(nextState ? "Assignment marked as completed ✓" : "Assignment marked as incomplete");
      bumpAssignmentsVersion();
      router.refresh();
    } catch {
      setCompleted(!nextState); // rollback
      toast.error("Network error — could not update assignment");
    } finally {
      setCompleting(false);
    }
  }

  async function handleDismiss() {
    if (completing || dismissing) return;
    setDismissing(true);
    try {
      const res = await fetch("/api/assignments/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId: id }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok) { toast.error(data.error ?? "Dismiss failed"); return; }
      toast.success("Dismissed from DuePulse. Canvas is unchanged.");
      bumpAssignmentsVersion();
      router.refresh();
    } catch { toast.error("Network error — dismiss failed"); }
    finally { setDismissing(false); }
  }

  return (
    <Card
      className={cn(
        "rounded-sm bg-card border border-border p-4 flex flex-col gap-2 ring-0 shadow-none hover:border-primary/40 hover:bg-surface-subtle transition-all duration-150 relative group",
        completed && "bg-surface-subtle"
      )}
      style={{ borderLeft: `3px solid ${course_color}` }}
    >
      <p className="text-muted-foreground text-xs font-bold uppercase tracking-wide leading-normal">{course_name}</p>
      <p className={cn("text-foreground font-semibold text-base break-words", completed && "line-through text-muted-foreground")}>
        {title}
      </p>
      <div className="flex flex-wrap items-center gap-2 mt-1">
        <button
          type="button"
          onClick={handleToggleComplete}
          disabled={completing || dismissing}
          aria-label={completed ? "Mark as incomplete" : "Mark as completed"}
          title={completed ? "Mark as incomplete" : "Mark as completed"}
          className={cn(
            "min-h-10 rounded-sm px-3 py-2 text-sm font-semibold transition disabled:opacity-50 inline-flex gap-2 items-center justify-center",
            completed
              ? "bg-success-soft text-success hover:bg-success-soft"
              : "bg-primary text-primary-foreground hover:bg-primary-hover"
          )}
        >
          <Check size={14} className={completed ? "stroke-[2.5]" : "stroke-[1.5]"} />
          {completing ? "Saving…" : completed ? "Mark incomplete" : "Mark complete"}
        </button>

        {/* Dismiss button for overdue */}
        {isOverdue && (
          <button
            type="button"
            onClick={() => setConfirmDismiss(!confirmDismiss)}
            disabled={dismissing || completing}
            aria-label="Dismiss overdue assignment"
            title="Dismiss this overdue assignment"
            aria-expanded={confirmDismiss}
            className="min-h-10 rounded-sm border border-input px-3 py-2 text-sm font-semibold text-foreground transition hover:bg-muted disabled:opacity-50"
          >
            Dismiss
          </button>
        )}
      </div>

      {isOverdue && <p className="text-sm text-muted-foreground">Already submitted? Mark complete here. This updates DuePulse only.</p>}
      {confirmDismiss && isOverdue && (
        <div className="rounded-sm border border-warning bg-warning-soft p-3 text-sm">
          <p className="text-foreground">Hide this assignment and stop its reminders? It will stay in Canvas.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={dismissing || completing} onClick={handleDismiss} className="min-h-10 rounded-sm bg-primary px-3 py-2 font-semibold text-primary-foreground disabled:opacity-50">{dismissing ? "Dismissing…" : "Yes, dismiss"}</button>
            <button type="button" disabled={dismissing} onClick={() => setConfirmDismiss(false)} className="min-h-10 px-3 py-2 text-foreground">Keep assignment</button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {due_at ? (
          <span className="text-muted-foreground text-xs">{dueInfo!.label}</span>
        ) : (
          <span className="text-muted-foreground text-xs">No due date</span>
        )}
        {points_possible !== null && (
          <span className="inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium whitespace-nowrap bg-surface-subtle border border-border text-muted-foreground">
            {points_possible} pts
          </span>
        )}
        {completed && (
          <span className="inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium whitespace-nowrap bg-success-soft border border-success/30 text-success">
            Completed
          </span>
        )}
        {isDueSoon && (
          <span className="inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium whitespace-nowrap bg-warning-soft border border-warning/30 text-warning">
            Due Soon
          </span>
        )}
        {isOverdue && (
          <span className="inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium whitespace-nowrap bg-danger-soft border border-danger/30 text-danger">
            Overdue
          </span>
        )}
      </div>
    </Card>
  );
}
