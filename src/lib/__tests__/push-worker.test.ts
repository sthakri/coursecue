import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function loadWorker() {
  const listeners = new Map<string, (event: unknown) => void>();
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const caches = { delete: vi.fn().mockResolvedValue(true) };
  const clients = { matchAll: vi.fn().mockResolvedValue([]), openWindow: vi.fn().mockResolvedValue(null) };
  runInNewContext(readFileSync("worker/index.js", "utf8"), {
    self: { addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
      registration: { showNotification }, location: { origin: "https://duepulse.example" }, clients },
    caches, URL,
  });
  async function dispatch(type: string, event: object) {
    let work: Promise<unknown> | undefined;
    expect(listeners.has(type), `worker must handle ${type}`).toBe(true);
    listeners.get(type)!({ ...event, waitUntil: (promise: Promise<unknown>) => { work = promise; } });
    await work;
  }
  return { showNotification, caches, clients, dispatch };
}

describe("DuePulse push worker", () => {
  it("displays a default visible notification for a malformed payload", async () => {
    const worker = loadWorker();
    await worker.dispatch("push", { data: { json: () => { throw new SyntaxError(); } } });
    expect(worker.showNotification).toHaveBeenCalledWith("DuePulse", expect.objectContaining({ body: "You have an assignment due soon" }));
  });

  it("opens the dashboard when a notification is tapped with the app closed", async () => {
    const worker = loadWorker();
    const close = vi.fn();
    await worker.dispatch("notificationclick", { notification: { close } });
    expect(close).toHaveBeenCalled();
    expect(worker.clients.openWindow).toHaveBeenCalledWith("https://duepulse.example/dashboard");
  });

  it("focuses the existing dashboard instead of opening another window", async () => {
    const worker = loadWorker();
    const focus = vi.fn().mockResolvedValue(undefined);
    worker.clients.matchAll.mockResolvedValue([{ url: "https://duepulse.example/dashboard/assignments", focus }] as never);
    await worker.dispatch("notificationclick", { notification: { close: vi.fn() } });
    expect(focus).toHaveBeenCalled();
    expect(worker.clients.openWindow).not.toHaveBeenCalled();
  });

  it("purges the old authenticated start-page cache on activation", async () => {
    const worker = loadWorker();
    await worker.dispatch("activate", {});
    expect(worker.caches.delete).toHaveBeenCalledWith("start-url");
  });

  it("opens the specific assignment from an overdue notification", async () => {
    const worker = loadWorker();
    const assignmentId = "11111111-1111-4111-8111-111111111111";
    await worker.dispatch("push", { data: { json: () => ({ title: "Overdue", body: "Review", assignmentId }) } });
    expect(worker.showNotification).toHaveBeenCalledWith("Overdue", expect.objectContaining({ data: { assignmentId } }));
    const navigate = vi.fn().mockResolvedValue({ focus: vi.fn() });
    worker.clients.matchAll.mockResolvedValue([{ url: "https://duepulse.example/dashboard", navigate }] as never);
    await worker.dispatch("notificationclick", { notification: { close: vi.fn(), data: { assignmentId } } });
    expect(navigate).toHaveBeenCalledWith(`https://duepulse.example/dashboard/assignments?assignment=${assignmentId}`);
  });

  it("never navigates to a payload URL or malformed assignment id", async () => {
    const worker = loadWorker();
    await worker.dispatch("notificationclick", { notification: { close: vi.fn(), data: { assignmentId: "https://evil.example", url: "https://evil.example" } } });
    expect(worker.clients.openWindow).toHaveBeenCalledWith("https://duepulse.example/dashboard");
  });
});
