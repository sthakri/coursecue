import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("dns", () => ({ promises: { lookup: vi.fn(async () => [{ address: "8.8.8.8", family: 4 }]) } }));
import { testCanvasConnection } from "@/lib/canvas";

afterEach(() => vi.unstubAllGlobals());
describe("Canvas connection error messages", () => {
  it.each([
    [401, "Canvas couldn't verify your access token. Check it or create a new token, then try again."],
    [429, "Canvas is receiving too many requests. Wait a few minutes, then try again."],
    [500, "Canvas is unavailable right now. Please try again later."],
  ])("explains HTTP %s without exposing it", async (status, message) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status })));
    expect((await testCanvasConnection("test-token", "school.instructure.com")).error).toBe(message);
  });
  it("keeps network internals out of the error message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("connect ECONNRESET internal-host"); }));
    expect((await testCanvasConnection("test-token", "school.instructure.com")).error).toBe("We couldn't connect to Canvas. Check your Canvas domain and connection, then try again.");
  });
});
