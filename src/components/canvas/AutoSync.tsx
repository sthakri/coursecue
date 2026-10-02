"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useDuePulseStore } from "@/lib/store";

const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const VISIBILITY_COOLDOWN_MS = 5 * 60 * 1000;
const RATE_LIMIT_BACKOFF_MS = 30 * 60 * 1000;

export default function AutoSync() {
  const router = useRouter();
  const setTokenExpired = useDuePulseStore((s) => s.setTokenExpired);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const backoffTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncRef = useRef<number>(0);
  const stoppedRef = useRef(false);

  useEffect(() => {
    function stopPolling() {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    function startPolling() {
      if (stoppedRef.current) return;
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(sync, SYNC_INTERVAL_MS);
    }

    async function sync() {
      if (stoppedRef.current) return;
      try {
        const res = await fetch("/api/canvas/sync?source=auto", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        if (res.status === 401) {
          const data = (await res.json()) as { tokenExpired?: boolean; decryptFailed?: boolean };
          if (data.tokenExpired || data.decryptFailed) {
            setTokenExpired(true);
            stopPolling();
            stoppedRef.current = true;
            console.log("[auto-sync] Canvas auth failed — retrying in 30m so reconnect self-heals");
            // The dashboard layout never remounts on in-app navigation, so a
            // permanent stop here would survive the user reconnecting their
            // token. Retry once after the backoff; success clears everything.
            if (backoffTimeoutRef.current) clearTimeout(backoffTimeoutRef.current);
            backoffTimeoutRef.current = setTimeout(() => {
              stoppedRef.current = false;
              if (!document.hidden) {
                lastSyncRef.current = Date.now();
                sync();
                startPolling();
              }
            }, RATE_LIMIT_BACKOFF_MS);
          }
          return;
        }
        if (res.status === 429) {
          console.warn("[auto-sync] Rate limited (429) — backing off auto-sync");
          stopPolling();
          if (backoffTimeoutRef.current) clearTimeout(backoffTimeoutRef.current);
          backoffTimeoutRef.current = setTimeout(() => {
            if (!stoppedRef.current && !document.hidden) {
              startPolling();
            }
          }, RATE_LIMIT_BACKOFF_MS);
          return;
        }
        if (res.ok) {
          setTokenExpired(false);
          router.refresh();
        }
      } catch {
        // Silent fail - don't bother the user
      }
    }

    function syncWithCooldown() {
      if (stoppedRef.current) return;
      const now = Date.now();
      if (now - lastSyncRef.current >= VISIBILITY_COOLDOWN_MS) {
        lastSyncRef.current = now;
        sync();
      }
    }

    function handleVisibilityChange() {
      if (!document.hidden) {
        if (!stoppedRef.current) {
          syncWithCooldown();
          startPolling();
        }
      } else {
        stopPolling();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    startPolling();
    lastSyncRef.current = Date.now();
    sync();

    return () => {
      stopPolling();
      if (backoffTimeoutRef.current) clearTimeout(backoffTimeoutRef.current);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [router, setTokenExpired]);

  return null;
}
