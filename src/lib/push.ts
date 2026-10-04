/**
 * Best-effort push teardown for sign-out. Deletes this device's server-side
 * subscription row (must run BEFORE signOut, while the session is still
 * valid) and unsubscribes the browser so the push service stops delivering.
 * Without this, Web Push keeps working after logout by protocol design and
 * the nudge engine keeps sending to the orphaned row.
 * Never throws: a push failure must not trap a user in their session.
 */
export async function unsubscribePushDevice(expectedEndpoint?: string): Promise<void> {
  // Invalidate pending setup before looking for a subscription: subscribe()
  // may still be pending and return a new device after sign-out begins.
  if (!expectedEndpoint) lifecycle++;
  let matched = false;
  try {
    const sub = await getDeviceSubscription();
    if (expectedEndpoint && sub?.endpoint !== expectedEndpoint) return;
    matched = true;
    if (expectedEndpoint) lifecycle++;
    if (sub) {
      await disposeSubscription(sub);
    }
    // Forget "this browser already synced" markers so a different account
    // signing in on this device doesn't skip its own subscription sync.
  } catch {
    // ponytail: best-effort only — a failed push cleanup must never block
    // sign-out; a leftover row dies on the next send via the 404/410 cleanup.
  } finally { if (!expectedEndpoint || matched) clearPushSyncMarkers(); }
}
const SETUP_TIMEOUT_MS = 15_000;
let lifecycle = 0;
const confirmedEndpoints = new Map<string, string>();

export class PushSetupError extends Error {}

export async function disablePushNotifications(): Promise<void> {
  lifecycle++;
  clearPushSyncMarkers();
  const subscription = await getDeviceSubscription();
  if (!subscription) return;
  await withPushTimeout(subscription.unsubscribe(), "Disabling notifications timed out. Please try again.");
  if (await getDeviceSubscription()) throw new PushSetupError("Notifications are still enabled. Please try again.");
  const response = await pushRequest("/api/push/subscribe", "DELETE", { endpoint: subscription.endpoint });
  if (!response.ok) throw new PushSetupError("This browser stopped notifications, but server cleanup failed. You can retry by enabling and disabling nudges.");
}

export function supportsPush(): boolean {
  return typeof window !== "undefined" && window.isSecureContext !== false &&
    "Notification" in window && "serviceWorker" in navigator && typeof PushManager !== "undefined";
}

// ready never rejects when installation fails. Bound every browser operation
// so a failed worker or push service cannot leave the UI busy indefinitely.
// https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/ready
export async function withPushTimeout<T>(operation: Promise<T>, message: string, timeout = SETUP_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new PushSetupError(message)), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function getDeviceSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator)) return null;
  return withPushTimeout((async () => {
    const registration = await navigator.serviceWorker.getRegistration("/");
    return await registration?.pushManager?.getSubscription() ?? null;
  })(), "Checking notifications timed out. Please try again.");
}

async function getActiveRegistration(): Promise<ServiceWorkerRegistration> {
  return withPushTimeout((async () => {
    let registration = await navigator.serviceWorker.getRegistration("/") ??
      await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
    if (registration.active?.state !== "activated") {
      registration = await navigator.serviceWorker.ready;
    }
    if (!registration.pushManager) throw new PushSetupError("Notifications are unavailable in this browser.");
    return registration;
  })(), "Notification setup timed out. Check your connection and try again.");
}

function syncedEndpoint(userId: string): string | null {
  const confirmed = confirmedEndpoints.get(userId);
  if (confirmed) return confirmed;
  try { return sessionStorage.getItem(`push-synced:${userId}`); } catch { return null; }
}

export function clearPushSyncMarkers(): void {
  confirmedEndpoints.clear();
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith("push-synced:")) sessionStorage.removeItem(key);
    }
  } catch { /* Storage is optional, including in private browsing. */ }
}

export async function pushRequest(path: string, method: "POST" | "DELETE", body: unknown): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SETUP_TIMEOUT_MS);
  try {
    return await fetch(path, {
      method, headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: controller.signal,
    });
  } catch {
    throw new PushSetupError("Could not reach the server. Check your connection and try again.");
  } finally { clearTimeout(timer); }
}

