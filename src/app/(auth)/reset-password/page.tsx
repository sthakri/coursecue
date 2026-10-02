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

export default function ResetPasswordPage() {
  const router = useRouter();
  // Login redirects here as /reset-password?email=... after sending the code.
  // Reading location once in an initializer avoids a useSearchParams+Suspense wrapper.
  const [email, setEmail] = useState(() =>
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("email") ?? ""
      : ""
  );
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();

      // The emailed code IS the verification — no link click, no PKCE verifier,
      // so mail-scanner prefetch and cross-browser opens can't break the flow.
      // But verifyOtp CONSUMES the code: if a previous submit verified fine and
      // only the new password failed the strength rules, a recovery session
      // already exists and re-verifying would find the code burned. Skip the
      // verify whenever this browser already holds a session for this email.
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.user?.email?.toLowerCase() !== email.trim().toLowerCase()) {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          email: email.trim(),
          token: code.trim(),
          type: "recovery",
        });

        if (verifyError) {
          setError(authErrorMessage(verifyError, "verify-code"));
          return;
        }
      }

      const { error: updateError } = await supabase.auth.updateUser({ password });

      if (updateError) {
        setError(authErrorMessage(updateError, "update-password"));
        return;
      }

      router.push("/dashboard");
    } catch (error) {
      setError(authErrorMessage(error, "update-password"));
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
            <h1 className="text-foreground font-bold text-2xl mb-1">Reset your password</h1>
            <p className="text-muted-foreground text-sm">
              We emailed you a reset code. Enter it below, then choose a new password.
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
                autoComplete="email"
                className={inputCls}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="code" className="text-body text-sm font-medium">Reset code</Label>
              <Input
                id="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6,8}"
                maxLength={8}
                placeholder="12345678"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                required
                className={`${inputCls} tracking-[0.5em] font-mono`}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-body text-sm font-medium">New password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  aria-describedby="password-help"
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

            <p id="password-help" className="text-muted-foreground text-xs">Use at least 8 characters, with uppercase and lowercase letters, a number, and a symbol.</p>

            <div className="space-y-1.5">
              <Label htmlFor="confirm-password" className="text-body text-sm font-medium">Confirm password</Label>
              <Input
                id="confirm-password"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                className={inputCls}
              />
            </div>

            {error && (
              <p role="alert" className="text-danger text-sm bg-danger-soft border border-danger/20 rounded-sm px-4 py-3">
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 rounded-sm bg-primary hover:bg-primary-hover text-white font-semibold shadow-none transition-all duration-200  disabled:opacity-60"
            >
              {loading ? "Please wait…" : "Verify code & update password"}
            </Button>
          </form>

          <div className="text-center mt-6">
            <Link href="/login" className="text-info hover:text-info-hover text-sm transition-colors">
              ← Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
