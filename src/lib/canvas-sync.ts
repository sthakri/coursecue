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
};

/**
 * Pure planning step for a sync run (exported for tests):
 * - `rows`: upsert payload. Dismissed rows are excluded (kept hidden or
 *   deleted below). Sticky completion: once done (locally or per Canvas),
 *   stays done. When Canvas is what flips an existing row to completed,
 *   updated_at is stamped — the "recently completed" page filter keys off
 *   updated_at, and sync upserts otherwise never touch it.
 * - `toDeleteIds`: dismissed rows Canvas now reports submitted — the user
 *   dismissed them and Canvas is source of truth, so drop them entirely.
 */
export function buildSyncPlan(
  assignments: Awaited<ReturnType<typeof getCanvasAssignments>>,
  existingRows: ExistingRow[],
  courseMap: Map<number, string>,
  userId: string,
  nowIso: string,
): { rows: TablesInsert<"assignments">[]; toDeleteIds: string[] } {
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

  const toDeleteIds: string[] = [];
  for (const a of assignments) {
    if (a.is_completed && dismissedIdMap.has(a.canvas_assignment_id)) {
      toDeleteIds.push(dismissedIdMap.get(a.canvas_assignment_id)!);
    }
  }

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

  return { rows: deduped, toDeleteIds };
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
  const { data: profile } = await serviceClient
    .from("profiles")
    .select("canvas_token, canvas_domain")
    .eq("id", userId)
    .single();

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
    [assignments, courses] = await Promise.all([
      getCanvasAssignments(token, domain),
      getCanvasCourses(token, domain),
    ]);
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
    // (b) delete dismissed rows Canvas now reports submitted, (c) preserve
    // locally-marked completions Canvas can't see (offline/paper submissions),
    // (d) stamp updated_at when Canvas is what flips a row to completed.
    const incomingCanvasIds = assignments.map((a) => a.canvas_assignment_id);
    const { data: existingRows } = await serviceClient
      .from("assignments")
      .select("id, canvas_assignment_id, is_completed, dismissed_at")
      .eq("user_id", userId)
      .in("canvas_assignment_id", incomingCanvasIds)
      .throwOnError();

    const { rows, toDeleteIds } = buildSyncPlan(
      assignments,
      existingRows ?? [],
      courseMap,
      userId,
      new Date().toISOString()
    );

    if (toDeleteIds.length > 0) {
      await serviceClient
        .from("assignments")
        .delete()
        .in("id", toDeleteIds)
        .throwOnError();
    }

    if (rows.length > 0) {
      for (const batch of partitionForUpsert(rows)) {
        if (batch.length === 0) continue;
        await serviceClient
          .from("assignments")
          .upsert(batch, { onConflict: "user_id,canvas_assignment_id" })
          .throwOnError();
      }
    }

    await stampLastSync();
    // rows written, not raw Canvas count — dismissed-skipped and
    // course-less items were never persisted, so don't claim them.
    return { ok: true, synced: rows.length };
  } catch (err) {
    // Surface the real reason: "Database error" alone made two separate
    // outages undebuggable from the toast alone. PostgREST messages here may
    // name constraints but never include row values or tokens.
    const detail = err instanceof Error ? err.message : String(err);
    console.error("Supabase sync error:", err);
    return { ok: false, reason: "db_error", message: `Database error: ${detail}` };
  }
}
