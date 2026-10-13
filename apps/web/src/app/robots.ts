import type { MetadataRoute } from "next";
import { resolveSiteUrl } from "@/lib/siteUrl";

// Everything stays crawlable: catalog pages are indexable, and share pages (/s/[token]) opt out
// with their own noindex meta tag, which crawlers can only see if the path is not disallowed here.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: new URL("/sitemap.xml", resolveSiteUrl()).href,
  };
}
