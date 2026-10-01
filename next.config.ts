import type { NextConfig } from "next";
// @ts-expect-error next-pwa has no type declarations
import withPWA from "next-pwa";

const nextConfig: NextConfig = {
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        // ponytail: CSP omitted — a correct CSP for Next 16 needs nonces/reporting infra; add at launch hardening.
      ],
    },
  ],
};

// next-pwa runs at build time and needs process.env directly (not our env module)
const isDev = process.env.NODE_ENV === "development";

export default withPWA({
  dest: "public",
  disable: isDev,
  register: true,
  skipWaiting: true,
  cacheStartUrl: false,
  dynamicStartUrl: false,
  runtimeCaching: [
    // Authenticated /api/* responses are intentionally NOT cached in
    // CacheStorage — they contain per-user data that must not survive logout
    // on shared devices. Static assets only.
    {
      urlPattern: /^https?:\/\/.*\/(_next\/static|_next\/image|fonts|icons|manifest\.json).*$/i,
      handler: "CacheFirst",
      options: {
        cacheName: "static-assets",
        expiration: {
          maxEntries: 100,
          maxAgeSeconds: 24 * 60 * 60,
        },
      },
    },
  ],
})(nextConfig);
