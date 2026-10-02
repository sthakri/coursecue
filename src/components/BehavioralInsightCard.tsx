"use client";

import type { MLInsights } from "@/lib/ml";

interface Props { insights: MLInsights; activeSlots: number }

const CONFIDENCE_COLORS: Record<string, { dot: string; badge: string; bar: string }> = {
  high: { dot: "bg-success", badge: "text-success", bar: "bg-success" },
  medium: { dot: "bg-info", badge: "text-info", bar: "bg-info" },
  low: { dot: "bg-muted-foreground", badge: "text-muted-foreground", bar: "bg-muted-foreground" },
};

export default function BehavioralInsightCard({ insights, activeSlots }: Props) {
  const { patterns, persona, topFocusBlock, bestDayLabels } = insights;

  if (activeSlots < 3) {
    const pct = Math.min((activeSlots / 3) * 100, 100);
    return (
      <div className="rounded-sm bg-card border border-border p-5">
        <h2 className="text-foreground font-semibold text-sm flex items-center gap-2">🧠 Your Focus Windows</h2>
        <p className="text-muted-foreground text-sm mt-2">DuePulse is learning your patterns. Use the app at a few different times of day to unlock your focus profile.</p>
        <div className="mt-4">
          <div className="w-full h-1.5 bg-surface-subtle rounded-full overflow-hidden">
            <div className="h-full bg-info rounded-full transition-all" style={{ width: `${Math.max(pct, 4)}%` }} />
          </div>
          <p className="text-muted-foreground text-xs mt-1.5">{activeSlots} of 3 active time slots tracked</p>
        </div>
      </div>
    );
  }

  const maxScore = Math.max(...patterns.map((p) => p.avgScore), 0.01);
  const topThree = patterns.slice(0, 3);

  return (
    <div className="rounded-sm bg-card border border-border p-5">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h2 className="text-foreground font-semibold text-sm">Your Focus Windows</h2>
        {persona && (
          <span className="inline-flex items-center gap-1 rounded-full bg-info-soft border border-info/20 px-2.5 py-1 text-xs font-medium text-info shrink-0">
            {persona.emoji} {persona.label}
          </span>
        )}
      </div>

      {persona && <p className="text-muted-foreground text-xs mb-4">{persona.description}</p>}

      {topFocusBlock && (
        <div className="mb-4 rounded-sm bg-surface-subtle border border-info/15 p-3">
          <p className="text-info text-xs font-semibold uppercase tracking-wider">Power Block</p>
          <p className="text-foreground font-semibold text-sm mt-0.5">{topFocusBlock.label}</p>
        </div>
      )}

      <div className="space-y-2.5">
        {topThree.map((p) => {
          const colors = CONFIDENCE_COLORS[p.confidence];
          const barWidth = (p.avgScore / maxScore) * 100;
          return (
            <div key={p.hour} className="flex items-center gap-2.5">
              <span className="text-muted-foreground text-xs w-14 shrink-0">{p.label}</span>
              <div className="flex-1 h-1.5 bg-surface-subtle rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${colors.bar}`} style={{ width: `${Math.max(barWidth, 4)}%` }} />
              </div>
              <span className={`text-xs font-medium w-12 text-right shrink-0 ${colors.badge}`}>
                {p.confidence.charAt(0).toUpperCase() + p.confidence.slice(1)}
              </span>
            </div>
          );
        })}
      </div>

      {bestDayLabels.length > 0 && (
        <p className="text-muted-foreground text-xs mt-4">Most active: {bestDayLabels.join(", ")}</p>
      )}
    </div>
  );
}
