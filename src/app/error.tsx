"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global error:", error);
  }, [error]);

  return (
    <div className="flex-1 flex items-center justify-center p-6 bg-background min-h-screen">
      <div className="text-center max-w-md">
        <h2 className="text-foreground font-bold text-2xl mb-2">Something went wrong</h2>
        <p className="text-muted-foreground text-sm leading-relaxed mb-6">
          {error.message || "An unexpected error occurred."}
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
