import type { MetadataRoute } from "next";
import { resolveSiteUrl } from "@/lib/siteUrl";

// Public, indexable pages. Add a path here when a new public page ships.
const SITEMAP_PATHS = ["/", "/privacy"] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = resolveSiteUrl();
  return SITEMAP_PATHS.map((path) => ({ url: new URL(path, siteUrl).href }));
}
