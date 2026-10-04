"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Zap } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { authErrorMessage } from "@/lib/auth-errors";
import AuthBrandPanel from "@/components/auth/AuthBrandPanel";

type Mode = "signin" | "signup" | "reset";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // Initial value reads the URL once — /auth/callback sends expired/reused
  // email links (confirm & reset) here as /login?error=link-expired.
  const [error, setError] = useState(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("error") === "link-expired"
      ? "That link has expired or was already used — request a new one."
      : ""
  );
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const supabase = createClient();

      if (mode === "reset") {
        // OTP code flow, not a magic link: one-time links get consumed by mail
        // scanners/prefetch before the user clicks (otp_expired), and PKCE
        // code links break when the mail app opens them in a different browser
        // context than the one that requested the reset. A typed 6-digit code
        // has no link to prefetch and no code_verifier to lose.
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email);
        if (resetError) {
          setError(authErrorMessage(resetError, "reset"));
          return;
        }
        router.push(`/reset-password?email=${encodeURIComponent(email)}`);
        return;
      }

      const result =
        mode === "signin"
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password });

      const { error: authError } = result;

      if (authError) {
        setError(authErrorMessage(authError, mode));
        return;
      }

      if (mode === "signup") {
        const { data } = result;
        if (data?.session) {
          router.push("/onboarding");
        } else {
          setError("Check your email for a confirmation link before signing in.");
        }
      } else {
        const supabase = createClient();
        const {
          data: { user: signedInUser },
        } = await supabase.auth.getUser();
        const { data: profile, error: profileError } = signedInUser
          ? await supabase
              .from("profiles")
              .select("onboarding_complete, canvas_token")
              .eq("id", signedInUser.id)
              .maybeSingle()
          : { data: null, error: null };

        if (profileError) { setError("Signed in, but your profile could not load. Please try again."); return; }

        if (profile?.onboarding_complete && profile?.canvas_token) {
          router.push("/dashboard");
        } else {
          router.push("/onboarding");
        }
      }
    } catch (error) {
      setError(authErrorMessage(error, mode));
    } finally {
      setLoading(false);
    }
  }

  const inputCls =
    "rounded-sm border-border bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-ring focus-visible:border-primary/60 h-11";

  return (
    <div className="min-h-screen bg-background flex">
      <AuthBrandPanel />

      {/* ── Right form panel ──────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-10">
        {/* Logo */}
        <div className="w-full max-w-sm mb-8">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-sm border border-primary/40 bg-primary-soft shadow-none">
              <Zap size={14} className="text-primary" fill="currentColor" />
            </div>
            <span className="font-bold text-lg text-foreground tracking-tight">CourseCue</span>
          </Link>
        </div>

        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h1 className="text-foreground font-bold text-2xl mb-1">
              {mode === "signin" ? "Welcome back" : mode === "signup" ? "Create your account" : "Reset your password"}
            </h1>
            <p className="text-muted-foreground text-sm">
              {mode === "signin"
                ? "Sign in to continue to your dashboard."
                : mode === "signup"
                  ? "Start syncing your Canvas deadlines."
                  : "Enter your email and we'll send you a reset code."}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-body text-sm font-medium">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className={inputCls}
              />
            </div>

            {mode !== "reset" && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-body text-sm font-medium">Password</Label>
                  {mode === "signin" && (
                    <button
                      type="button"
                      onClick={() => { setMode("reset"); setError(""); }}
                      className="text-info text-xs hover:text-info-hover transition-colors bg-transparent"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    aria-describedby={mode === "signup" ? "password-help" : undefined}
                    className={`${inputCls} pr-10`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-muted-foreground transition-colors bg-transparent"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            )}

            {mode === "signup" && <p id="password-help" className="text-muted-foreground text-xs">Use at least 8 characters, with uppercase and lowercase letters, a number, and a symbol.</p>}

            {error && (
              <p role="alert" className="text-danger text-sm bg-danger-soft border border-danger/20 rounded-sm px-4 py-3">
                {error}
              </p>
            )}

            <Button
              type="submit"
              id="auth-submit-btn"
              disabled={loading}
              className="w-full h-11 rounded-sm bg-primary hover:bg-primary-hover text-white font-semibold shadow-none transition-all duration-200  disabled:opacity-60"
            >
              {loading ? "Please wait…" : mode === "signin" ? "Sign In" : mode === "signup" ? "Sign Up" : "Send reset code"}
            </Button>
          </form>

          <p className="text-center text-muted-foreground text-sm mt-5">
            {mode === "signin" ? "Don't have an account? " : mode === "signup" ? "Already have an account? " : "Remembered it? "}
            <button
              type="button"
              onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); }}
              className="text-info hover:text-info-hover font-medium transition-colors bg-transparent"
            >
              {mode === "signin" ? "Sign up" : "Sign in"}
            </button>
          </p>

          <div className="text-center mt-6">
            <Link href="/" className="text-info hover:text-info-hover text-sm transition-colors">
              ← Back to homepage
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
