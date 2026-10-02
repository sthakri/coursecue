"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { getDeviceSubscription, pushErrorMessage, pushRequest, unsubscribePushDevice, withPushTimeout } from "@/lib/push";

export default function TestNotifButton() {
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);

  async function handleClick() {
    if (inFlight.current) return;
    if (!("Notification" in window) || Notification.permission !== "granted") {
      toast.info("Enable nudges on the Dashboard first.");
      return;
    }
    inFlight.current = true;
    setSending(true);
    try {
      const subscription = await getDeviceSubscription();
      if (!subscription) { toast.error("No push subscription found — enable nudges on the Dashboard."); return; }
      const res = await pushRequest("/api/push/test", "POST", { endpoint: subscription.endpoint });
      const data = await withPushTimeout(res.json(), "The server response timed out. Please try again.");
      if (res.ok) {
        toast.success("Test notification sent!");
      } else if (res.status === 410 || (res.status === 404 && data.expired)) {
        await unsubscribePushDevice(subscription.endpoint);
        window.dispatchEvent(new Event("push-subscription-changed"));
        toast.error("Subscription expired — enable nudges again on the Dashboard.");
      } else {
        toast.error(data.error ?? "Test notification failed");
      }
    } catch (error) { toast.error(pushErrorMessage(error)); }
    finally { inFlight.current = false; setSending(false); }
  }

  return (
    <div className="relative">
      <button
        type="button"
        disabled={sending}
        aria-busy={sending}
        onClick={handleClick}
        className="flex items-center gap-1.5 rounded-sm border border-border bg-card text-muted-foreground hover:text-muted-foreground hover:border-input text-xs px-3 py-1.5 transition-colors"
      >
        {sending ? "Sending…" : "Test Notif"}
      </button>
    </div>
  );
}
