import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import PushNotificationButton from "@/components/push/PushNotificationButton";
import TestNotifButton from "@/components/push/TestNotifButton";
import { clearPushSyncMarkers } from "@/lib/push";
import { toast } from "sonner";

// A small hook harness keeps these browser API regressions runnable in Node.
// React still creates real elements; only lifecycle scheduling is controlled.
const hooks = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  effects: [] as (() => void | (() => void))[],
  mounting: true,
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useState: (initial: unknown) => {
      const index = hooks.cursor++;
      if (!(index in hooks.values)) {
        hooks.values[index] = typeof initial === "function" ? initial() : initial;
      }
      return [hooks.values[index], (next: unknown) => {
        hooks.values[index] = typeof next === "function" ? next(hooks.values[index]) : next;
      }];
    },
    useRef: (initial: unknown) => {
      const index = hooks.cursor++;
      if (!(index in hooks.values)) hooks.values[index] = { current: initial };
      return hooks.values[index];
    },
    useEffect: (effect: () => void | (() => void)) => {
      if (hooks.mounting) hooks.effects.push(effect);
    },
  };
});

vi.mock("@/components/ui/button", () => ({ Button: "button" }));
vi.mock("@/components/ui/skeleton", () => ({ Skeleton: "span" }));
vi.mock("lucide-react", () => ({ CheckCircle: "svg", Bell: "svg", Loader2: "svg" }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_VAPID_PUBLIC_KEY: Buffer.from([4, ...Array<number>(64).fill(1)]).toString("base64url") },
}));

const cleanups: (() => void)[] = [];

function render() {
  hooks.cursor = 0;
  const element = PushNotificationButton({ userId: "student-1" });
  if (hooks.mounting) {
    hooks.mounting = false;
    for (const effect of hooks.effects) {
      const cleanup = effect();
      if (cleanup) cleanups.push(cleanup);
    }
  }
  return element;
}

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textContent(node.props.children);
  return "";
}

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

function click() {
  const element = render();
  const props = element.props as { onClick?: () => Promise<void> };
  expect(props.onClick, "the enable action must remain available").toBeTypeOf("function");
  return props.onClick!();
}

function subscription() {
  return {
    endpoint: "https://push.example/subscription",
    toJSON: () => ({ endpoint: "https://push.example/subscription", keys: { p256dh: "public", auth: "auth" } }),
  };
}