const syncing = new Map<string, Promise<void>>();

async function disposeSubscription(subscription: PushSubscription): Promise<void> {
  // Stop delivery first, even if the server cleanup times out or auth expires.
  await withPushTimeout(subscription.unsubscribe(), "Unsubscribing timed out.").catch(() => {});
  await pushRequest("/api/push/subscribe", "DELETE", { endpoint: subscription.endpoint }).catch(() => {});
}

function assertCurrentSetup(generation: number): void {
  if (generation !== lifecycle) throw new PushSetupError("Notification setup was cancelled. Please try again.");
}

export async function savePushSubscription(subscription: PushSubscription, userId?: string): Promise<void> {
  if (userId && syncedEndpoint(userId) === subscription.endpoint) return;
  const generation = lifecycle;
  const key = `${generation}:${userId ?? "onboarding"}:${subscription.endpoint}`;
  const pending = syncing.get(key);
  if (pending) return pending;
  const operation = (async () => {
    const { endpoint, keys } = subscription.toJSON();
    if (!endpoint || !keys?.p256dh || !keys.auth) throw new PushSetupError("Notification setup is incomplete. Please try again.");
    const response = await pushRequest("/api/push/subscribe", "POST", { endpoint, p256dh: keys.p256dh, auth: keys.auth });
    if (generation !== lifecycle) {
      await disposeSubscription(subscription);
      assertCurrentSetup(generation);
    }
    if (!response.ok) {
      const message = response.status === 401 ? "Your session expired. Sign in again to enable nudges." :
        response.status === 429 ? "Too many attempts. Please try again later." :
        "Could not save notifications. Tap Enable Nudges to retry.";
      throw new PushSetupError(message);
    }
    if (userId) {
      confirmedEndpoints.set(userId, endpoint);
      try { sessionStorage.setItem(`push-synced:${userId}`, endpoint); } catch { /* The server save is authoritative. */ }
    }
  })();
  syncing.set(key, operation);
  try { await operation; } finally { syncing.delete(key); }
}

export async function enablePushNotifications(publicKey: string, userId?: string): Promise<"subscribed" | "denied" | "idle" | "unsupported"> {
  if (!supportsPush()) return "unsupported";
  const generation = lifecycle;
  const raw = atob(publicKey.replace(/-/g, "+").replace(/_/g, "/"));
  const applicationServerKey = Uint8Array.from(raw, (character) => character.charCodeAt(0));
  if (applicationServerKey.length !== 65 || applicationServerKey[0] !== 4) {
    throw new PushSetupError("Push configuration error. Please contact support.");
  }
  // Must execute before any await (including auth/worker calls) to retain
  // Apple's direct user interaction requirement in Home Screen apps.
  // https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
  const permission = Notification.permission === "granted" ? "granted" :
    await withPushTimeout(Notification.requestPermission(), "Notification permission timed out. Please try again.", 60_000);
  if (permission !== "granted") return permission === "denied" ? "denied" : "idle";
  assertCurrentSetup(generation);
  const registration = await getActiveRegistration();
  assertCurrentSetup(generation);
  const existing = await withPushTimeout(registration.pushManager.getSubscription(), "Checking notifications timed out. Please try again.");
  assertCurrentSetup(generation);
  const subscription = existing ?? await withPushTimeout<PushSubscription>(
    registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey }).then(async (created) => {
      if (generation !== lifecycle) {
        await disposeSubscription(created);
        assertCurrentSetup(generation);
      }
      return created;
    }), "Enabling notifications timed out. Please try again.");
  assertCurrentSetup(generation);
  await savePushSubscription(subscription, userId);
  assertCurrentSetup(generation);
  return "subscribed";
}

export function pushErrorMessage(error: unknown): string {
  if (error instanceof PushSetupError) return error.message;
  if (error instanceof Error && error.name === "NotAllowedError") return "Notifications were blocked. Check this app’s notification settings.";
  return "Could not enable notifications. Please try again.";
}
