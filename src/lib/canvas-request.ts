import { request } from "node:https";
import { lookup } from "node:dns";
import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const) blocked.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
blocked.addSubnet("2001::", 23, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");
blocked.addSubnet("2002::", 16, "ipv6");

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, "ipv4") :
    family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

/** Resolve and validate the very addresses used by the socket, preventing DNS rebinding.
 * Native HTTPS does not follow redirects. Keep the original hostname for TLS verification. */
export async function canvasRequest(url: string, token: string): Promise<Response> {
  const target = new URL(url);
  if (target.protocol !== "https:" || target.username || target.password || (target.port && target.port !== "443")) {
    throw new Error("Canvas requires a standard HTTPS address");
  }
  return new Promise((resolve, reject) => {
    const req = request(target, {
      agent: false,
      // Canvas front doors can reject requests without an identifiable agent.
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": "CourseCue/1.0" },
      signal: AbortSignal.timeout(15_000),
      lookup: (hostname, options, callback) => {
        lookup(hostname, { all: true }, (error, addresses) => {
          if (error) { callback(error, "", 0); return; }
          if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
            callback(new Error("Blocked non-public Canvas address"), "", 0);
            return;
          }
          if (options.all) callback(null, addresses);
          else callback(null, addresses[0].address, addresses[0].family);
        });
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024) { req.destroy(new Error("Canvas response too large")); return; }
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(response.headers)) {
          if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
        }
        const status = response.statusCode ?? 502;
        resolve(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status, headers }));
      });
    });
    req.on("error", reject);
    req.end();
  });
}
