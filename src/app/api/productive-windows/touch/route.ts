import { NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { getLocalHour, getLocalDay } from "@/lib/time";

const ratelimit = new Ratelimit({
  redis: new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  }),
  limiter: Ratelimit.slidingWindow(60, "1 m"),
  prefix: "rl:productive-windows:touch",
});

export async function POST() {
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

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", userId)
    .single();

  if (!profile?.timezone) {
    return NextResponse.json({ error: "User timezone not set" }, { status: 400 });
  }

  const now = new Date();
  const hourOfDay = getLocalHour(now, profile.timezone);
  const dayOfWeek = getLocalDay(now, profile.timezone);

  const { data: pwRow, error: readError } = await supabase
    .from("productive_windows")
    .select("score")
    .eq("user_id", userId)
    .eq("hour_of_day", hourOfDay)
    .eq("day_of_week", dayOfWeek)
    .maybeSingle();

  if (readError) return NextResponse.json({ error: "Could not read activity" }, { status: 503 });

  const newScore = Math.min(((pwRow?.score as number) ?? 0) + 0.01, 1);

  const { error: writeError } = await supabase
    .from("productive_windows")
    .upsert(
      {
        user_id: userId,
        hour_of_day: hourOfDay,
        day_of_week: dayOfWeek,
        score: newScore,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,hour_of_day,day_of_week" }
    );

  if (writeError) return NextResponse.json({ error: "Could not save activity" }, { status: 503 });
  return NextResponse.json({ success: true, score: newScore });
}