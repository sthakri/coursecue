import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Auth callback handler for Supabase email confirmation and OAuth flows.
 * Without this route, clicking an email confirmation link silently fails
 * in production — Supabase redirects to /auth/callback?code=... and expects
 * a server-side code exchange before the session cookie is set.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  // Supabase pre-link verification failures (expired/used OTP, scanner
  // pre-clicks) arrive HERE with ?error=...&error_code=otp_expired — before
  // any code exchange. Surface them instead of dead-ending on the homepage.
  if (searchParams.get("error")) {
    console.warn(
      "[auth/callback] link rejected:",
      searchParams.get("error_code"), searchParams.get("error_description"),
    );
    return NextResponse.redirect(new URL("/login?error=link-expired", req.url));
  }

  const code = searchParams.get("code");
  // Allow a custom `next` param for post-auth redirects; default to onboarding.
  // Same-origin paths only — a raw passthrough of `next` is an open redirect.
  let next = searchParams.get("next") ?? "/onboarding";
  try {
    const destination = new URL(next, req.url);
    if (!next.startsWith("/") || destination.origin !== req.nextUrl.origin || destination.username || destination.password) next = "/onboarding";
  } catch { next = "/onboarding"; }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      // Expired/reused link — fail visibly, not as a silent login bounce.
      console.error("[auth/callback] code exchange failed:", error.message);
      return NextResponse.redirect(new URL("/login?error=link-expired", req.url));
    }
    // After the exchange the middleware runs on the redirect and forwards the
    // user to /dashboard if already onboarded, or keeps them at /onboarding.
  }

  return NextResponse.redirect(new URL(next, req.url));
}
