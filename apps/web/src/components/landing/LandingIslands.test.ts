import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LandingPage } from "./LandingPage";

describe("LandingPage server rendering", () => {
  it("stays a server component and keeps hooks in client islands", () => {
    const source = readFileSync(new URL("./LandingPage.tsx", import.meta.url), "utf8");

    expect(source).not.toMatch(/^\s*["']use client["']/);
    expect(source).not.toMatch(/\buse(State|Effect|Ref|Reducer|LayoutEffect)\b/);
    expect(readFileSync(new URL("./PortalDemo.tsx", import.meta.url), "utf8")).toMatch(/^"use client";/);
    expect(readFileSync(new URL("./LandingReveal.tsx", import.meta.url), "utf8")).toMatch(/^"use client";/);
    // Motion code loads lazily, in its own chunk, after hydration.
    const motion = readFileSync(new URL("./LandingMotion.tsx", import.meta.url), "utf8");
    expect(motion).toMatch(/^"use client";/);
    expect(motion).toMatch(/dynamic\(\(\) => import\("\.\/LandingReveal"\)[\s\S]*ssr: false/);
    expect(source).not.toContain('from "./LandingReveal"');
    expect(readFileSync(new URL("./FaqSection.tsx", import.meta.url), "utf8")).not.toMatch(/^\s*["']use client["']/);
  });

  it("server-renders the static copy with a hidden placeholder in place of the lazy demo", () => {
    const html = renderToStaticMarkup(React.createElement(LandingPage));

    expect(html).toContain('<h1 class="lp-h1" id="hero-title">The <span class="hm-nowrap">open-source</span> <em class="lp-em">Skills Hub</em> for Claude Code, Codex &amp; OpenCode</h1>');
    expect(html).toContain('id="problem"');
    expect(html).toContain('id="start"');
    expect(html).toContain('id="faq"');
    expect(html).toContain('"@type":"FAQPage"');
    expect(html).toContain('<div class="v10-libframe v6-pframe lp-portal-placeholder" aria-hidden="true">');
    expect(html).not.toContain('data-screen-label="portal-capture"');
    expect(html).not.toContain("Share a skill");
    expect(html).not.toContain("click around: filter, pick a skill.");
  });
});
