import { z } from "zod";

/** IANA timezone that actually works with Intl — invalid zones throw RangeError downstream. */
export const timezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(
    (tz) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    },
    { message: "Not a valid IANA timezone" },
  );

export const canvasTestSchema = z.object({
  token: z.string().min(1).max(512),
  domain: z.string().min(1).max(253),
});

// Only browser-vendor push services may receive server-side push requests.
// https://web.dev/articles/push-notifications-overview
// https://developer.chrome.com/blog/web-push-interop-wins (legacy Android)
// https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers
// https://mozilla-services.github.io/autopush-rs/
// https://learn.microsoft.com/en-us/windows/apps/develop/notifications/push-notifications/firewall-allowlist-config
export const pushEndpointSchema = z.string().url().max(2048).refine((endpoint) => {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password ||
        (url.port && url.port !== "443")) return false;
    // web-push uses Node's legacy URL parser. Reject authority spellings that
    // WHATWG normalizes differently (extra slashes, backslashes, controls).
    const authority = endpoint.match(/^https:\/\/([^/?#]+)/i)?.[1]?.toLowerCase();
    if (authority !== url.hostname && authority !== `${url.hostname}:443`) return false;
    if (url.hostname === "fcm.googleapis.com" || url.hostname === "android.googleapis.com") return true;
    return ["push.apple.com", "push.services.mozilla.com", "notify.windows.com"]
      .some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}, { message: "Not a supported HTTPS push service endpoint" });

export const pushSubscribeSchema = z.object({
  endpoint: pushEndpointSchema,
  p256dh: z.string().min(1).max(256),
  auth: z.string().min(1).max(64),
});

export const pushTestSchema = z.object({
  endpoint: pushEndpointSchema,
});

export const nudgeTestQuerySchema = z.object({
  userId: z.string().uuid(),
  type: z.enum(["productive_window", "12h", "6h", "1h", "overdue"]).default("productive_window"),
});

export const dismissAssignmentSchema = z.object({
  assignmentId: z.string().uuid(),
});

export const completeAssignmentSchema = z.object({
  assignmentId: z.string().uuid(),
  completed: z.boolean().default(true),
});

export function validateBody<T>(schema: z.ZodType<T>, body: unknown): [T, null] | [null, string] {
  const result = schema.safeParse(body);
  if (result.success) return [result.data, null];
  return [null, result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")];
}
