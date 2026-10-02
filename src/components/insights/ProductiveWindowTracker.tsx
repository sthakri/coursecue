"use client";

import { useEffect } from "react";

export default function ProductiveWindowTracker() {
  useEffect(() => {
    let mounted = true;

    async function touch() {
      if (!mounted || document.hidden) return;
      try {
        await fetch("/api/productive-windows/touch", {
          method: "POST",
          credentials: "same-origin",
        });
      } catch {
        // Silently fail - this is background telemetry
      }
    }

    touch();
    const interval = setInterval(touch, 5 * 60 * 1000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return null;
}