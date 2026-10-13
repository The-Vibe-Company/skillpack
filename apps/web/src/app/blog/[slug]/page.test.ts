// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadBlogPosts } from "@/lib/blog";
import BlogPostPage, { dynamicParams, generateMetadata, generateStaticParams } from "./page";

// SAFETY: React's test harness reads this documented global flag; the test owns its boolean value.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SLUG = "what-is-skill-md";
const roots: Root[] = [];

function routeProps(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

async function renderPost(slug: string): Promise<HTMLElement> {
  const page = await BlogPostPage(routeProps(slug));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(page);
  });
  return container;
}

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
  vi.unstubAllEnvs();
});

describe("public blog post page", () => {
  it("prerenders every post and 404s any other slug", async () => {
    expect(generateStaticParams()).toContainEqual({ slug: SLUG });
    expect(dynamicParams).toBe(false);
    await expect(BlogPostPage(routeProps("no-such-post"))).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
    await expect(generateMetadata(routeProps("no-such-post"))).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
  });

  it("sets the body's own H1 once in the article header with author, date, reading time and tags", async () => {
    const container = await renderPost(SLUG);
    const headings = container.querySelectorAll("h1");
    const header = container.querySelector(".v10-post__header");

    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe("What is SKILL.md? The complete guide to Agent Skills (2026)");
    expect(header?.contains(headings[0] ?? null)).toBe(true);
    expect(Array.from(header?.querySelectorAll("nav[aria-label='Breadcrumb'] a") ?? []).map((a) => a.getAttribute("href"))).toEqual([
      "/",
      "/blog",
    ]);

    const meta = header?.querySelector(".v10-postmeta");
    expect(meta?.querySelector(".v10-postmeta__author")?.textContent).toBe("By The Vibe Company");
    expect(meta?.querySelector(".v10-postmeta__author a")?.getAttribute("href")).toBe("https://thevibecompany.co");
    expect(meta?.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-13");
    expect(meta?.textContent).toMatch(/\d+ min read$/);
    expect(Array.from(header?.querySelectorAll(".v10-tags li") ?? []).map((tag) => tag.textContent)).toEqual([
      "SKILL.md",
      "Agent Skills",
    ]);
    expect(container.querySelector(".v10-post__cover .v10-cover")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders the rest of the body: GFM tables, task lists and fenced code with copy buttons", async () => {
    const container = await renderPost(SLUG);
    const body = container.querySelector("#article-body");

    expect(body?.querySelector("h1")).toBeNull();
    expect(body?.querySelector("p")?.textContent).toMatch(/^Most coding agents can write code\./);

    const headerCells = Array.from(body?.querySelectorAll(".v10-blog__tablewrap table th") ?? []);
    expect(headerCells.map((cell) => cell.textContent)).toEqual(["Field", "Required", "Rules"]);
    expect(body?.querySelectorAll(".v10-blog__tablewrap tbody tr")).toHaveLength(6);

    const checkboxes = Array.from(body?.querySelectorAll<HTMLInputElement>(".task-list-item input[type=checkbox]") ?? []);
    expect(checkboxes).toHaveLength(7);
    expect(checkboxes.every((box) => box.disabled && !box.checked)).toBe(true);

    const blocks = Array.from(body?.querySelectorAll("[data-code-block]") ?? []);
    expect(blocks.map((block) => block.querySelector("pre > code")?.className)).toEqual(
      expect.arrayContaining(["language-markdown", "language-bash"]),
    );
    expect(blocks.every((block) => block.querySelector("button[aria-label='Copy code']"))).toBe(true);
    expect(blocks.some((block) => block.textContent?.includes("├── SKILL.md"))).toBe(true);
    expect(body?.querySelector("a[href='https://agentskills.io/specification']")).not.toBeNull();
  });

  it("outlines the H2 and H3 headings in a sidebar and a collapsed mobile disclosure", async () => {
    const container = await renderPost(SLUG);
    const headingIds = Array.from(container.querySelectorAll("#article-body h2, #article-body h3")).map((h) => h.id);
    const sidebar = container.querySelector(".v10-toc--sidebar");
    const disclosure = container.querySelector("details.v10-toc--disclosure");
    const targets = (nav: Element | null) =>
      Array.from(nav?.querySelectorAll("a") ?? []).map((a) => a.getAttribute("href")?.slice(1));

    expect(headingIds).toContain("the-short-answer");
    expect(headingIds).toContain("the-minimal-skillmd");
    expect(sidebar?.getAttribute("aria-label")).toBe("On this page");
    expect(targets(sidebar)).toEqual(headingIds);
    expect(targets(disclosure)).toEqual(headingIds);
    expect(disclosure?.hasAttribute("open")).toBe(false);
    expect(sidebar?.querySelector("a[href='#the-minimal-skillmd']")?.parentElement?.className).toContain("v10-toc__item--sub");
  });

  it("ends with a sign-up call to action and related posts when there are any", async () => {
    const container = await renderPost(SLUG);
    const cta = container.querySelector(".v10-postcta");

    expect(cta?.querySelector("h2")?.textContent).toBe("Share skills with your whole team.");
    expect(cta?.querySelector("a.v10-btn--primary")?.getAttribute("href")).toBe("/login");
    expect(cta?.textContent).not.toMatch(/free|pric/i);
    // Related posts never include the post itself; with no other posts the section is left out.
    const related = Array.from(container.querySelectorAll(".v10-related .v10-postcard__title a")).map((a) =>
      a.getAttribute("href"),
    );
    expect(related).not.toContain(`/blog/${SLUG}`);
    expect(related).toHaveLength(Math.min(3, loadBlogPosts().length - 1));
    expect(container.querySelector(".v10-progress")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("publishes BlogPosting and BreadcrumbList JSON-LD from the frontmatter only", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("COMPANION_WEB_URL", "https://skillpack.app");
    const container = await renderPost(SLUG);
    const script = container.querySelector("script[type='application/ld+json']");

    const data = JSON.parse(script?.textContent ?? "{}");

    expect(data["@context"]).toBe("https://schema.org");
    expect(data["@graph"]).toEqual([
      {
        "@type": "BlogPosting",
        headline: "What is SKILL.md? The complete guide to Agent Skills (2026)",
        description:
          "SKILL.md explained: the Agent Skills format, frontmatter fields, examples, and how to version, share and install skills across Claude Code, Codex and MCP clients.",
        datePublished: "2026-10-13",
        url: "https://skillpack.app/blog/what-is-skill-md",
        mainEntityOfPage: "https://skillpack.app/blog/what-is-skill-md",
        image: "https://skillpack.app/blog/what-is-skill-md/opengraph-image",
        keywords: ["SKILL.md", "Agent Skills"],
        author: { "@type": "Organization", name: "The Vibe Company", url: "https://thevibecompany.co" },
        publisher: {
          "@type": "Organization",
          "@id": "https://skillpack.app/#organization",
          name: "Skillpack",
          url: "https://skillpack.app",
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://skillpack.app/" },
          { "@type": "ListItem", position: 2, name: "Blog", item: "https://skillpack.app/blog" },
          {
            "@type": "ListItem",
            position: 3,
            name: "What is SKILL.md? The complete guide to Agent Skills (2026)",
            item: "https://skillpack.app/blog/what-is-skill-md",
          },
        ],
      },
    ]);
  });

  it("gives each post its own title, description, canonical and article Open Graph data", async () => {
    const metadata = await generateMetadata(routeProps(SLUG));

    expect(metadata.title).toEqual({ absolute: "What is SKILL.md? The complete guide to Agent Skills (2026)" });
    expect(metadata.description).toMatch(/^SKILL\.md explained/);
    expect(metadata.alternates?.canonical).toBe("/blog/what-is-skill-md");
    expect(metadata.openGraph).toMatchObject({
      url: "/blog/what-is-skill-md",
      type: "article",
      publishedTime: "2026-10-13",
      title: "What is SKILL.md? The complete guide to Agent Skills (2026)",
      authors: ["The Vibe Company"],
      tags: ["SKILL.md", "Agent Skills"],
    });
    // Open Graph gets the generated image from ./opengraph-image.tsx; X is pointed at the same file.
    expect(metadata.openGraph).not.toHaveProperty("images");
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      images: [
        { url: "/blog/what-is-skill-md/opengraph-image", alt: "What is SKILL.md? The complete guide to Agent Skills (2026)" },
      ],
    });
  });
});
