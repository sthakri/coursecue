import { describe, it, expect, vi } from "vitest";

// canvas-sync imports crypto → env, which validates process.env at import
// time. buildSyncPlan is pure, so stub env out (same pattern as crypto.test).
vi.mock("@/lib/env", () => ({ env: {} }));

import { buildSyncPlan, partitionForUpsert } from "@/lib/canvas-sync";

const NOW = "2026-09-11T12:00:00.000Z";
const USER = "user-1";

type Incoming = Parameters<typeof buildSyncPlan>[0][number];
type Existing = Parameters<typeof buildSyncPlan>[1][number];

function incoming(partial: Partial<Incoming> & { canvas_assignment_id: number }): Incoming {
  return {
    title: "HW",
    due_at: "2026-09-12T12:00:00.000Z",
    points_possible: 10,
    html_url: null,
    submission_types: ["online_upload"],
    is_completed: false,
    priority: 3,
    canvas_course_id: 100,
    ...partial,
  };
}

function existing(partial: Partial<Existing> & { canvas_assignment_id: number }): Existing {
  return { id: `row-${partial.canvas_assignment_id}`, is_completed: false, dismissed_at: null, ...partial };
}

const courseMap = new Map([[100, "db-course-1"]]);

describe("buildSyncPlan", () => {
  it("stamps updated_at when Canvas flips an existing row to completed", () => {
    const { rows } = buildSyncPlan(
      [incoming({ canvas_assignment_id: 1, is_completed: true })],
      [existing({ canvas_assignment_id: 1, is_completed: false })],
      courseMap,
      USER,
      NOW
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].is_completed).toBe(true);
    expect(rows[0].updated_at).toBe(NOW);
  });

  it("does not restamp updated_at for rows Canvas already completed before (and locally)", () => {
    const { rows } = buildSyncPlan(
      [incoming({ canvas_assignment_id: 1, is_completed: true })],
      [existing({ canvas_assignment_id: 1, is_completed: true })],
      courseMap,
      USER,
      NOW
    );
    expect(rows[0].updated_at).toBeUndefined();
  });

  it("keeps local completion sticky when Canvas reports incomplete (offline submissions)", () => {
    const { rows } = buildSyncPlan(
      [incoming({ canvas_assignment_id: 1, is_completed: false })],
      [existing({ canvas_assignment_id: 1, is_completed: true })],
      courseMap,
      USER,
      NOW
    );
    expect(rows[0].is_completed).toBe(true);
    expect(rows[0].updated_at).toBeUndefined();
  });

  it("deletes dismissed rows that Canvas now reports submitted", () => {
    const { rows, toDeleteIds } = buildSyncPlan(
      [incoming({ canvas_assignment_id: 1, is_completed: true })],
      [existing({ canvas_assignment_id: 1, dismissed_at: NOW })],
      courseMap,
      USER,
      NOW
    );
    expect(rows).toHaveLength(0);
    expect(toDeleteIds).toEqual(["row-1"]);
  });

  it("keeps dismissed-but-still-incomplete rows hidden (no re-upsert, no delete)", () => {
    const { rows, toDeleteIds } = buildSyncPlan(
      [incoming({ canvas_assignment_id: 1, is_completed: false })],
      [existing({ canvas_assignment_id: 1, dismissed_at: NOW })],
      courseMap,
      USER,
      NOW
    );
    expect(rows).toHaveLength(0);
    expect(toDeleteIds).toHaveLength(0);
  });

  it("drops rows whose course failed to upsert (no DB course id)", () => {
    const { rows } = buildSyncPlan(
      [incoming({ canvas_assignment_id: 1, canvas_course_id: 999 })],
      [],
      courseMap,
      USER,
      NOW
    );
    expect(rows).toHaveLength(0);
  });

  it("keeps one row per canvas_assignment_id (Pg 21000 would fail the whole upsert batch)", () => {
    const { rows } = buildSyncPlan(
      [
        incoming({ canvas_assignment_id: 1, title: "first" }),
        incoming({ canvas_assignment_id: 1, title: "second" }),
      ],
      [],
      courseMap,
      USER,
      NOW
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("second"); // last write wins
  });
});

describe("partitionForUpsert", () => {
  it("splits mixed plans into uniform-key batches (PostgREST missing=null violated NOT NULL on updated_at)", () => {
    // Real prod failure shape: one Canvas-completed transition (stamped
    // updated_at) upserted alongside plain rows. PostgREST inserts the
    // union of payload keys and fills missing keys with NULL — not the
    // column default — so the plain rows got updated_at NULL and the
    // whole sync died with 23502.
    const { rows } = buildSyncPlan(
      [
        incoming({ canvas_assignment_id: 1, is_completed: true }),
        incoming({ canvas_assignment_id: 2 }),
      ],
      [existing({ canvas_assignment_id: 1, is_completed: false })],
      courseMap,
      USER,
      NOW
    );
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r.updated_at !== undefined)).toBe(true);

    const [stamped, plain] = partitionForUpsert(rows);

    // every batch must carry one uniform key set; the stamp must be the
    // only difference between the two batches
    const keySets = (batch: typeof rows) => [
      ...new Set(batch.map((r) => Object.keys(r).sort().join(","))),
    ];
    expect(keySets(stamped)).toHaveLength(1);
    expect(keySets(plain)).toHaveLength(1);
    expect(keySets(stamped)[0]).toContain("updated_at");
    expect(keySets(plain)[0]).not.toContain("updated_at");

    // nothing lost, nothing duplicated; only the transition is stamped
    expect(stamped.length + plain.length).toBe(rows.length);
    expect(stamped.map((r) => r.canvas_assignment_id)).toEqual([1]);
    expect(plain.map((r) => r.canvas_assignment_id)).toEqual([2]);
    expect(stamped[0].updated_at).toBe(NOW);
    expect(plain[0].updated_at).toBeUndefined();
  });
});
