import { afterEach, describe, expect, it, vi } from "vitest";
import { loadBlogPosts } from "@/lib/blog";
import { catalogSkill, catalogSkills } from "../../test/publicCatalogFixtures";
import { metadata } from "./layout";
import { metadata as notFoundMetadata } from "./not-found";
import robots from "./robots";
import sitemap from "./sitemap";

describe("technical SEO routes", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("lets every crawler in and points robots.txt at the production sitemap", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("COMPANION_WEB_URL", "");

    expect(robots()).toEqual({
      rules: { userAgent: "*", allow: "/" },
      sitemap: "https://skillpack.app/sitemap.xml",
    });
  });

  it("lists the public pages and every blog post on the configured origin", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("COMPANION_WEB_URL", "https://skillpack.app");

    const posts = loadBlogPosts();
    expect(posts.length).toBeGreaterThan(0);
    const entries = await sitemap();
    expect(entries).toEqual([
      { url: "https://skillpack.app/" },
      { url: "https://skillpack.app/privacy" },
      { url: "https://skillpack.app/blog", lastModified: posts[0]?.date },
      ...posts.map((post) => ({ url: `https://skillpack.app/blog/${post.slug}`, lastModified: post.date })),
    ]);
    expect(entries).toContainEqual({ url: "https://skillpack.app/blog/what-is-skill-md", lastModified: "2026-10-13" });
  });

  it("never lists or fetches the catalog while its default-off flag is unset", async () => {
    vi.stubEnv("SKILLPACK_PUBLIC_CATALOG", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const urls = (await sitemap()).map((entry) => entry.url);
    expect(urls.some((url) => new URL(url).pathname.startsWith("/catalog"))).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("adds the catalog index and every validated, listed skill when the catalog is on", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("COMPANION_WEB_URL", "https://skillpack.app");
    vi.stubEnv("SKILLPACK_PUBLIC_CATALOG", "true");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const offset = Number(new URL(url).searchParams.get("offset"));
      const skills = offset === 0 ? [catalogSkill(), ...catalogSkills(49)] : [];
      return Response.json({ skills, next_offset: offset === 0 ? 50 : null });
    }));

    const entries = await sitemap();
    const catalog = entries.filter((entry) => new URL(entry.url).pathname.startsWith("/catalog"));
    expect(catalog).toHaveLength(51);
    expect(catalog[0]).toEqual({ url: "https://skillpack.app/catalog" });
    expect(catalog).toContainEqual({
      url: "https://skillpack.app/catalog/acme/release-helper",
      lastModified: "2026-10-01T09:30:00.000Z",
    });
  });

  it("keeps the static sitemap when the catalog API is disabled or unavailable", async () => {
    vi.stubEnv("SKILLPACK_PUBLIC_CATALOG", "true");
    for (const status of [404, 503]) {
      vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "unavailable" }, { status })));
      const urls = (await sitemap()).map((entry) => new URL(entry.url).pathname);
      expect(urls).toContain("/blog");
      expect(urls.some((path) => path.startsWith("/catalog"))).toBe(false);
    }
  });

  it("gives every page a path-relative canonical and Open Graph URL", () => {
    expect(metadata.alternates?.canonical).toBe("./");
    expect(metadata.openGraph?.url).toBe("./");
  });

  it("titles the home page and appends the brand once to every other page title", () => {
    expect(metadata.title).toEqual({
      default: "Skillpack: Open-Source Skills Hub for Claude Code & Codex",
      template: "%s · Skillpack",
    });
    expect(metadata.openGraph?.title).toBe("Skillpack: Open-Source Skills Hub for Claude Code & Codex");
    expect(metadata.twitter?.title).toBe("Skillpack: Open-Source Skills Hub for Claude Code & Codex");
  });

  it("titles the 404 page itself and does not canonicalize the missing URL", () => {
    // The layout template adds " · Skillpack"; a suffixed page title would render it twice.
    expect(notFoundMetadata.title).toBe("Page not found");
    expect(notFoundMetadata.alternates?.canonical).toBeNull();
  });
});
