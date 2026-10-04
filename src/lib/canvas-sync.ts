import { readAllPages } from "@/lib/read-all-pages";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getCanvasAssignments,
  getCanvasCourses,
  CanvasCourse,
  CanvasAuthError,
} from "@/lib/canvas";
import { decryptOrRaw } from "@/lib/crypto";
import { Database, TablesInsert } from "@/database.types";

export type CanvasSyncResult =
  | { ok: true; synced: number }
  | {
      ok: false;
      reason:
        | "not_connected"
        | "decrypt_failed"
        | "token_expired"
        | "canvas_error"
        | "db_error";
      message: string;
    };

type ExistingRow = {
  id: string;
  canvas_assignment_id: number;
  is_completed: boolean;
  dismissed_at: string | null;
  updated_at?: string;
  html_url?: string | null;
};

/**
 * Pure planning step for a sync run (exported for tests):
 * - `rows`: upsert payload. Dismissed records stay stored and hidden so a
 *   later Canvas sync cannot recreate them. Once done (locally or per Canvas),
 *   stays done. When Canvas is what flips an existing row to completed,
 *   updated_at is stamped — the "recently completed" page filter keys off
 *   updated_at, and sync upserts otherwise never touch it.
 */
export function buildSyncPlan(
  assignments: Awaited<ReturnType<typeof getCanvasAssignments>>,
  existingRows: ExistingRow[],
  courseMap: Map<number, string>,
  userId: string,
  nowIso: string,
): { rows: TablesInsert<"assignments">[] } {
  const dismissedIdMap = new Map(
    existingRows
      .filter((r) => r.dismissed_at !== null)
      .map((r) => [r.canvas_assignment_id, r.id])
  );
  const locallyCompletedIds = new Set(
    existingRows
      .filter((r) => r.is_completed)
      .map((r) => r.canvas_assignment_id)
  );

  const existingByCanvasId = new Map(
    existingRows.map((r) => [r.canvas_assignment_id, r])
  );

  const rows = assignments
    .filter((a) => !dismissedIdMap.has(a.canvas_assignment_id))
    .map(({ canvas_course_id, ...a }) => {
      const existing = existingByCanvasId.get(a.canvas_assignment_id);
      // Canvas → completed transition: existing row was open, Canvas now
      // reports submitted. Locally-completed rows skip this — the complete
      // route already stamped updated_at for them.
      const canvasCompleted = a.is_completed && !!existing && !existing.is_completed;
      return {
        ...a,
        is_completed: a.is_completed || locallyCompletedIds.has(a.canvas_assignment_id),
        user_id: userId,
        course_id: courseMap.get(canvas_course_id) ?? "",
        ...(canvasCompleted ? { updated_at: nowIso } : {}),
      };
    })
    .filter((r) => r.course_id !== "");

  // One row per canvas_assignment_id: the whole upsert batch fails with
  // Postgres 21000 if two rows share the unique key, which kills the entire
  // sync. Last write wins, mirroring plain upsert semantics.
  const deduped = [...new Map(rows.map((r) => [r.canvas_assignment_id, r])).values()];

  return { rows: deduped };
}

/**
 * PostgREST bulk upserts insert the union of payload keys and fill keys
 * missing from a row with NULL — not the column default — so one row
 * stamped with updated_at poisons every unstamped row in the same batch
 * (NOT NULL violation kills the whole sync). Send uniform-key batches.
 */
export function partitionForUpsert(rows: TablesInsert<"assignments">[]) {
  const stamped = rows.filter((r) => r.updated_at !== undefined);
  const plain = rows.filter((r) => r.updated_at === undefined);
  return [stamped, plain] as const;
}

/**
 * Sync one user's Canvas assignments into the DB.
 *
 * Shared by /api/canvas/sync (client-triggered) and the scheduled
 * canvas-sync Trigger.dev task, so assignments stay fresh — and nudges
 * keep firing — even when the user never opens the app.
 *
 * Requires a service-role client: it reads canvas_token and writes past RLS.
 */
