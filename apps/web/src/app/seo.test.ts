import { afterEach, describe, expect, it, vi } from "vitest";
import { loadBlogPosts } from "@/lib/blog";
import { metadata } from "./layout";
import { metadata as notFoundMetadata } from "./not-found";
import robots from "./robots";
import sitemap from "./sitemap";

describe("technical SEO routes", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lets every crawler in and points robots.txt at the production sitemap", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("COMPANION_WEB_URL", "");

    expect(robots()).toEqual({
      rules: { userAgent: "*", allow: "/" },
      sitemap: "https://skillpack.app/sitemap.xml",
    });
  });

  it("lists the public pages and every blog post on the configured origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("COMPANION_WEB_URL", "https://skillpack.app");

    const posts = loadBlogPosts();
    expect(posts.length).toBeGreaterThan(0);
    expect(sitemap()).toEqual([
      { url: "https://skillpack.app/" },
      { url: "https://skillpack.app/privacy" },
      { url: "https://skillpack.app/blog", lastModified: posts[0]?.date },
      ...posts.map((post) => ({ url: `https://skillpack.app/blog/${post.slug}`, lastModified: post.date })),
    ]);
    expect(sitemap()).toContainEqual({ url: "https://skillpack.app/blog/what-is-skill-md", lastModified: "2026-10-13" });
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
