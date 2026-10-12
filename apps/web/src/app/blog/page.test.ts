// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { loadBlogPosts } from "@/lib/blog";
import BlogIndexPage, { metadata } from "./page";

// SAFETY: React's test harness reads this documented global flag; the test owns its boolean value.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

async function renderIndex(): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(React.createElement(BlogIndexPage));
  });
  return container;
}

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
});

describe("public blog index", () => {
  it("lists every post newest first with its title, description and date", async () => {
    const container = await renderIndex();
    const items = Array.from(container.querySelectorAll(".v10-blog__item"));
    const posts = loadBlogPosts();

    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("h1")?.textContent).toBe("Blog");
    expect(items.map((item) => item.querySelector("a")?.getAttribute("href"))).toEqual(
      posts.map((post) => `/blog/${post.slug}`),
    );
    const guide = items.find((item) => item.querySelector("a")?.getAttribute("href") === "/blog/what-is-skill-md");
    expect(guide?.querySelector("h2")?.textContent).toBe("What is SKILL.md? The complete guide to Agent Skills (2026)");
    expect(guide?.querySelector("p")?.textContent).toMatch(/^SKILL\.md explained: the Agent Skills format/);
    expect(guide?.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-13");
    expect(guide?.querySelector("time")?.textContent).toBe("October 13, 2026");
  });

  it("titles itself Blog and canonicalizes to /blog", () => {
    expect(metadata.title).toBe("Blog · Skillpack");
    expect(metadata.description).toBeTruthy();
    expect(metadata.alternates?.canonical).toBe("/blog");
    expect(metadata.openGraph?.url).toBe("/blog");
  });
});
