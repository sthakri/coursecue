"use client";

import { useState } from "react";
import { Smartphone, Share2, ArrowDown, Plus, CheckCircle, Ellipsis, X } from "lucide-react";

type Platform = "ios" | "android" | null;

const iosSteps = [
  { icon: Share2, label: "Tap the share icon at the bottom of Safari" },
  { icon: ArrowDown, label: "Scroll down and tap Add to Home Screen" },
  { icon: Plus, label: "Tap Add in the top right corner" },
  { icon: CheckCircle, label: "Open CourseCue from your home screen" },
];

const androidSteps = [
  { icon: Ellipsis, label: "Tap the three dots in the top right of Chrome" },
  { icon: ArrowDown, label: "Tap Add to Home Screen" },
  { icon: Plus, label: "Tap Add in the bottom right" },
  { icon: CheckCircle, label: "Open CourseCue from your home screen" },
];

function detectPlatform(): Platform {
  if (typeof navigator === "undefined" || typeof window === "undefined") return null;
  if ((window.navigator as { standalone?: boolean }).standalone === true) return null;
  const ua = navigator.userAgent;
  // iPadOS 13+ reports "Mac" UA — treat touch-capable Macs as iOS.
  if (/iPhone|iPad|iPod/.test(ua) || (ua.includes("Mac") && "ontouchend" in document)) return "ios";
  if (/Android/.test(ua)) return "android";
  return null;
}

export default function MobileInstallGuide() {
  const [dismissed, setDismissed] = useState(() => {
    try { return typeof sessionStorage !== "undefined" && sessionStorage.getItem("coursecue_install_dismissed") === "true"; }
    catch { return false; }
  });
  const [expanded, setExpanded] = useState(false);

  const platform = detectPlatform();
  if (!platform || dismissed) return null;

  const steps = platform === "ios" ? iosSteps : androidSteps;
  const osName = platform === "ios" ? "iOS" : "Android";

  function handleDismiss() {
    setDismissed(true);
    try { sessionStorage.setItem("coursecue_install_dismissed", "true"); } catch {}
  }

  return (
    <div className="rounded-sm bg-info-soft border border-info/20 p-4 mb-5 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <Smartphone className="text-info w-5 h-5 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-foreground font-semibold text-sm">Add CourseCue to your Home Screen</p>
          <p className="text-muted-foreground text-xs mt-0.5 leading-relaxed">
            Get push notifications and fast access from your Home Screen — works best as a standalone app on {osName}.
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setExpanded(!expanded)}
            className="text-info hover:text-info-hover text-xs font-medium bg-transparent px-2 py-1 rounded-sm hover:bg-info-soft transition-colors">
            {expanded ? "Hide" : "How?"}
          </button>
          <button type="button" onClick={handleDismiss} className="text-muted-foreground hover:text-muted-foreground transition-colors bg-transparent p-1" title="Dismiss">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="ml-8 space-y-3 pt-1">
          {steps.map((s, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-surface-subtle border border-border text-muted-foreground text-[10px] font-bold shrink-0 mt-0.5">
                {i + 1}
              </span>
              <div className="flex items-center gap-2 min-w-0">
                <s.icon className="text-info w-4 h-4 shrink-0" />
                <p className="text-muted-foreground text-xs leading-snug">{s.label}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