export async function syncUserCanvas(
  serviceClient: SupabaseClient<Database>,
  userId: string,
): Promise<CanvasSyncResult> {
  // Read Canvas credentials from DB — never from request body.
  const { data: profile, error: profileError } = await serviceClient
    .from("profiles")
    .select("canvas_token, canvas_domain")
    .eq("id", userId)
    .single();

  if (profileError) return { ok: false, reason: "db_error", message: "Could not load your Canvas connection. Try again." };

  if (!profile?.canvas_token || !profile?.canvas_domain) {
    return {
      ok: false,
      reason: "not_connected",
      message: "Canvas not connected. Complete onboarding first.",
    };
  }

  const token = await decryptOrRaw(profile.canvas_token);
  const domain = profile.canvas_domain;

  if (!token) {
    return {
      ok: false,
      reason: "decrypt_failed",
      message:
        "Could not decrypt stored Canvas token. Please reconnect your Canvas account.",
    };
  }

  let assignments: Awaited<ReturnType<typeof getCanvasAssignments>>;
  let courses: Awaited<ReturnType<typeof getCanvasCourses>>;
  try {
    courses = await getCanvasCourses(token, domain);
    assignments = await getCanvasAssignments(token, domain, courses);
  } catch (err) {
    if (err instanceof CanvasAuthError) {
      return {
        ok: false,
        reason: "token_expired",
        message:
          "Canvas token expired — generate a new one in Canvas → Account → Settings → New Access Token and reconnect.",
      };
    }
    const message =
      err instanceof Error ? err.message : "Canvas connection failed";
    console.error("Canvas API error:", message);
    return { ok: false, reason: "canvas_error", message };
  }

  // The UI shows last_synced_at as "Last sync". It must describe data the
  // user can actually see, so stamp only AFTER the writes below succeed —
  // stamping first showed "just now" over stale data when writes failed.
  const stampLastSync = () =>
    serviceClient
      .from("profiles")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("id", userId)
      .throwOnError();

  try {
    if (assignments.length === 0) {
      await stampLastSync();
      return { ok: true, synced: 0 };
    }

    // Build course name map from Canvas API response
    const courseNameMap = new Map(
      courses.map((c: CanvasCourse) => [c.id, c.name])
    );

    const uniqueCourseIds = [...new Set(assignments.map((a) => a.canvas_course_id))];

    await serviceClient
      .from("courses")
      .upsert(
        uniqueCourseIds.map((cid) => ({
          user_id: userId,
          canvas_course_id: cid,
          name: courseNameMap.get(cid) ?? `Course ${cid}`,
        })),
        { onConflict: "user_id,canvas_course_id" }
      )
      .throwOnError();

    const { data: dbCourses } = await serviceClient
      .from("courses")
      .select("id,canvas_course_id")
      .eq("user_id", userId)
      .in("canvas_course_id", uniqueCourseIds)
      .throwOnError();

    const courseMap = new Map(
      (dbCourses ?? []).map((c) => [c.canvas_course_id, c.id])
    );

    // Fetch existing rows so the planner can (a) keep dismissed rows hidden,
    // (b) preserve
    // locally-marked completions Canvas can't see (offline/paper submissions),
    // (d) stamp updated_at when Canvas is what flips a row to completed.
    const existingRows = await readAllPages((from, to) => serviceClient
      .from("assignments")
      .select("id, canvas_assignment_id, is_completed, dismissed_at, updated_at, html_url")
      .eq("user_id", userId).order("id").range(from, to));

    // Upgrade legacy quiz/discussion identities only when the actual Canvas URL matches.
    // This preserves that item's status without borrowing another assignment's state.
    for (const assignment of assignments.filter(a => a.canvas_assignment_id < 0 && a.html_url)) {
      if (existingRows.some(row => row.canvas_assignment_id === assignment.canvas_assignment_id)) continue;
      const legacy = existingRows.find(row => row.canvas_assignment_id > 0 && row.html_url === assignment.html_url);
      if (!legacy) continue;
      await serviceClient.from("assignments").update({ canvas_assignment_id: assignment.canvas_assignment_id })
        .eq("id", legacy.id).eq("user_id", userId).eq("canvas_assignment_id", legacy.canvas_assignment_id)
        .throwOnError();
      legacy.canvas_assignment_id = assignment.canvas_assignment_id;
    }

    const { rows } = buildSyncPlan(
      assignments,
      existingRows ?? [],
      courseMap,
      userId,
      new Date().toISOString()
    );

    await persistSyncPlan(serviceClient, rows, existingRows);

    await stampLastSync();
    // rows written, not raw Canvas count — dismissed-skipped and
    // course-less items were never persisted, so don't claim them.
    return { ok: true, synced: rows.length };
  } catch (err) {
    // Surface the real reason: "Database error" alone made two separate
    // outages undebuggable from the toast alone. PostgREST messages here may
    // name constraints but never include row values or tokens.
    console.error("Supabase sync error:", err);
    return { ok: false, reason: "db_error", message: "Could not save your Canvas sync. Please try again." };
  }
}

/** Metadata refreshes never write a stale local completion value. Canvas completion
 * uses the version read at the start, so a concurrent user toggle wins. */
export async function persistSyncPlan(
  client: SupabaseClient<Database>, rows: TablesInsert<"assignments">[], existingRows: ExistingRow[],
): Promise<void> {
  const existing = new Map(existingRows.map(row => [row.canvas_assignment_id, row]));
  for (let offset = 0; offset < rows.length; offset += 100) {
    const batch = rows.slice(offset, offset + 100);
    const fresh = batch.filter(row => !existing.has(row.canvas_assignment_id));
    for (const group of partitionForUpsert(fresh)) {
      if (group.length) await client.from("assignments").upsert(group,
        { onConflict: "user_id,canvas_assignment_id", ignoreDuplicates: true }).throwOnError();
    }
    const metadata = batch.map(row => {
      const { is_completed, updated_at, ...fields } = row;
      void is_completed; void updated_at;
      return fields;
    });
    await client.from("assignments").upsert(metadata, { onConflict: "user_id,canvas_assignment_id" }).throwOnError();
    const transitions = batch.filter(row => row.updated_at && existing.get(row.canvas_assignment_id)?.updated_at);
    for (let i = 0; i < transitions.length; i += 5) {
      await Promise.all(transitions.slice(i, i + 5).map(row => {
        const before = existing.get(row.canvas_assignment_id)!;
        return client.from("assignments").update({ is_completed: true, updated_at: row.updated_at })
          .eq("id", before.id).eq("user_id", row.user_id).eq("updated_at", before.updated_at!)
          .eq("is_completed", false).is("dismissed_at", null).throwOnError();
      }));
    }
  }
}
