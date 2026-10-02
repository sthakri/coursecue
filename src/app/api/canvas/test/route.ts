import { NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { testCanvasConnection } from "@/lib/canvas";
import { canvasTestSchema } from "@/lib/validations";

const ratelimit = new Ratelimit({
  redis: new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  }),
  limiter: Ratelimit.slidingWindow(10, "1 h"),
  prefix: "rl:canvas:test",
});

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { success } = await ratelimit.limit(user.id);
  if (!success) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429 }
    );
  }

  const raw: unknown = await req.json();
  const parsed = canvasTestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid Canvas domain and access token, then try again." }, { status: 422 });
  }

  const { token, domain } = parsed.data;
  const result = await testCanvasConnection(token, domain);
  return NextResponse.json(result);
}
