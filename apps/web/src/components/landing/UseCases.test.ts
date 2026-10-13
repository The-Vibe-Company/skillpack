import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LandingPage } from "./LandingPage";
import { USE_CASES, UseCases } from "./UseCases";

/* Name rules from https://agentskills.io/specification: 1-64 chars of a-z, 0-9 and single hyphens,
   not starting or ending with a hyphen. */
const SPEC_NAME = /^(?=.{1,64}$)[a-z0-9]+(-[a-z0-9]+)*$/;

function frontmatter(markdown: string): Record<string, string> {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(markdown)?.[1] ?? "";
  return Object.fromEntries(
    block.split("\n").flatMap((line) => {
      const match = /^([a-z-]+): (.*)$/.exec(line);
      return match ? [[match[1], match[2]]] : [];
    }),
  );
}

describe("UseCases", () => {
  it("renders the section after How it works and before Agents in the server HTML", () => {
    const html = renderToStaticMarkup(React.createElement(LandingPage));
    const how = html.indexOf('id="how"');
    const useCases = html.indexOf('id="use-cases"');
    const agents = html.indexOf('id="agents"');

    expect(how).toBeGreaterThan(-1);
    expect(useCases).toBeGreaterThan(how);
    expect(agents).toBeGreaterThan(useCases);
  });

  it("renders one H3 and one SKILL.md snippet per use case as static markup", () => {
    const html = renderToStaticMarkup(React.createElement(UseCases));

    expect(html).toContain("<h2");
    expect(html).toContain("What teams put in");
    expect(USE_CASES.map((u) => u.title)).toEqual([
      "Code review",
      "Deploy and release",
      "Incident triage",
      "Release notes",
      "Onboarding",
    ]);
    for (const u of USE_CASES) {
      expect(html).toContain(`<h3>${u.title}</h3>`);
      expect(html).toContain(`<code>${u.name}/SKILL.md</code>`);
    }
    expect(html.match(/<pre>/g)).toHaveLength(USE_CASES.length);
    expect(html).toContain('href="/blog/what-is-skill-md"');
  });

  it("uses spec-valid frontmatter and labels invented snippets as illustrative", () => {
    const html = renderToStaticMarkup(React.createElement(UseCases));

    for (const u of USE_CASES) {
      expect(u.name).toMatch(SPEC_NAME);
      expect(u.description.length).toBeGreaterThan(0);
      expect(u.description.length).toBeLessThanOrEqual(1024);
      if (!u.source) expect(u.description).toMatch(/\bUse when\b/);
    }
    const illustrative = USE_CASES.filter((u) => !u.source).length;
    expect(html.match(/Illustrative example/g)).toHaveLength(illustrative);
    expect(html).not.toMatch(/ships with Skillpack|bundled with Skillpack/i);
  });

  it("quotes repository examples verbatim so the snippet cannot drift from the real skill", () => {
    const sourced = USE_CASES.filter((u) => u.source);
    expect(sourced.length).toBeGreaterThan(0);

    for (const u of sourced) {
      const path = /\/tree\/main\/(examples\/skills\/[a-z0-9-]+)$/.exec(u.source ?? "")?.[1];
      expect(path).toBe(`examples/skills/${u.name}`);
      const markdown = readFileSync(new URL(`../../../../../${path}/SKILL.md`, import.meta.url), "utf8");
      const fields = frontmatter(markdown);
      const prose = markdown.replace(/\s+/g, " ");

      expect(fields.name).toBe(u.name);
      expect(fields.description).toBe(u.description);
      for (const line of u.body) expect(prose).toContain(line);
    }
  });
});
