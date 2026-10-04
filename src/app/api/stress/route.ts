import { NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { getLocalDate, getDayRange, getDefaultTimezone } from "@/lib/time";

const ratelimit = new Ratelimit({
  redis: new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  }),
  limiter: Ratelimit.slidingWindow(20, "1 h"),
  prefix: "rl:stress",
});

export async function GET() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { success } = await ratelimit.limit(user.id);
  if (!success) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429 },
    );
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("timezone, stress_threshold")
    .eq("id", user.id)
    .single();

  if (profileError) return NextResponse.json({ error: "Could not load preferences" }, { status: 503 });

  const userTz = profile?.timezone ?? getDefaultTimezone();

  const now = new Date();
  const fourteenDaysLater = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const { data: assignments, error: assignmentsError } = await supabase
    .from("assignments")
    .select("due_at")
    .eq("user_id", user.id)
    .eq("is_completed", false)
    .is("dismissed_at", null)
    .not("due_at", "is", null)
    .gte("due_at", now.toISOString())
    .lte("due_at", fourteenDaysLater.toISOString())
    .order("due_at", { ascending: true });

  if (assignmentsError) return NextResponse.json({ error: "Could not load workload" }, { status: 503 });

  const totalUpcoming = assignments?.length ?? 0;
  const userThreshold = profile?.stress_threshold ?? 5;

  if (!assignments || totalUpcoming < userThreshold) {
    return NextResponse.json({
      stressLevel: "low",
      pileUpDetected: false,
      peakWindowStart: null,
      peakWindowEnd: null,
      assignmentCount: 0,
      totalUpcoming,
    });
  }

  const dateKeys = getDayRange(now, userTz, 14);
  const dateCounts = new Map<string, number>();
  for (const k of dateKeys) dateCounts.set(k, 0);

  for (const a of assignments) {
    if (!a.due_at) continue;
    const localDate = getLocalDate(new Date(a.due_at), userTz);
    dateCounts.set(localDate, (dateCounts.get(localDate) ?? 0) + 1);
  }

  const dateArray = dateKeys.map((d) => ({ date: d, count: dateCounts.get(d)! }));

  let stressLevel: "low" | "medium" | "high" = "low";
  let pileUpDetected = false;
  let maxWindowCount = 0;
  let peakStartIdx = -1;

  for (let i = 0; i < dateArray.length; i++) {
    let window3Count = 0;
    for (let j = i; j < Math.min(i + 3, dateArray.length); j++) {
      window3Count += dateArray[j].count;
    }

    if (window3Count > maxWindowCount) {
      maxWindowCount = window3Count;
      peakStartIdx = i;
    }

    if (window3Count >= 3 && stressLevel !== "high") {
      stressLevel = "high";
    }

    if (i + 5 <= dateArray.length) {
      let window5Count = 0;
      for (let j = i; j < i + 5; j++) {
        window5Count += dateArray[j].count;
      }
      if (window5Count >= 5) {
        pileUpDetected = true;
      }
    }
  }

  if (stressLevel === "low" && !pileUpDetected) {
    for (const { count } of dateArray) {
      if (count >= 2) {
        stressLevel = "medium";
        break;
      }
    }
  }

  let peakWindowStart: string | null = null;
  let peakWindowEnd: string | null = null;

  if (peakStartIdx >= 0) {
    peakWindowStart = dateKeys[peakStartIdx];
    const endIdx = Math.min(peakStartIdx + 2, dateKeys.length - 1);
    peakWindowEnd = dateKeys[endIdx];
  }

  const result: {
    stressLevel: "low" | "medium" | "high";
    pileUpDetected: boolean;
    peakWindowStart: string | null;
    peakWindowEnd: string | null;
    assignmentCount: number;
    totalUpcoming: number;
  } = {
    stressLevel,
    pileUpDetected,
    peakWindowStart,
    peakWindowEnd,
    assignmentCount: maxWindowCount,
    totalUpcoming,
  };

  return NextResponse.json(result);
}
