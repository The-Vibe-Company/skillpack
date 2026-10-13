import type { MetadataRoute } from "next";
import { blogPostPath, loadBlogPosts } from "@/lib/blog";
import { catalogSkillPath, loadCatalogSkills } from "@/lib/catalog";
import { resolveSiteUrl } from "@/lib/siteUrl";

// Public, indexable pages. Add a path here when a new public page ships; blog posts are listed
// from content/blog and catalog skills from CATALOG_SOURCES automatically.
const SITEMAP_PATHS = ["/", "/privacy"] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = resolveSiteUrl();
  const posts = loadBlogPosts();
  return [
    ...SITEMAP_PATHS.map((path) => ({ url: new URL(path, siteUrl).href })),
    // Posts are sorted newest first, so the index changed when the first post was published.
    { url: new URL("/blog", siteUrl).href, lastModified: posts[0]?.date },
    ...posts.map((post) => ({ url: new URL(blogPostPath(post.slug), siteUrl).href, lastModified: post.date })),
    { url: new URL("/catalog", siteUrl).href },
    ...loadCatalogSkills().map((skill) => ({ url: new URL(catalogSkillPath(skill.slug), siteUrl).href })),
  ];
}
