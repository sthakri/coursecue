"use client";

import { useEffect } from "react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard error:", error);
  }, [error]);

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 rounded-sm bg-surface-subtle border border-border flex items-center justify-center mb-5 mx-auto">
          <span className="text-2xl">⚠️</span>
        </div>
        <h2 className="text-foreground font-bold text-xl mb-2">Something went wrong</h2>
        <p className="text-muted-foreground text-sm leading-relaxed mb-6">
          {error.message || "An unexpected error occurred. Try refreshing the page."}
        </p>
        <button
          onClick={reset}
          className="rounded-sm bg-primary hover:bg-primary-hover text-white font-semibold text-sm px-5 py-2.5 transition-colors"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
