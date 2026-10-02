import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-url";

export default async function robots(): Promise<MetadataRoute.Robots> {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/dashboard/"] },
    sitemap: `${await getSiteUrl()}/sitemap.xml`,
  };
}
