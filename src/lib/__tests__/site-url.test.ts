import { beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({
  APP_URL: undefined as string | undefined,
  VERCEL_PROJECT_PRODUCTION_URL: undefined as string | undefined,
}));
const request = vi.hoisted(() => ({ values: new Map<string, string>() }));
vi.mock("@/lib/env", () => ({ env: config }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: (key: string) => request.values.get(key) ?? null }) }));

import { getSiteUrl } from "@/lib/site-url";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";

beforeEach(() => {
  config.APP_URL = undefined;
  config.VERCEL_PROJECT_PRODUCTION_URL = undefined;
  request.values.clear();
});

describe("site URL during a domain migration", () => {
  it("uses the configured canonical origin ahead of Vercel's existing domain", async () => {
    config.APP_URL = "https://coursecue.example/";
    config.VERCEL_PROJECT_PRODUCTION_URL = "previous-brand.example";
    expect(await getSiteUrl()).toBe("https://coursecue.example");
  });

  it("uses Vercel's production domain rather than a preview request host", async () => {
    config.VERCEL_PROJECT_PRODUCTION_URL = "coursecue.example";
    request.values.set("host", "preview.example");
    expect(await getSiteUrl()).toBe("https://coursecue.example");
  });

  it("supports local HTTP without hardcoding a development address", async () => {
    request.values.set("host", "127.0.0.1:3100");
    request.values.set("x-forwarded-proto", "http");
    expect(await getSiteUrl()).toBe("http://127.0.0.1:3100");
  });

  it("defaults to HTTPS for a hosted request", async () => {
    request.values.set("host", "coursecue.example");
    expect(await getSiteUrl()).toBe("https://coursecue.example");
  });

  it("fails explicitly when neither configuration nor a request host is available", async () => {
    await expect(getSiteUrl()).rejects.toThrow("site URL");
  });

  it("keeps sitemap and robots on the same canonical origin and excludes private routes", async () => {
    config.APP_URL = "https://coursecue.example";
    const entries = await sitemap();
    expect(entries.map((entry) => entry.url)).toEqual([
      "https://coursecue.example",
      "https://coursecue.example/features",
      "https://coursecue.example/how-it-works",
      "https://coursecue.example/install",
      "https://coursecue.example/login",
    ]);
    expect(await robots()).toEqual({
      rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/dashboard/"] },
      sitemap: "https://coursecue.example/sitemap.xml",
    });
  });
});