function setupBrowser(permission: NotificationPermission = "default") {
  const notification = { permission, requestPermission: vi.fn().mockResolvedValue("granted") };
  const activeWorker = Object.assign(new EventTarget(), { state: "activated" });
  const registration = Object.assign(new EventTarget(), {
    active: activeWorker as typeof activeWorker | null,
    installing: null as typeof activeWorker | null,
    waiting: null,
    pushManager: {
      getSubscription: vi.fn().mockResolvedValue(null),
      subscribe: vi.fn().mockResolvedValue(subscription()),
    },
  });
  const serviceWorker = Object.assign(new EventTarget(), {
    getRegistration: vi.fn().mockResolvedValue(registration),
    register: vi.fn().mockResolvedValue(registration),
    ready: Promise.resolve(registration),
    controller: activeWorker,
  });
  vi.stubGlobal("window", {
    Notification: notification,
    atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
    matchMedia: () => ({ matches: true }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    isSecureContext: true,
  });
  vi.stubGlobal("Notification", notification);
  vi.stubGlobal("PushManager", function PushManager() {});
  vi.stubGlobal("navigator", { serviceWorker, userAgent: "Mozilla/5.0 Chrome", standalone: true });
  vi.stubGlobal("sessionStorage", { getItem: vi.fn().mockReturnValue(null), setItem: vi.fn() });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  return { notification, registration, serviceWorker };
}

beforeEach(() => {
  hooks.values = [];
  hooks.cursor = 0;
  hooks.effects = [];
  hooks.mounting = true;
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  clearPushSyncMarkers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("push notification button recovery", () => {
  it("enables with an active worker and a successful server save", async () => {
    setupBrowser();
    render();
    await settle();
    await click();

    expect(textContent(render())).toContain("Nudges enabled");
  });

  it("offers Enable after permission was granted but no worker registration exists", async () => {
    const { serviceWorker } = setupBrowser("granted");
    serviceWorker.getRegistration.mockResolvedValue(undefined);
    render();
    await settle();

    expect(textContent(render())).toContain("Enable");
    expect((render().props as { disabled?: boolean }).disabled).not.toBe(true);
  });

  it("successfully enables on first installation after the worker activates", async () => {
    const { registration, serviceWorker } = setupBrowser();
    const worker = Object.assign(new EventTarget(), { state: "installing" });
    registration.active = null;
    registration.installing = worker;
    serviceWorker.getRegistration.mockResolvedValue(undefined);
    let activate!: (value: typeof registration) => void;
    serviceWorker.ready = new Promise((resolve) => { activate = resolve; });
    registration.pushManager.subscribe.mockImplementation(async () => {
      if (!registration.active) throw new DOMException("No active Service Worker", "InvalidStateError");
      return subscription();
    });
    render();
    await settle();
    const enabling = click();
    await settle();

    worker.state = "activated";
    registration.active = worker;
    registration.installing = null;
    worker.dispatchEvent(new Event("statechange"));
    activate(registration);
    await enabling;

    expect(textContent(render())).toContain("Nudges enabled");
  });

  it("contains permission prompt rejection and restores a retryable action", async () => {
    const { notification } = setupBrowser();
    notification.requestPermission.mockRejectedValue(new Error("Permission prompt failed"));
    render();
    await settle();

    await expect(click()).resolves.toBeUndefined();
    expect(textContent(render())).toContain("Enable");
    expect((render().props as { disabled?: boolean }).disabled).not.toBe(true);
  });

  it("shows enabled after server save even when session storage is unavailable", async () => {
    setupBrowser();
    vi.stubGlobal("sessionStorage", {
      getItem: () => { throw new DOMException("Storage unavailable", "SecurityError"); },
      setItem: () => { throw new DOMException("Storage unavailable", "SecurityError"); },
    });
    render();
    await settle();
    await click();

    expect(textContent(render())).toContain("Nudges enabled");
  });

  it("keeps enabled when an older focus check returns after a successful tap", async () => {
    const { registration } = setupBrowser("granted");
    render();
    await settle();
    let resolveCheck!: (value: null) => void;
    registration.pushManager.getSubscription.mockImplementationOnce(() => new Promise((resolve) => { resolveCheck = resolve; }));
    const focus = vi.mocked(window.addEventListener).mock.calls.find(([type]) => type === "focus")![1] as () => Promise<void>;
    const checking = focus();
    await settle();
    await click();
    expect(textContent(render())).toContain("Nudges enabled");
    resolveCheck(null);
    await checking;
    expect(textContent(render())).toContain("Nudges enabled");
  });
});

function testButtons() {
  hooks.cursor = 0;
  const element = TestNotifButton();
  return element.props.children as Array<{ props: { children: string; disabled: boolean; "aria-busy"?: boolean; onClick: () => Promise<void> } }>;
}

describe("notification test buttons", () => {
  it.each([false, true])("shows progress only for the selected test and blocks overlapping clicks: silent=%s", async silent => {
    const { registration } = setupBrowser("granted");
    registration.pushManager.getSubscription.mockResolvedValue(subscription());
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const selected = silent ? 1 : 0;
    const other = silent ? 0 : 1;
    const initial = testButtons();
    const pending = initial[selected].props.onClick();
    await settle();

    const busy = testButtons();
    expect(busy[selected].props.children).toBe("Sending…");
    expect(busy[other].props.children).toBe(initial[other].props.children);
    expect(busy.map(button => button.props.disabled)).toEqual([true, true]);
    expect(busy.map(button => button.props["aria-busy"])).toEqual(silent ? [false, true] : [true, false]);
    await initial[other].props.onClick();
    await initial[selected].props.onClick();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [path, options] = vi.mocked(fetch).mock.calls[0];
    expect(path).toBe("/api/push/test");
    expect(JSON.parse(options!.body as string)).toEqual({ endpoint: subscription().endpoint, silent });

    finish(Response.json({ success: true }));
    await pending;
    expect(testButtons().map(button => button.props.children)).toEqual(["Send test notification", "Send silent test"]);
    expect(testButtons().map(button => button.props.disabled)).toEqual([false, false]);
    expect(toast.success).toHaveBeenCalledTimes(1);
    const next = testButtons()[other].props.onClick();
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    finish(Response.json({ success: true }));
    await next;
  });

  it("restores both actions after a failed request and allows retrying", async () => {
    const { registration } = setupBrowser("granted");
    registration.pushManager.getSubscription.mockResolvedValue(subscription());
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: "Try again later" }, { status: 502 }));
    await testButtons()[1].props.onClick();
    expect(toast.error).toHaveBeenCalledWith("Try again later");
    expect(testButtons().map(button => button.props.disabled)).toEqual([false, false]);
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ success: true }));
    await testButtons()[0].props.onClick();
    expect(toast.success).toHaveBeenCalledTimes(1);
  });
});
