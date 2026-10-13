import type { MetadataRoute } from "next";
import { blogPostPath, loadBlogPosts } from "@/lib/blog";
import { CATALOG_PATH, catalogSkillPath, isPublicCatalogEnabled, listAllPublicCatalogSkills } from "@/lib/publicCatalog";
import { resolveSiteUrl } from "@/lib/siteUrl";

// Catalog entries follow live listing consent, so the sitemap is rendered per request.
export const dynamic = "force-dynamic";

// Public, indexable pages. Add a path here when a new public page ships; blog posts are listed
// from content/blog automatically.
const SITEMAP_PATHS = ["/", "/privacy"] as const;

/** Listed skills only when the default-off catalog flag is on. An unavailable API omits them. */
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
  return [
    ...SITEMAP_PATHS.map((path) => ({ url: new URL(path, siteUrl).href })),
    // Posts are sorted newest first, so the index changed when the first post was published.
    { url: new URL("/blog", siteUrl).href, lastModified: posts[0]?.date },
    ...posts.map((post) => ({ url: new URL(blogPostPath(post.slug), siteUrl).href, lastModified: post.date })),
    ...(await catalogEntries(siteUrl)),
  ];
}
