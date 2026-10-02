import { NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { createClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { z } from "zod";

const ratelimit = new Ratelimit({
  redis: new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  }),
  limiter: Ratelimit.slidingWindow(10, "1 h"),
  prefix: "rl:canvas:encrypt",
});

const encryptBodySchema = z.object({
  plaintext: z.string().min(1).max(1024),
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

  const raw: unknown = await req.json();
  const result = encryptBodySchema.safeParse(raw);
  if (!result.success) {
    return NextResponse.json({ error: "Enter your Canvas access token and try again." }, { status: 422 });
  }

  const ciphertext = await encrypt(result.data.plaintext);
  return NextResponse.json({ ciphertext });
}
