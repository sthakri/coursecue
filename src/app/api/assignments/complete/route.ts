import { NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { completeAssignmentSchema } from "@/lib/validations";

const ratelimit = new Ratelimit({
  redis: new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  }),
  limiter: Ratelimit.slidingWindow(30, "1 m"),
  prefix: "rl:assignments:complete",
});

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { success: rateLimitOk } = await ratelimit.limit(user.id);
  if (!rateLimitOk) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429 }
    );
  }

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = completeAssignmentSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "We couldn't identify that assignment. Refresh the page and try again." },
      { status: 422 }
    );
  }

  const { assignmentId, completed } = parsed.data;

  // RLS enforces user_id match — only the owner's row updates. verify a row
  // actually changed; otherwise the UI would toast success over a no-op.
  const { data, error } = await supabase
    .from("assignments")
    .update({
      is_completed: completed,
      updated_at: new Date().toISOString(),
    })
    .eq("id", assignmentId)
    .select("id");

  if (error) {
    return NextResponse.json({ error: "Failed to update assignment completion status" }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, is_completed: completed });
}
