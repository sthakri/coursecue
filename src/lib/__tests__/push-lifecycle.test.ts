import { afterEach, describe, expect, it, vi } from "vitest";
import { clearPushSyncMarkers, enablePushNotifications, savePushSubscription, unsubscribePushDevice } from "@/lib/push";

const publicKey = Buffer.from([4, ...Array<number>(64).fill(1)]).toString("base64url");

function setup() {
  let current: ReturnType<typeof makeSubscription> | null = null;
  function makeSubscription(endpoint = "https://fcm.googleapis.com/device-a") {
    return { endpoint, toJSON: () => ({ endpoint, keys: { p256dh: "key", auth: "auth" } }),
      unsubscribe: vi.fn(async () => { if (current?.endpoint === endpoint) current = null; return true; }) };
  }
  const subscription = makeSubscription();
  const registration = {
    active: { state: "activated" },
    pushManager: { getSubscription: vi.fn(async () => current), subscribe: vi.fn(async () => { current = subscription; return subscription; }) },
  };
  const notification = { permission: "default", requestPermission: vi.fn().mockResolvedValue("granted") };
  vi.stubGlobal("Notification", notification);
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("window", { Notification: notification, isSecureContext: true });
  vi.stubGlobal("navigator", { serviceWorker: { getRegistration: vi.fn(async () => registration), ready: Promise.resolve(registration) } });
  vi.stubGlobal("sessionStorage", { length: 0, getItem: vi.fn(() => null), setItem: vi.fn(), key: vi.fn() });
  const fetchMock = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchMock);
  return { registration, subscription, notification, fetchMock, makeSubscription, setCurrent: (sub: typeof current) => { current = sub; }, getCurrent: () => current };
}

async function settle() { for (let i = 0; i < 15; i++) await Promise.resolve(); }
afterEach(() => { clearPushSyncMarkers(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("push device lifecycle", () => {
  it("requests permission before any asynchronous browser work", async () => {
    const browser = setup();
    const enabling = enablePushNotifications(publicKey);
    expect(browser.notification.requestPermission).toHaveBeenCalled();
    await enabling;
  });

  it("cancels first-time setup on sign-out and disposes a late subscription", async () => {
    const browser = setup();
    let resolve!: (subscription: typeof browser.subscription) => void;
    browser.registration.pushManager.subscribe.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const enabling = enablePushNotifications(publicKey);
    const outcome = enabling.catch(() => "cancelled");
    await settle();
    await unsubscribePushDevice();
    browser.setCurrent(browser.subscription);
    resolve(browser.subscription);
    expect(await outcome).toBe("cancelled");
    expect(browser.getCurrent()).toBeNull();
    expect(browser.fetchMock.mock.calls.filter(([, options]) => options.method === "POST")).toHaveLength(0);
  });

  it("does not remove a replacement subscription for an old test response", async () => {
    const browser = setup();
    const replacement = browser.makeSubscription("https://fcm.googleapis.com/device-b");
    browser.setCurrent(replacement);
    await unsubscribePushDevice("https://fcm.googleapis.com/device-a");
    expect(browser.getCurrent()).toBe(replacement);
    expect(replacement.unsubscribe).not.toHaveBeenCalled();
    expect(browser.fetchMock).not.toHaveBeenCalled();
  });

  it("remembers successful saves in memory when browser storage is blocked", async () => {
    const browser = setup();
    vi.stubGlobal("sessionStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    await savePushSubscription(browser.subscription as unknown as PushSubscription, "student");
    await savePushSubscription(browser.subscription as unknown as PushSubscription, "student");
    expect(browser.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("times out a worker that never activates without subscribing later", async () => {
    const browser = setup();
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { serviceWorker: {
      getRegistration: async () => ({ ...browser.registration, active: null }), ready: new Promise(() => {}),
    } });
    const enabling = enablePushNotifications(publicKey);
    const outcome = expect(enabling).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(15_001);
    await outcome;
    expect(browser.registration.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("removes a late server save when sign-out happens during the request", async () => {
    const browser = setup();
    let finishSave!: () => void;
    let serverRow = false;
    browser.fetchMock.mockImplementation((_path, options) => {
      if (options.method === "DELETE") { serverRow = false; return Promise.resolve({ ok: true }); }
      return new Promise((resolve) => { finishSave = () => { serverRow = true; resolve({ ok: true }); }; });
    });
    const outcome = enablePushNotifications(publicKey).catch(() => "cancelled");
    await vi.waitFor(() => expect(finishSave).toBeTypeOf("function"));
    await unsubscribePushDevice();
    finishSave();
    expect(await outcome).toBe("cancelled");
    expect(browser.getCurrent()).toBeNull();
    expect(serverRow).toBe(false);
  });

  it("disposes a subscription that resolves after timeout and sign-out", async () => {
    const browser = setup();
    vi.useFakeTimers();
    let finishSubscribe!: (subscription: typeof browser.subscription) => void;
    browser.registration.pushManager.subscribe.mockImplementation(() => new Promise((resolve) => { finishSubscribe = resolve; }));
    const outcome = expect(enablePushNotifications(publicKey)).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(15_001);
    await outcome;
    await unsubscribePushDevice();
    browser.setCurrent(browser.subscription);
    finishSubscribe(browser.subscription);
    await settle();
    expect(browser.getCurrent()).toBeNull();
  });
});
