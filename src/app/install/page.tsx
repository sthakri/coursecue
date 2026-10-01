"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Share2, ArrowDown, Plus, CheckCircle, Ellipsis, Smartphone, Zap } from "lucide-react";

type Platform = "ios" | "android";

const iosSteps = [
  { icon: Share2, label: "Tap the Share icon at the bottom of Safari" },
  { icon: ArrowDown, label: 'Scroll down and tap "Add to Home Screen"' },
  { icon: Plus, label: 'Tap "Add" in the top-right corner' },
  { icon: CheckCircle, label: "Open DuePulse from your Home Screen — done!" },
];

const androidSteps = [
  { icon: Ellipsis, label: "Tap the three-dot menu in the top-right of Chrome" },
  { icon: ArrowDown, label: '"Add to Home Screen" or "Install app"' },
  { icon: Plus, label: 'Tap "Add" in the dialog that appears' },
  { icon: CheckCircle, label: "Open DuePulse from your Home Screen — done!" },
];

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
    try { sessionStorage.setItem("duepulse_install_bypass", "true"); } catch {}
    router.push("/dashboard");
  }

  if (alreadyInstalled) {
    return (
      <main className="min-h-screen bg-[#0F172A] flex flex-col items-center justify-center px-4 text-[#F8FAFC]">
        <div className="w-16 h-16 rounded-2xl bg-[#10B981]/10 border border-[#10B981]/20 flex items-center justify-center mb-4">
          <CheckCircle className="text-[#10B981] w-8 h-8" />
        </div>
        <h1 className="text-[#F8FAFC] font-bold text-2xl mb-2">You&apos;re already installed</h1>
        <p className="text-[#94A3B8] text-sm mb-6 max-w-xs text-center">DuePulse is running as a Home Screen app on this device.</p>
        <button onClick={handleBypass}
          className="bg-[#6366F1] hover:bg-[#818CF8] text-white text-sm font-semibold px-6 py-3 rounded-xl transition-colors">
          Open Dashboard
        </button>
      </main>
    );
  }

  const steps = platform === "ios" ? iosSteps : androidSteps;

  return (
    <main className="min-h-screen bg-[#0F172A] flex flex-col items-center justify-start px-4 pt-14 pb-10 text-[#F8FAFC]">
      {/* Logo + headline */}
      <div className="flex flex-col items-center text-center mb-8">
        <div className="w-16 h-16 rounded-2xl bg-[#6366F1]/10 border border-[#6366F1]/20 flex items-center justify-center mb-4">
          <Smartphone className="text-[#818CF8] w-8 h-8" />
        </div>
        <div className="flex items-center gap-2 mb-3">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg border border-[#6366F1]/40 bg-[#6366F1]/15">
            <Zap size={11} className="text-[#818CF8]" fill="#818CF8" />
          </div>
          <span className="font-bold text-[#F8FAFC] text-sm tracking-tight">DuePulse</span>
        </div>
        <h1 className="text-[#F8FAFC] font-bold text-2xl leading-tight max-w-xs">
          Add DuePulse to Your Home Screen
        </h1>
        <p className="text-[#94A3B8] text-sm mt-3 max-w-xs leading-relaxed">
          {platform === "ios"
            ? "Push notifications and the full app experience only work when DuePulse is installed as a standalone app."
            : "Push notifications work straight from Chrome — installing to your Home Screen just makes DuePulse feel like a native app."}
        </p>
      </div>

      {/* Platform toggle */}
      <div className="flex items-center gap-1 bg-[#1E293B] border border-[#334155]/70 rounded-xl p-1 mb-6 w-full max-w-xs">
        {(["ios", "android"] as Platform[]).map((p) => (
          <button key={p} onClick={() => setPlatform(p)} aria-pressed={platform === p}
            className={`flex-1 py-2 rounded-[10px] text-sm font-medium transition-all ${platform === p ? "bg-[#6366F1] text-white shadow-[0_4px_12px_rgba(99,102,241,0.3)]" : "text-[#64748B] hover:text-[#94A3B8]"}`}>
            {p === "ios" ? "iOS (Safari)" : "Android (Chrome)"}
          </button>
        ))}
      </div>

      {/* Steps card */}
      <div className="w-full max-w-xs rounded-[18px] bg-[#1E293B] border border-[#334155]/70 p-5 mb-5">
        <p className="text-[#64748B] text-xs font-semibold uppercase tracking-wider mb-4">How to install</p>
        <div className="space-y-4">
          {steps.map((step, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#243044] border border-[#334155] text-[#94A3B8] text-[11px] font-bold shrink-0 mt-0.5">
                {i + 1}
              </span>
              <div className="flex items-center gap-2 min-w-0">
                <step.icon className="text-[#818CF8] w-4 h-4 shrink-0" />
                <p className="text-[#94A3B8] text-sm leading-snug">{step.label}</p>
              </div>
            </div>
          ))}
        </div>
        {platform === "ios" && (
          <p className="text-[#64748B] text-xs leading-relaxed mt-4 pt-4 border-t border-[#334155]/70">
            Web push requires iOS 16.4 or later.
          </p>
        )}
      </div>

      {/* Why it matters */}
      <div className="w-full max-w-xs rounded-[18px] bg-[#6366F1]/6 border border-[#6366F1]/20 p-4 mb-8">
        <p className="text-[#818CF8] text-sm font-semibold mb-1">Why does this matter?</p>
        <p className="text-[#94A3B8] text-sm leading-relaxed">
          {platform === "ios"
            ? "DuePulse\u2019s core feature is nudging you at the right time. Browser tabs can\u2019t deliver background push notifications \u2014 the Home Screen app can."
            : "DuePulse\u2019s core feature is nudging you at the right time. Chrome already delivers them \u2014 the Home Screen app just makes DuePulse feel native."}
        </p>
      </div>

      {/* Bypass */}
      <div className="w-full max-w-xs flex flex-col items-center gap-3">
        <p className="text-[#64748B] text-xs text-center">Already added it? Open DuePulse from your Home Screen icon instead.</p>
        <button onClick={handleBypass}
          className="text-[#64748B] hover:text-[#94A3B8] hover:bg-[#1E293B] text-sm w-full py-2.5 rounded-xl transition-colors bg-transparent border border-[#334155]">
          Continue to Dashboard Anyway
        </button>
      </div>
    </main>
  );
}
