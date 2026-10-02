"use client";

import { useState, useEffect } from "react";
import { AlertTriangle, Info, X } from "lucide-react";
import { useCourseCueStore } from "@/lib/store";

interface StressData { stressLevel: "low" | "medium" | "high"; pileUpDetected: boolean; peakWindowStart: string | null; peakWindowEnd: string | null; assignmentCount: number; totalUpcoming: number }

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function StressAlert({ userId }: { userId: string }) {
  const [data, setData] = useState<StressData | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try { return typeof sessionStorage !== "undefined" && sessionStorage.getItem("stress-alert-dismissed") === "true"; }
    catch { return false; }
  });

  const assignmentsVersion = useCourseCueStore((s) => s.assignmentsVersion);

  useEffect(() => {
    fetch("/api/stress").then((r) => r.json()).then((d) => {
      if (d && typeof d.stressLevel === "string") setData(d);
      else setData(null);
    }).catch(() => setData(null));
    // assignmentsVersion refetches after complete/dismiss — the count shown
    // here must drop as the user works through their list.
  }, [userId, assignmentsVersion]);

  if (!data || data.stressLevel === "low" || dismissed) return null;

  const isSevere = data.stressLevel === "high" || data.pileUpDetected;
  function handleDismiss() {
    setDismissed(true);
    try { sessionStorage.setItem("stress-alert-dismissed", "true"); } catch {}
  }

  const range = data.peakWindowStart && data.peakWindowEnd ? `${formatDate(data.peakWindowStart)} – ${formatDate(data.peakWindowEnd)}` : null;
  const countLabel = `${data.assignmentCount} assignment${data.assignmentCount !== 1 ? "s" : ""}`;

  if (isSevere) {
    const title = data.pileUpDetected ? "Pile-up detected" : "Heavy workload";
    return (
      <div className="rounded-sm bg-warning-soft border border-warning/25 p-4 flex items-start gap-3">
        <AlertTriangle className="text-warning w-5 h-5 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-foreground font-semibold text-sm">{title}</p>
          <p className="text-warning text-sm mt-0.5">{range ? `${countLabel} due between ${range}` : `${countLabel} due soon`}</p>
        </div>
        <button type="button" onClick={handleDismiss} aria-label="Dismiss workload alert" className="text-warning hover:bg-warning/10 transition-colors shrink-0 bg-transparent rounded-sm">
          <X className="w-5 h-5" />
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-sm bg-card border-l-4 border-info border border-border p-4 flex items-start gap-3">
      <Info className="text-info w-5 h-5 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-foreground font-semibold text-sm">Moderate workload</p>
        <p className="text-muted-foreground text-sm mt-0.5">{range ? `${countLabel} due between ${range}` : `${countLabel} due soon`}</p>
      </div>
    </div>
  );
}
