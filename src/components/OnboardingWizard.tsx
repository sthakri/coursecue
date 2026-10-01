"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, CheckCircle, LogOut, Zap } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { env } from "@/lib/env";
import { enablePushNotifications, pushErrorMessage, unsubscribePushDevice } from "@/lib/push";

async function encryptToken(plaintext: string): Promise<string> {
  const res = await fetch("/api/canvas/encrypt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plaintext }),
  });
  const data: { ciphertext?: string; error?: string } = await res.json();
  if (!res.ok || !data.ciphertext) throw new Error(data.error ?? "Encryption failed");
  return data.ciphertext;
}

export default function OnboardingWizard({ userEmail }: { userEmail?: string }) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [domain, setDomain] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [courseCount, setCourseCount] = useState(0);
  const enablingNotifications = useRef(false);

  async function handleSignOut() {
    await unsubscribePushDevice();
    await createClient().auth.signOut({ scope: "global" });
    router.push("/");
  }

  async function handleTestConnection() {
    setLoading(true);
    setError("");
    try {
      const { data: { user } } = await createClient().auth.getUser();
      if (!user) { setError("You must be logged in to connect Canvas."); return; }
      const res = await fetch("/api/canvas/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, domain }) });
      const result: { success: boolean; courseCount: number; error?: string } = await res.json();
      if (!result.success) {
        setError(result.error ?? "Connection failed");
        return;
      }
      const encrypted = await encryptToken(token);
      const { error: upsertError } = await createClient().from("profiles").upsert({ id: user.id, canvas_domain: domain, canvas_token: encrypted, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      if (upsertError) { setError("Connection works, but saving it failed — please try again."); return; }
      setCourseCount(result.courseCount);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed. Check your domain and token.");
    } finally {
      setLoading(false);
    }
  }

  function isIOS(): boolean {
    if (typeof window === "undefined") return false;
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes("Mac") && "ontouchend" in document);
  }

  async function handleEnableNotifications() {
    if (enablingNotifications.current) return;
    enablingNotifications.current = true;
    setLoading(true);
    try {
      const result = await enablePushNotifications(env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
      if (result === "unsupported") {
        toast.info(isIOS() ? "Open DuePulse from your Home Screen to enable notifications (iOS 16.4 or later)." : "Notifications are unavailable in this browser.");
        return;
      }
      if (result === "idle") return;
      if (result === "denied") toast.info("Notifications blocked — enable DuePulse in device settings.");
      else toast.success("Nudges enabled! You'll get timely reminders.");
      setStep(4);
    } catch (error) {
      toast.error(pushErrorMessage(error));
    } finally {
      enablingNotifications.current = false;
      setLoading(false);
    }
  }

  async function handleGoToDashboard() {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("profiles").upsert({ id: user.id, onboarding_complete: true });
      fetch("/api/canvas/sync?source=manual", { method: "POST" });
    }
    router.push("/dashboard");
  }

  const inputCls = "w-full rounded-sm bg-background border border-input text-foreground placeholder:text-muted-foreground text-sm px-4 py-3 focus:outline-none focus:ring-1 focus:ring-ring min-h-11";

  return (
    <div className="w-full max-w-md bg-card rounded-sm border border-border p-6 sm:p-8 shadow-none">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-sm border border-primary/40 bg-primary-soft">
            <Zap size={13} className="text-primary" fill="currentColor" />
          </div>
          <span className="font-bold text-foreground tracking-tight">DuePulse</span>
        </Link>
        <div className="flex items-center gap-3">
          {userEmail && <span className="text-muted-foreground text-xs hidden sm:block truncate max-w-[120px]">{userEmail}</span>}
          <button type="button" disabled={loading} onClick={handleSignOut} className="flex items-center gap-1.5 text-muted-foreground hover:text-danger text-xs transition-colors bg-transparent">
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </div>

      {/* Progress dots */}
      <div className="flex gap-2 justify-center mb-8">
        {[1, 2, 3, 4].map((n) => (
          <div key={n} className={`h-1.5 rounded-full transition-all duration-300 ${n === step ? "bg-primary w-6" : n < step ? "bg-primary-soft w-3" : "bg-muted w-3"}`} />
        ))}
      </div>

      {/* Step 1 */}
      {step === 1 && (
        <div className="space-y-5">
          <div>
            <h1 className="text-foreground font-bold text-2xl">Connect Canvas</h1>
            <p className="text-muted-foreground text-sm mt-1">Link your Canvas account to get started.</p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="domain" className="text-body text-sm block">Canvas Domain</label>
            <input id="domain" type="text" placeholder="yourschool.instructure.com" value={domain} onChange={(e) => setDomain(e.target.value)} className={inputCls} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="token" className="text-body text-sm block">Personal Access Token</label>
            <div className="relative">
              <input id="token" type={showToken ? "text" : "password"} placeholder="••••••••••••••••" value={token} onChange={(e) => setToken(e.target.value)} className={`${inputCls} pr-12`} />
              <button type="button" onClick={() => setShowToken(!showToken)} aria-label={showToken ? "Hide access token" : "Show access token"} className="absolute inset-y-0 right-0 px-3 flex items-center text-muted-foreground hover:text-primary-hover">
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-muted-foreground text-xs">Canvas → Account → Settings → New Access Token</p>
          </div>
          <button type="button" onClick={handleTestConnection} disabled={loading || !domain || !token}
            className="w-full rounded-sm bg-primary hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm py-3 transition-colors shadow-none min-h-11">
            {loading ? "Testing…" : "Test Connection →"}
          </button>
          {error && <p className="text-danger text-sm">{error}</p>}
        </div>
      )}

      {/* Step 2 */}
      {step === 2 && (
        <div className="space-y-5 text-center">
          <CheckCircle className="text-success w-12 h-12 mx-auto" />
          <div>
            <p className="text-foreground font-bold text-xl">Connected to {domain}</p>
            <p className="text-muted-foreground text-sm mt-1">Found {courseCount} course{courseCount !== 1 ? "s" : ""}</p>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => setStep(1)} className="flex-1 rounded-sm border border-border bg-transparent text-muted-foreground hover:text-foreground hover:bg-surface-subtle text-sm font-medium py-3 transition-colors min-h-11">← Back</button>
            <button type="button" onClick={() => setStep(3)} className="flex-[2] rounded-sm bg-primary hover:bg-primary-hover text-white font-semibold text-sm py-3 transition-colors min-h-11">Continue →</button>
          </div>
        </div>
      )}

      {/* Step 3 */}
      {step === 3 && (
        <div className="space-y-5">
          <div>
            <h1 className="text-foreground font-bold text-2xl">Enable Nudges</h1>
            <p className="text-muted-foreground text-sm mt-1">Get timely reminders before assignments are due.</p>
          </div>
          <button type="button" disabled={loading} aria-busy={loading} onClick={handleEnableNotifications} className="w-full rounded-sm bg-primary hover:bg-primary-hover text-white font-semibold text-sm py-3 transition-colors shadow-none min-h-11 disabled:opacity-60">{loading ? "Enabling nudges…" : "Enable Nudges"}</button>
          <div className="flex gap-3">
            <button type="button" disabled={loading} onClick={() => setStep(2)} className="flex-1 rounded-sm border border-border bg-transparent text-muted-foreground hover:text-foreground hover:bg-surface-subtle text-sm font-medium py-3 transition-colors min-h-11">← Back</button>
            <button type="button" disabled={loading} onClick={() => setStep(4)} className="flex-[2] text-muted-foreground hover:text-muted-foreground text-sm py-3 bg-transparent min-h-11 transition-colors">Enable later on Dashboard</button>
          </div>
        </div>
      )}

      {/* Step 4 */}
      {step === 4 && (
        <div className="space-y-5 text-center">
          <div className="text-4xl mb-2">🎉</div>
          <div>
            <h1 className="text-foreground font-bold text-2xl">You&apos;re all set!</h1>
            <p className="text-muted-foreground text-sm mt-1">Your Canvas assignments are syncing in the background.</p>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => setStep(3)} className="flex-1 rounded-sm border border-border bg-transparent text-muted-foreground hover:text-foreground hover:bg-surface-subtle text-sm font-medium py-3 transition-colors min-h-11">← Back</button>
            <button type="button" onClick={handleGoToDashboard} className="flex-[2] rounded-sm bg-primary hover:bg-primary-hover text-white font-semibold text-sm py-3 transition-colors shadow-none min-h-11">Go to Dashboard →</button>
          </div>
        </div>
      )}
    </div>
  );
}
