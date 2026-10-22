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
    expect(readFileSync(new URL("./FaqSection.tsx", import.meta.url), "utf8")).not.toMatch(/^\s*["']use client["']/);
  });

  it("server-renders the static copy with a hidden placeholder in place of the lazy demo", () => {
    const html = renderToStaticMarkup(React.createElement(LandingPage));

    expect(html).toContain('<h1 class="lp-h1 lp-rise lp-rise--2">The open-source <em class="lp-em lp-em--shine">Skills Hub</em> for Claude Code, Codex &amp; OpenCode</h1>');
    // Motion polish is CSS on server-rendered markup: real text, decorative layers hidden from assistive tech.
    expect(html).toContain('<div class="lp-hero__bg lp-ambient" aria-hidden="true"></div>');
    expect(html).toContain('<div class="lp-finale__bg lp-ambient" aria-hidden="true"></div>');
    expect(html.match(/class="v10-btn v10-btn--primary v10-btn--lg lp-cta"/g)).toHaveLength(2);
    expect(html.match(/class="lp-(step|fact) lp-glow v5-reveal"/g)).toHaveLength(10);
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
