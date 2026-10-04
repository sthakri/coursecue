import { EventEmitter } from "node:events";
import type { LookupAddress } from "node:dns";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn(), lookup: vi.fn() }));
vi.mock("node:https", () => ({ request: mocks.request }));
vi.mock("node:dns", () => ({ lookup: mocks.lookup }));

import { canvasRequest } from "@/lib/canvas-request";

type SocketOptions = {
  agent: false;
  headers: Record<string, string>;
  lookup: (hostname: string, options: { all?: boolean }, callback: (error: Error | null, addresses: LookupAddress[] | string, family?: number) => void) => void;
};
const publicAddresses = [{ address: "104.16.112.71", family: 4 }];

function transport({ addresses = publicAddresses, all = true, status = 200, dnsError = null }: {
  addresses?: LookupAddress[]; all?: boolean; status?: number; dnsError?: Error | null;
} = {}) {
  const socketResult = vi.fn();
  mocks.lookup.mockImplementation((_hostname: string, _options: unknown, callback: (error: Error | null, addresses: LookupAddress[]) => void) => callback(dnsError, addresses));
  mocks.request.mockImplementation((target: URL, options: SocketOptions, onResponse: (response: EventEmitter) => void) => {
    const req = Object.assign(new EventEmitter(), {
      end: () => options.lookup(target.hostname, { all }, (error, resolved, family) => {
        socketResult(error, resolved, family);
        if (error) { req.emit("error", error); return; }
        const response = Object.assign(new EventEmitter(), {
          statusCode: status,
          headers: status === 302 ? { location: "https://127.0.0.1/private" } : {},
        });
        onResponse(response);
        response.emit("data", Buffer.from("[]"));
        response.emit("end");
      }),
      destroy: (error: Error) => req.emit("error", error),
    });
    return req;
  });
  return socketResult;
}

beforeEach(() => vi.clearAllMocks());

describe("Canvas HTTPS socket boundary", () => {
  it("sends an identifiable agent while preserving the TLS hostname and bearer token", async () => {
    transport();
    const response = await canvasRequest("https://school.instructure.com/api/v1/courses", "test-token");
    expect(response.status).toBe(200);
    const [target, options] = mocks.request.mock.calls[0] as [URL, SocketOptions];
    expect(target.hostname).toBe("school.instructure.com");
    expect(options.agent).toBe(false);
    expect(options.headers).toMatchObject({ "User-Agent": "CourseCue/1.0", Authorization: "Bearer test-token", Accept: "application/json" });
  });

  it.each([true, false])("validates the DNS addresses supplied to the actual socket lookup (all=%s)", async all => {
    const socketResult = transport({ all });
    await canvasRequest("https://school.instructure.com/api", "test-token");
    expect(mocks.lookup).toHaveBeenCalledOnce();
    expect(mocks.lookup).toHaveBeenCalledWith("school.instructure.com", { all: true }, expect.any(Function));
    expect(socketResult).toHaveBeenCalledWith(null, all ? publicAddresses : publicAddresses[0].address, all ? undefined : 4);
  });

  it.each([
    { addresses: [{ address: "127.0.0.1", family: 4 }] },
    { addresses: [...publicAddresses, { address: "169.254.169.254", family: 4 }] },
    { addresses: [{ address: "::ffff:127.0.0.1", family: 6 }] },
    { addresses: [] },
  ])("rejects a non-public or empty DNS answer before a response is accepted: %j", async ({ addresses }) => {
    const socketResult = transport({ addresses });
    await expect(canvasRequest("https://school.instructure.com/api", "test-token")).rejects.toThrow("Blocked non-public Canvas address");
    expect(socketResult).toHaveBeenCalledWith(expect.any(Error), "", 0);
  });

  it("propagates DNS failure instead of retrying through an unvalidated resolver", async () => {
    transport({ dnsError: new Error("DNS unavailable") });
    await expect(canvasRequest("https://school.instructure.com/api", "test-token")).rejects.toThrow("DNS unavailable");
    expect(mocks.lookup).toHaveBeenCalledOnce();
  });

  it("returns redirects without opening another request or following their destination", async () => {
    transport({ status: 302 });
    const response = await canvasRequest("https://school.instructure.com/api", "test-token");
    expect(response.status).toBe(302);
    expect(response.ok).toBe(false);
    expect(response.headers.get("location")).toBe("https://127.0.0.1/private");
    expect(mocks.request).toHaveBeenCalledOnce();
  });
});
