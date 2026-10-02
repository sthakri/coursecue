import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    APP_URL: z.url({ protocol: /^https?$/ }).optional(),
    VERCEL_PROJECT_PRODUCTION_URL: z.string().min(1).optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    CANVAS_PERSONAL_TOKEN: z.string().min(1).optional(),
    CANVAS_DOMAIN: z.string().min(1),
    NIM_API_KEY: z.string().min(1),
    VAPID_PRIVATE_KEY: z.string().min(1),
    CRON_SECRET: z.string().min(1).optional(), // legacy (pre-Trigger.dev cron auth); unused, slated for removal
    UPSTASH_REDIS_REST_URL: z.string().url(),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
    TRIGGER_SECRET_KEY: z.string().min(1),
    // 44-char padded base64 that decodes to exactly 32 bytes (AES-256 key).
    // Format pinned; crypto.ts key derivation must stay byte-stable or all
    // stored Canvas tokens become undecryptable.
    ENCRYPTION_KEY: z.string().regex(/^[A-Za-z0-9+/]{43}=$/, "ENCRYPTION_KEY must be 32 bytes, base64-encoded (e.g. `openssl rand -base64 32`)"),
    NUDGE_ENABLED: z.enum(["true", "false"]).default("false"),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    NIM_BASE_URL: z.string().url().default("https://integrate.api.nvidia.com/v1"),
    NIM_MODEL: z.string().min(1).default("mistralai/mistral-nemotron"),
  },
  client: {
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().min(1),
    NEXT_PUBLIC_APP_ENV: z.enum(["development", "production", "test"]).default("development"),
  },
  runtimeEnv: {
    APP_URL: process.env.APP_URL,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    CANVAS_PERSONAL_TOKEN: process.env.CANVAS_PERSONAL_TOKEN,
    CANVAS_DOMAIN: process.env.CANVAS_DOMAIN,
    NIM_API_KEY: process.env.NIM_API_KEY,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    CRON_SECRET: process.env.CRON_SECRET,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    TRIGGER_SECRET_KEY: process.env.TRIGGER_SECRET_KEY,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    NUDGE_ENABLED: process.env.NUDGE_ENABLED,
    NODE_ENV: process.env.NODE_ENV,
    NIM_BASE_URL: process.env.NIM_BASE_URL,
    NIM_MODEL: process.env.NIM_MODEL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    NEXT_PUBLIC_APP_ENV: process.env.NODE_ENV,
  },
});
