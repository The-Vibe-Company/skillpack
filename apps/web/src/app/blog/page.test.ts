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
  it("opens with a kicker, one H1 and a short subtitle", async () => {
    const container = await renderIndex();
    const hero = container.querySelector(".v10-bloghome__hero");

    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(hero?.querySelector(".lp-kick")?.textContent).toBe("Skillpack blog");
    expect(hero?.querySelector("h1")?.textContent).toBe("Guides to SKILL.md and Agent Skills");
    expect(hero?.querySelector(".lp-sub")?.textContent).toBe(
      "Writing, versioning and sharing skills for your team's coding agents.",
    );
  });

  it("features the newest post, then lists every other post newest first", async () => {
    const container = await renderIndex();
    const posts = loadBlogPosts();
    const cards = Array.from(container.querySelectorAll(".v10-postcard"));

    expect(cards.map((card) => card.querySelector(".v10-postcard__title a")?.getAttribute("href"))).toEqual(
      posts.map((post) => `/blog/${post.slug}`),
    );
    expect(cards[0]?.classList.contains("v10-postcard--featured")).toBe(true);
    expect(cards[0]?.querySelector("h2")).not.toBeNull();
    expect(cards.slice(1).every((card) => card.querySelector("h3"))).toBe(true);
    expect(cards.slice(1).every((card) => !card.classList.contains("v10-postcard--featured"))).toBe(true);
    // With a single post there is no empty "More posts" grid.
    expect(container.querySelector(".v10-bloghome__more") === null).toBe(posts.length === 1);
  });

  it("gives each card a cover, date, reading time, description and topic tags", async () => {
    const container = await renderIndex();
    const guide = Array.from(container.querySelectorAll(".v10-postcard")).find(
      (card) => card.querySelector(".v10-postcard__title a")?.getAttribute("href") === "/blog/what-is-skill-md",
    );

    expect(guide?.querySelector(".v10-postcard__title")?.textContent).toBe("What is SKILL.md? The complete guide to Agent Skills (2026)");
    expect(guide?.querySelector(".v10-postcard__desc")?.textContent).toMatch(/^SKILL\.md explained: the Agent Skills format/);
    expect(guide?.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-13");
    expect(guide?.querySelector("time")?.textContent).toBe("October 13, 2026");
    expect(guide?.querySelector(".v10-postmeta")?.textContent).toMatch(/\d+ min read$/);
    expect(Array.from(guide?.querySelectorAll(".v10-tags li") ?? []).map((tag) => tag.textContent)).toEqual([
      "SKILL.md",
      "Agent Skills",
    ]);

    // The cover is drawn from the post's own title and tags and hidden from assistive technology.
    const cover = guide?.querySelector(".v10-cover");
    expect(cover?.getAttribute("aria-hidden")).toBe("true");
    expect(cover?.querySelector(".v10-cover__title")?.textContent).toBe(
      "What is SKILL.md? The complete guide to Agent Skills (2026)",
    );
    // One link per card: the stretched title link.
    expect(guide?.querySelectorAll("a")).toHaveLength(1);
  });

  it("titles itself Blog and canonicalizes to /blog", () => {
    // The root layout template appends " · Skillpack", so the page title must stay bare.
    expect(metadata.title).toBe("Blog");
    expect(metadata.openGraph?.title).toBe("Blog · Skillpack");
    expect(metadata.description).toBeTruthy();
    expect(metadata.alternates?.canonical).toBe("/blog");
    expect(metadata.openGraph?.url).toBe("/blog");
  });
});
