import { NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { Database } from "@/database.types";
import { pushSubscribeSchema } from "@/lib/validations";

const ratelimit = new Ratelimit({
  redis: new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  }),
  limiter: Ratelimit.slidingWindow(10, "1 h"),
  prefix: "rl:push:subscribe",
});

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = user.id;

  const { success: rateLimitOk } = await ratelimit.limit(userId);
  if (!rateLimitOk) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429 }
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = pushSubscribeSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 422 });
  }

  const { endpoint, p256dh, auth } = parsed.data;

  const serviceClient = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { cookies: { getAll: () => [], setAll: () => {} } }
  );

  try {
    const { data: existing } = await serviceClient
      .from("push_subscriptions")
      .select("user_id, p256dh, auth")
      .eq("endpoint", endpoint)
      .maybeSingle()
      .throwOnError();

    // An account switch on the same browser may reuse the endpoint, but
    // knowing an endpoint alone must never let someone take over its row.
    if (existing && existing.user_id !== userId &&
        (existing.p256dh !== p256dh || existing.auth !== auth)) {
      return NextResponse.json({ error: "Subscription belongs to another device" }, { status: 409 });
    }

    const subscription = { user_id: userId, endpoint, p256dh, auth };
    if (existing) {
      // Match the observed ownership and keys atomically: concurrent changes
      // must not be overwritten after the ownership check above.
      const { data: updated } = await serviceClient
        .from("push_subscriptions")
        .update(subscription)
        .eq("endpoint", endpoint)
        .eq("user_id", existing.user_id)
        .eq("p256dh", existing.p256dh)
        .eq("auth", existing.auth)
        .select("endpoint")
        .maybeSingle()
        .throwOnError();
      if (!updated) {
        return NextResponse.json({ error: "Subscription changed. Try again." }, { status: 409 });
      }
    } else {
      // INSERT preserves a row created concurrently; UPSERT could take it over.
      await serviceClient.from("push_subscriptions").insert(subscription).throwOnError();
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "23505") {
      return NextResponse.json({ error: "Subscription changed. Try again." }, { status: 409 });
    }
    console.error("Push subscribe error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Unsubscribe: let a user purge their own push rows on demand (previously
// they persisted until a failed send returned 404/410).
export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { success: rateLimitOk } = await ratelimit.limit(user.id);
  if (!rateLimitOk) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = pushSubscribeSchema.partial({ p256dh: true, auth: true }).safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid endpoint" }, { status: 422 });
  }

  try {
    // RLS scopes deletes to the caller's rows.
    await supabase
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", parsed.data.endpoint)
      .throwOnError();
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Push unsubscribe error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
