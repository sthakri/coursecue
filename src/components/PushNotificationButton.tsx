"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { env } from "@/lib/env";
import { enablePushNotifications, getDeviceSubscription, pushErrorMessage, savePushSubscription, supportsPush } from "@/lib/push";

type PushState = "loading" | "idle" | "requesting" | "subscribed" | "denied" | "unsupported";

export default function PushNotificationButton({ userId }: { userId: string }) {
  const [state, setState] = useState<PushState>("loading");
  const requesting = useRef(false);
  const checkVersion = useRef(0);

  useEffect(() => {
    let mounted = true;
    async function checkSubscription() {
      await Promise.resolve();
      if (requesting.current) return;
      const version = ++checkVersion.current;
      let next: PushState = "idle";
      try {
        if (!supportsPush()) next = "unsupported";
        else if (Notification.permission === "denied") next = "denied";
        else if (Notification.permission === "granted") {
          const subscription = await getDeviceSubscription();
          if (subscription && mounted) {
            await savePushSubscription(subscription, userId);
            next = "subscribed";
          }
        }
      } catch { /* A failed check leaves the enable action available. */ }
      if (mounted && !requesting.current && version === checkVersion.current) setState(next);
    }
    void checkSubscription();
    window.addEventListener("focus", checkSubscription);
    window.addEventListener("push-subscription-changed", checkSubscription);
    return () => {
      mounted = false;
      window.removeEventListener("focus", checkSubscription);
      window.removeEventListener("push-subscription-changed", checkSubscription);
    };
  }, [userId]);

  async function handleClick() {
    if (state !== "idle" || requesting.current) return;
    requesting.current = true;
    checkVersion.current++;
    setState("requesting");
    try {
      const next = await enablePushNotifications(env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, userId);
      setState(next);
      if (next === "subscribed") toast.success("Nudges enabled");
    } catch (error) {
      toast.error(pushErrorMessage(error));
      setState(Notification.permission === "denied" ? "denied" : "idle");
    } finally { requesting.current = false; }
  }

  if (state === "unsupported") return <div role="status" className="text-muted-foreground text-xs">Notifications unavailable in this browser</div>;
  if (state === "denied") return <div role="status" className="text-muted-foreground text-xs">Notifications blocked — enable in device settings</div>;
  if (state === "subscribed") return (
    <span role="status" className="flex items-center gap-1.5 text-success text-sm font-medium">
      <CheckCircle size={15} aria-hidden="true" /> Nudges enabled
    </span>
  );

  const busy = state === "loading" || state === "requesting";
  return (
    <Button
      type="button"
      disabled={busy}
      aria-busy={busy}
      className="bg-card hover:bg-surface-subtle border border-border text-muted-foreground hover:text-foreground rounded-sm h-9 shadow-none text-sm font-medium"
      onClick={handleClick}
    >
      {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
      {state === "loading" ? "Checking nudges…" : state === "requesting" ? "Enabling nudges…" : "Enable Nudges"}
    </Button>
  );
}
