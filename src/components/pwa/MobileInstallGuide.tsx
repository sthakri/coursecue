"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Smartphone, X } from "lucide-react";

const subscribe = () => () => {};
function needsInstall() {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
    (navigator.userAgent.includes("Mac") && navigator.maxTouchPoints > 1)
    ? !(navigator as Navigator & { standalone?: boolean }).standalone && !window.matchMedia("(display-mode: standalone)").matches
    : false;
}

export default function MobileInstallGuide() {
  const show = useSyncExternalStore(subscribe, needsInstall, () => false);
  const [dismissed, setDismissed] = useState(false);
  if (!show || dismissed) return null;
  return (
    <aside className="mb-5 flex items-start gap-3 rounded-sm border border-info/20 bg-info-soft p-4">
      <Smartphone className="mt-1 shrink-0 text-info" size={20} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">CourseCue on your Home Screen</p>
        <p className="mt-1 text-sm text-muted-foreground">Quick access to your planner, plus notifications on iPhone and iPad.</p>
        <Link href="/install" className="mt-2 inline-flex min-h-10 items-center text-sm font-semibold text-info underline underline-offset-4">See installation steps</Link>
      </div>
      <button type="button" aria-label="Dismiss installation tip" onClick={() => setDismissed(true)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm hover:bg-muted"><X size={18} /></button>
    </aside>
  );
}
