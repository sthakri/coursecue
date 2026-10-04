import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";

// /auth/callback MUST be public: email-confirmation and password-reset links
// hit it precisely when the user has NO session. Gating it previously made
// every email link dead-end at /login with the one-time code lost.
const PUBLIC_PATHS = ["/", "/login", "/features", "/how-it-works", "/install", "/feedback", "/reset-password", "/auth/callback"];

// Exact match or path-segment prefix — NOT raw startsWith, which would also
// expose /login-whatever, /installjunk, /reset-password-2, etc.
function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) =>
    p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(p + "/"),
  );
}

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // A session refresh can set new cookies on supabaseResponse; redirects must
  // carry them along or the refreshed session silently drops.
  function redirectWithCookies(url: URL) {
    const res = NextResponse.redirect(url);
    supabaseResponse.headers
      .getSetCookie()
      .forEach((c) => res.headers.append("Set-Cookie", c));
    return res;
  }

  if (!user && !isPublicPath(pathname) && !pathname.startsWith("/api") && !pathname.startsWith("/_next")) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    return redirectWithCookies(redirectUrl);
  }

  if (user && pathname === "/login") {
    return redirectWithCookies(new URL("/dashboard", request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|workbox-.*|worker-.*|manifest.json|icons|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
