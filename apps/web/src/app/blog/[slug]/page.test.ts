// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("renders the body's own H1 once, plus GFM tables, task lists and fenced code", async () => {
    const container = await renderPost(SLUG);
    const headings = container.querySelectorAll("h1");

    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe("What is SKILL.md? The complete guide to Agent Skills (2026)");
    expect(container.querySelector(".v10-blog__meta time")?.getAttribute("datetime")).toBe("2026-10-13");

    const headerCells = Array.from(container.querySelectorAll(".v10-blog__tablewrap table th"));
    expect(headerCells.map((cell) => cell.textContent)).toEqual(["Field", "Required", "Rules"]);
    expect(container.querySelectorAll(".v10-blog__tablewrap tbody tr")).toHaveLength(6);

    const checkboxes = Array.from(container.querySelectorAll<HTMLInputElement>(".task-list-item input[type=checkbox]"));
    expect(checkboxes).toHaveLength(7);
    expect(checkboxes.every((box) => box.disabled && !box.checked)).toBe(true);

    const codeBlocks = Array.from(container.querySelectorAll("pre > code"));
    expect(codeBlocks.map((code) => code.className)).toEqual(
      expect.arrayContaining(["language-markdown", "language-bash"]),
    );
    expect(codeBlocks.some((code) => code.textContent?.includes("├── SKILL.md"))).toBe(true);
    expect(container.querySelector("a[href='https://agentskills.io/specification']")).not.toBeNull();
  });

  it("publishes BlogPosting JSON-LD from the frontmatter only", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("COMPANION_WEB_URL", "https://skillpack.app");
    const container = await renderPost(SLUG);
    const script = container.querySelector("script[type='application/ld+json']");

    expect(JSON.parse(script?.textContent ?? "{}")).toEqual({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "BlogPosting",
          headline: "What is SKILL.md? The complete guide to Agent Skills (2026)",
          description:
            "SKILL.md explained: the Agent Skills format, frontmatter fields, examples, and how to version, share and install skills across Claude Code, Codex and MCP clients.",
          datePublished: "2026-10-13",
          url: "https://skillpack.app/blog/what-is-skill-md",
          mainEntityOfPage: "https://skillpack.app/blog/what-is-skill-md",
        },
      ],
    });
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
    });
  });
});
