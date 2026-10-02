import { headers } from "next/headers";
import { env } from "@/lib/env";

/** Prefer the canonical origin so preview deployments don't publish preview links. */
export async function getSiteUrl(): Promise<string> {
  if (env.APP_URL) return new URL(env.APP_URL).origin;
  if (env.VERCEL_PROJECT_PRODUCTION_URL) {
    return new URL(`https://${env.VERCEL_PROJECT_PRODUCTION_URL}`).origin;
  }

  // Local and non-Vercel hosts derive their origin from the actual request.
  const requestHeaders = await headers();
  const host = requestHeaders.get("host");
  if (!host) throw new Error("Cannot determine the site URL; configure APP_URL.");
  const protocol = requestHeaders.get("x-forwarded-proto") === "http" ? "http" : "https";
  return new URL(`${protocol}://${host}`).origin;
}
