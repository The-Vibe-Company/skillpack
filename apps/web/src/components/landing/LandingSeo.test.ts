// @vitest-environment happy-dom

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HOME_BLOG_LINKS, LandingPage } from "./LandingPage";

/**
 * Product promise:
 * The home page that search engines and first-time visitors read is complete in the server HTML: every
 * word, every heading and every sign-up link is there before any script runs, the analytics labels
 * keep their names, and every internal link it adds leads to a page that answers.
 *
 * Regression caught:
 * A redesign that moves copy behind client islands or a pre-hydration hidden state, drops a PostHog
 * screen label, links a blog post that is not on main, or links /catalog while its flag is off (404).
 *
 * Why this test is component-level:
 * The risk is the markup LandingPage renders on the server, so static rendering is the lowest boundary.
 */

/* content/blog in apps/web, three levels above this folder. */
const BLOG_DIR = join(fileURLToPath(import.meta.url), "..", "..", "..", "..", "content", "blog");

function serverDocument(): Document {
  const doc = document.implementation.createHTMLDocument("home");
  doc.body.innerHTML = renderToStaticMarkup(React.createElement(LandingPage));
  return doc;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("LandingPage server HTML", () => {
  it("ships at least 1,200 words of copy without any pre-hydration hidden state", () => {
    const html = renderToStaticMarkup(React.createElement(LandingPage));
    const doc = serverDocument();
    doc.querySelectorAll("script, style").forEach((node) => node.remove());
    const words = (doc.querySelector("main")?.textContent ?? "").split(/\s+/).filter(Boolean);

    expect(words.length).toBeGreaterThanOrEqual(1200);
    expect(html).not.toContain("v5-reveal--wait");
    expect(html).not.toMatch(/style="[^"]*(opacity:\s*0|visibility:\s*hidden|display:\s*none)/);
  });

  it("keeps every PostHog screen label the landing reported before", () => {
    const labels = Array.from(serverDocument().querySelectorAll("[data-screen-label]")).map((node) => node.getAttribute("data-screen-label"));

    expect(labels).toEqual(
      expect.arrayContaining(["hero", "agents-strip", "the-problem", "how-it-works", "use-cases", "agents", "trust", "comparison", "faq", "finale"]),
    );
  });

  it("sends sign-ups to /login through real links, and has a skip link, landmarks and alt text", () => {
    const doc = serverDocument();
    const signUps = Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href="/login"]')).map((a) => a.textContent?.trim());

    expect(signUps).toEqual(expect.arrayContaining(["Get started", "Start your library"]));
    expect(doc.querySelectorAll('a[href="/login"]').length).toBeGreaterThanOrEqual(3);
    expect(doc.querySelector('a[href="#main-content"]')?.textContent).toBe("Skip to content");
    expect(doc.querySelector("main#main-content")).not.toBeNull();
    expect(doc.querySelector("header nav[aria-label]")).not.toBeNull();
    expect(doc.querySelector("footer")).not.toBeNull();
    for (const img of Array.from(doc.querySelectorAll("img"))) {
      expect(img.getAttribute("alt")).toBeTruthy();
      expect(img.getAttribute("width")).toBeTruthy();
      expect(img.getAttribute("height")).toBeTruthy();
    }
  });

  it("links only blog posts that exist in content/blog, from a From the blog block", () => {
    const doc = serverDocument();
    const block = doc.querySelector('nav[aria-labelledby="footer-blog-title"]');
    const hrefs = Array.from(block?.querySelectorAll<HTMLAnchorElement>("a") ?? []).map((a) => a.getAttribute("href"));

    expect(block?.textContent).toContain("From the blog");
    expect(hrefs).toEqual(HOME_BLOG_LINKS.map((post) => `/blog/${post.slug}`));
    expect(hrefs).toEqual(
      expect.arrayContaining([
        "/blog/what-is-skill-md",
        "/blog/claude-skills-examples",
        "/blog/claude-code-subagents-vs-skills",
        "/blog/best-claude-code-skills-planning",
        "/blog/how-to-check-agent-skills-in-ci",
      ]),
    );
    for (const post of HOME_BLOG_LINKS) {
      expect(existsSync(join(BLOG_DIR, `${post.slug}.md`))).toBe(true);
    }
  });

  it("links the public catalog only when its route can answer", () => {
    expect(serverDocument().querySelector('a[href="/catalog"]')).toBeNull();

    vi.stubEnv("SKILLPACK_PUBLIC_CATALOG", "true");
    const links = Array.from(serverDocument().querySelectorAll<HTMLAnchorElement>('a[href="/catalog"]'));

    expect(links.length).toBeGreaterThan(0);
    expect(links.every((a) => a.textContent?.trim() === "Catalog")).toBe(true);
  });
});
