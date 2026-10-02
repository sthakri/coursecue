import AssignmentCard from "@/components/AssignmentCard";
import { groupAssignments, type AssignmentFilter, type PlannerAssignment } from "@/lib/assignment-view";

export default function AssignmentGroups({ assignments, filter, now, userTz }: {
  assignments: PlannerAssignment[]; filter: AssignmentFilter; now: number; userTz: string;
}) {
  return <div className="space-y-6">{groupAssignments(assignments, filter, now, userTz).map(group => {
    const content = <div className="mt-3 space-y-0">{group.items.map(a => <AssignmentCard key={a.id} id={a.id} title={a.title}
      course_name={a.courses?.name ?? "Unknown course"} due_at={a.due_at} points_possible={a.points_possible}
      canvas_assignment_id={String(a.canvas_assignment_id)} course_color={a.courses?.color ?? "var(--primary)"}
      userTz={userTz} now={now} is_completed={a.is_completed} />)}</div>;
    return group.label === "Older overdue" ? <details key={group.label} className="rounded-sm border border-border bg-surface-subtle p-4">
      <summary className="cursor-pointer font-bold">Older overdue <span className="ml-2 text-muted-foreground">{group.items.length}</span></summary>
      <p className="mt-2 text-sm text-muted-foreground">More than 3 days past due. No further overdue reminders will be sent.</p>{content}
    </details> : <section key={group.label} aria-label={group.label}>
      <h4 className="text-sm font-semibold text-foreground">{group.label} <span className="ml-2 text-muted-foreground">{group.items.length}</span></h4>{content}
    </section>;
  })}</div>;
}
