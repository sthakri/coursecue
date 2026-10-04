"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { getDeviceSubscription, pushErrorMessage, pushRequest, unsubscribePushDevice, withPushTimeout } from "@/lib/push";

export default function TestNotifButton() {
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);

  async function handleClick(silent: boolean) {
    if (inFlight.current) return;
    if (!("Notification" in window) || Notification.permission !== "granted") {
      toast.info("Enable nudges on this device first.");
      return;
    }
    inFlight.current = true;
    setSending(true);
    try {
      const subscription = await getDeviceSubscription();
      if (!subscription) { toast.error("No push subscription found — enable nudges on this device."); return; }
      const res = await pushRequest("/api/push/test", "POST", { endpoint: subscription.endpoint, silent });
      const data = await withPushTimeout(res.json(), "The server response timed out. Please try again.");
      if (res.ok) {
        toast.success("Test sent to the push service. Check this device’s notifications.");
      } else if (res.status === 410 || (res.status === 404 && data.expired)) {
        await unsubscribePushDevice(subscription.endpoint);
        window.dispatchEvent(new Event("push-subscription-changed"));
        toast.error("Subscription expired — enable nudges again on this device.");
      } else {
        toast.error(data.error ?? "Test notification failed");
      }
    } catch (error) { toast.error(pushErrorMessage(error)); }
    finally { inFlight.current = false; setSending(false); }
  }

  return (
    <div className="flex flex-wrap gap-2" aria-busy={sending}>
      {[false, true].map(silent => (
        <button key={String(silent)} type="button" disabled={sending} onClick={() => handleClick(silent)}
          className="min-h-11 rounded-sm border border-border bg-card px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-input hover:text-foreground disabled:opacity-50">
          {sending ? "Sending…" : silent ? "Send silent test" : "Send test notification"}
        </button>
      ))}
    </div>
  );
}
