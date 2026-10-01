import { beforeEach, describe, expect, it, vi } from "vitest";
import { pushSubscribeSchema, pushTestSchema } from "@/lib/validations";

const push = vi.hoisted(() => ({ setVapidDetails: vi.fn(), sendNotification: vi.fn() }));
vi.mock("web-push", () => ({ default: push }));
vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_VAPID_PUBLIC_KEY: "test-public-key", VAPID_PRIVATE_KEY: "test-private-key" },
}));
import { sendPushNotification } from "@/lib/webpush";

const keys = { p256dh: "device-key", auth: "device-auth" };
const allowed = [
  "https://fcm.googleapis.com/fcm/send/device",
  "https://android.googleapis.com/gcm/send/device",
  "https://push.apple.com/device",
  "https://web.push.apple.com/device",
  "https://push.services.mozilla.com/wpush/device",
  "https://updates.push.services.mozilla.com/wpush/device",
  "https://updates-123.push.services.mozilla.com/wpush/device",
  "https://notify.windows.com/w/?token=device",
  "https://wns2-db5p.notify.windows.com/w/?token=device",
  "https://fcm.googleapis.com:443/fcm/send/device",
];
const disallowed = [
  "http://fcm.googleapis.com/fcm/send/device",
  "https://localhost/device",
  "https://127.0.0.1/device",
  "https://10.0.0.1/device",
  "https://169.254.169.254/latest/meta-data",
  "https://[::1]/device",
  "https://[fd00::1]/device",
  "https://example.com/device",
  "https://user:password@fcm.googleapis.com/fcm/send/device",
  "https://fcm.googleapis.com:8443/fcm/send/device",
  "https://fcm.googleapis.com.attacker.example/device",
  "https://evilfcm.googleapis.com/device",
  "https://push.apple.com.attacker.example/device",
  "https://evilpush.apple.com/device",
  "https://evilpush.services.mozilla.com/device",
  "https://evilnotify.windows.com/device",
  "https:////fcm.googleapis.com/fcm/send/device",
  "https:/fcm.googleapis.com/fcm/send/device",
  "https://fcm.googleapis.com\\@127.0.0.1/private",
  "https://fcm.googleapis.\tcom/fcm/send/device",
];

describe("push endpoint trust boundary", () => {
  it.each(allowed)("accepts official push service endpoint %s", (endpoint) => {
    expect(pushSubscribeSchema.safeParse({ endpoint, ...keys }).success).toBe(true);
    expect(pushTestSchema.safeParse({ endpoint }).success).toBe(true);
  });

  it.each(disallowed)("rejects untrusted push endpoint %s", (endpoint) => {
    expect(pushSubscribeSchema.safeParse({ endpoint, ...keys }).success).toBe(false);
    expect(pushTestSchema.safeParse({ endpoint }).success).toBe(false);
  });
});

describe("stored push subscription sends", () => {
  beforeEach(() => { push.sendNotification.mockClear(); push.sendNotification.mockResolvedValue(undefined); });

  it("rejects an unsafe stored endpoint before making an outbound request", async () => {
    await expect(sendPushNotification({ endpoint: "https://127.0.0.1/private", keys }, "Reminder"))
      .rejects.toThrow();
    expect(push.sendNotification).not.toHaveBeenCalled();
  });

  it("sends a valid vendor subscription with the requested payload and TTL", async () => {
    const subscription = { endpoint: allowed[0], keys };
    await sendPushNotification(subscription, "Reminder", "DuePulse", 3600);
    expect(push.sendNotification).toHaveBeenCalledWith(
      subscription, JSON.stringify({ title: "DuePulse", body: "Reminder" }), { TTL: 3600 },
    );
  });
});
