import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TablesInsert } from "@/database.types";
vi.mock("@/lib/env", () => ({ env: {} }));
import { persistSyncPlan } from "@/lib/canvas-sync";

describe("sync preserves a concurrent completion or undo", () => {
  it.each([true, false])("never overwrites a user toggle to %s made after the sync read", async completed => {
    const stored = { id: "row", user_id: "user", is_completed: completed, updated_at: "2026-10-03T19:01:00Z", dismissed_at: null };
    const updates: Record<string, unknown>[] = [];
    const client = { from: () => ({
      upsert: (rows: Record<string, unknown>[]) => ({ throwOnError: async () => { rows.forEach(row => Object.assign(stored, row)); } }),
      update: (values: Record<string, unknown>) => {
        const conditions: Record<string, unknown> = {};
        const query = {
          eq: (key: string, value: unknown) => { conditions[key] = value; return query; },
          is: (key: string, value: unknown) => { conditions[key] = value; return query; },
          throwOnError: async () => {
            updates.push(conditions);
            if (Object.entries(conditions).every(([key, value]) => stored[key as keyof typeof stored] === value)) Object.assign(stored, values);
          },
        };
        return query;
      },
    }) } as unknown as SupabaseClient<Database>;
    const rows: TablesInsert<"assignments">[] = [{ user_id: "user", course_id: "course", canvas_assignment_id: 42, title: "Refreshed title", is_completed: true, updated_at: "2026-10-03T19:02:00Z" }];
    await persistSyncPlan(client, rows, [{ id: "row", canvas_assignment_id: 42, is_completed: false, dismissed_at: null, updated_at: "2026-10-03T19:00:00Z" }]);
    expect(stored.is_completed).toBe(completed);
    expect(stored.updated_at).toBe("2026-10-03T19:01:00Z");
    expect(updates[0].updated_at).toBe("2026-10-03T19:00:00Z");
  });
});
