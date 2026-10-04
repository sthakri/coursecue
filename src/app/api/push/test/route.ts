import { NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { Database } from "@/database.types";
import { sendPushNotification } from "@/lib/webpush";
import { pushTestSchema } from "@/lib/validations";
import webpush from "web-push";

const ratelimit = new Ratelimit({
  redis: new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  }),
  limiter: Ratelimit.slidingWindow(5, "1 m"),
  prefix: "rl:push:test",
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
  const parsed = pushTestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "We couldn't identify this device. Enable notifications again and retry." }, { status: 422 });
  }

  const { endpoint, silent } = parsed.data;

  const serviceClient = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { cookies: { getAll: () => [], setAll: () => {} } }
  );

  const { data: sub, error: lookupError } = await serviceClient
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", userId)
    .eq("endpoint", endpoint)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: "Could not check subscription. Try again later." }, { status: 500 });
  }

  if (!sub) {
    return NextResponse.json({ error: "Subscription not found for this device — re-enable notifications", expired: true }, { status: 404 });
  }

  const subscription: webpush.PushSubscription = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.p256dh, auth: sub.auth },
  };

  try {
    await sendPushNotification(subscription, silent ? "This is a silent test notification." : "This test uses your device’s notification settings.", "CourseCue test", 60, undefined, silent);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number })?.statusCode;
    if (statusCode === 410 || statusCode === 404) {
      await serviceClient.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      return NextResponse.json(
        { error: "Subscription expired — re-enable notifications", expired: true },
        { status: 410 }
      );
    }
    return NextResponse.json({ error: "Push service unreachable — try again later" }, { status: 502 });
  }
}
