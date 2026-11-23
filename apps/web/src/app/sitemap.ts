import type { MetadataRoute } from "next";
import { blogPostLastModified, blogPostPath, loadBlogPosts } from "@/lib/blog";
import { CATALOG_PATH, catalogSkillPath, isPublicCatalogEnabled, listAllPublicCatalogSkills } from "@/lib/publicCatalog";
import { resolveSiteUrl } from "@/lib/siteUrl";

// Catalog entries follow live listing and moderation, so the sitemap is rendered per request.
export const dynamic = "force-dynamic";

// Public, indexable pages. Add a path here when a new public page ships; blog posts are listed
// from content/blog automatically.
const SITEMAP_PATHS = ["/", "/privacy"] as const;

/**
 * Validated, listed skills only (the anonymous API serves nothing else), and only when the
 * default-off catalog flag is on. A disabled or unavailable API omits the catalog.
 */
async function catalogEntries(siteUrl: URL): Promise<MetadataRoute.Sitemap> {
  if (!isPublicCatalogEnabled()) return [];
  const skills = await listAllPublicCatalogSkills().catch(() => null);
  if (!skills) return [];
  return [
    { url: new URL(CATALOG_PATH, siteUrl).href },
    ...skills.map((skill) => ({
      url: new URL(catalogSkillPath(skill.org_slug, skill.skill_slug), siteUrl).href,
      lastModified: skill.released_at,
    })),
  ];
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = resolveSiteUrl();
  const posts = loadBlogPosts();
  // The index changed when its newest post was published or any post was last revised.
  const blogLastModified = posts.map(blogPostLastModified).sort().at(-1);
  return [
    ...SITEMAP_PATHS.map((path) => ({ url: new URL(path, siteUrl).href })),
    { url: new URL("/blog", siteUrl).href, lastModified: blogLastModified },
    ...posts.map((post) => ({
      url: new URL(blogPostPath(post.slug), siteUrl).href,
      lastModified: blogPostLastModified(post),
    })),
    ...(await catalogEntries(siteUrl)),
  ];
}
