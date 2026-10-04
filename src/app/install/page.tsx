"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, Smartphone, Zap } from "lucide-react";

import InstallSteps, { type InstallPlatform as Platform } from "@/components/pwa/InstallSteps";

function isStandalone(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  if ((window.navigator as { standalone?: boolean }).standalone === true) return true;
  return window.matchMedia("(display-mode: standalone)").matches;
}

function subscribeToDisplayMode(onChange: () => void) {
  const displayMode = window.matchMedia("(display-mode: standalone)");
  displayMode.addEventListener("change", onChange);
  return () => displayMode.removeEventListener("change", onChange);
}

function getDeviceStatus(): string {
  return `${isStandalone() ? "installed" : "browser"}:${/Android/i.test(navigator.userAgent) ? "android" : "ios"}`;
}

export default function InstallPage() {
  const router = useRouter();
  // Server and first hydration render must agree before reading device APIs.
  const device = useSyncExternalStore(subscribeToDisplayMode, getDeviceStatus, () => "browser:ios");
  const [selectedPlatform, setPlatform] = useState<Platform | null>(null);
  const platform = selectedPlatform ?? (device.endsWith("android") ? "android" : "ios");
  const alreadyInstalled = device.startsWith("installed:");

  function handleBypass() {
    try { sessionStorage.setItem("coursecue_install_bypass", "true"); } catch {}
    router.push("/dashboard");
  }

  if (alreadyInstalled) {
    return (
      <main className="min-h-screen bg-background flex flex-col items-center justify-center px-4 text-foreground">
        <div className="w-16 h-16 rounded-sm bg-success-soft border border-success/20 flex items-center justify-center mb-4">
          <CheckCircle className="text-success w-8 h-8" />
        </div>
        <h1 className="text-foreground font-bold text-2xl mb-2">You&apos;re already installed</h1>
        <p className="text-muted-foreground text-sm mb-6 max-w-md text-center">CourseCue is running as a Home Screen app on this device.</p>
        <button onClick={handleBypass}
          className="bg-primary hover:bg-primary-hover text-white text-sm font-semibold px-6 py-3 rounded-sm transition-colors">
          Open Dashboard
        </button>
      </main>
    );
  }


  return (
    <main className="min-h-screen bg-background flex flex-col items-center justify-start px-4 pt-14 pb-10 text-foreground">
      {/* Logo + headline */}
      <div className="flex flex-col items-center text-center mb-8">
        <div className="w-16 h-16 rounded-sm bg-info-soft border border-info/20 flex items-center justify-center mb-4">
          <Smartphone className="text-info w-8 h-8" />
        </div>
        <div className="flex items-center gap-2 mb-3">
          <div className="flex h-6 w-6 items-center justify-center rounded-sm border border-info/40 bg-info-soft">
            <Zap size={11} className="text-info" fill="currentColor" />
          </div>
          <span className="font-bold text-foreground text-sm tracking-tight">CourseCue</span>
        </div>
        <h1 className="text-foreground font-bold text-2xl leading-tight max-w-md">
          Add CourseCue to Your Home Screen
        </h1>
        <p className="text-muted-foreground text-sm mt-3 max-w-md leading-relaxed">
          {platform === "ios"
            ? "Install for push notifications on iPhone and iPad. Your planner also works in Safari."
            : "Push notifications work straight from Chrome — installing to your Home Screen just makes CourseCue feel like a native app."}
        </p>
      </div>

      {/* Platform toggle */}
      <div className="flex items-center gap-1 bg-card border border-border rounded-sm p-1 mb-6 w-full max-w-md">
        {(["ios", "android"] as Platform[]).map((p) => (
          <button key={p} onClick={() => setPlatform(p)} aria-pressed={platform === p}
            className={`flex-1 py-2 rounded-sm text-sm font-medium transition-all ${platform === p ? "bg-primary text-white shadow-none" : "text-muted-foreground hover:text-muted-foreground"}`}>
            {p === "ios" ? "iOS (Safari)" : "Android (Chrome)"}
          </button>
        ))}
      </div>

      {/* Steps card */}
      <div className="w-full max-w-md rounded-sm bg-card border border-border p-5 mb-5">
        <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider mb-4">How to install</p>
        <InstallSteps platform={platform} />
      </div>

      {/* Why it matters */}
      <div className="w-full max-w-md rounded-sm bg-info-soft border border-info/20 p-4 mb-8">
        <p className="text-info text-sm font-semibold mb-1">Why does this matter?</p>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {platform === "ios"
            ? "CourseCue\u2019s core feature is nudging you at the right time. Browser tabs can\u2019t deliver background push notifications \u2014 the Home Screen app can."
            : "CourseCue\u2019s core feature is nudging you at the right time. Chrome already delivers them \u2014 the Home Screen app just makes CourseCue feel native."}
        </p>
      </div>

      {/* Bypass */}
      <div className="w-full max-w-md flex flex-col items-center gap-3">
        <p className="text-muted-foreground text-xs text-center">Already added it? Open CourseCue from your Home Screen icon instead.</p>
        <button onClick={handleBypass}
          className="text-muted-foreground hover:text-muted-foreground hover:bg-card text-sm w-full py-2.5 rounded-sm transition-colors bg-transparent border border-border">
          Continue in browser
        </button>
      </div>
    </main>
  );
}
