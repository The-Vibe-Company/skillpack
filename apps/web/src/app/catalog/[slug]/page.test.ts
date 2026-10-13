// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import CatalogSkillPage, { dynamicParams, generateMetadata, generateStaticParams } from "./page";

// SAFETY: React's test harness reads this documented global flag; the test owns its boolean value.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

function routeProps(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

async function renderSkill(slug: string): Promise<HTMLElement> {
  const page = await CatalogSkillPage(routeProps(slug));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(page);
  });
  return container;
}

function textOf(container: HTMLElement, selector: string): string[] {
  return Array.from(container.querySelectorAll(selector)).map((node) => node.textContent ?? "");
}

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
});

describe("public catalog skill page", () => {
  it("prerenders every catalog skill and 404s any other slug", async () => {
    expect(generateStaticParams()).toEqual([{ slug: "skillpack" }, { slug: "incident-summary" }]);
    expect(dynamicParams).toBe(false);
    await expect(CatalogSkillPage(routeProps("no-such-skill"))).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
    await expect(generateMetadata(routeProps("no-such-skill"))).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
  });

  it("shows the frontmatter facts, files and source link, with the skill name as the only H1", async () => {
    const container = await renderSkill("skillpack");

    expect(textOf(container, "h1")).toEqual(["skillpack"]);
    // The SKILL.md body's authored "# Skillpack" is demoted under the page's H1.
    expect(textOf(container, ".v10-catalog__skillmd h2")[0]).toBe("Skillpack");
    expect(textOf(container, ".v10-catalog__facts dt")).toEqual(["License", "Compatibility", "Allowed tools", "Source"]);
    expect(textOf(container, ".v10-catalog__facts dd")).toEqual([
      "MIT",
      "claude-code codex opencode grok-bot openclaw hermes companion",
      "read_file write_file run_shell",
      "GitHub",
    ]);
    expect(container.querySelector(".v10-catalog__facts a")?.getAttribute("href")).toBe(
      "https://github.com/The-Vibe-Company/skillpack/tree/main/packages/skillpack-skill/skill",
    );
    expect(textOf(container, ".v10-catalog__files li")).toEqual(expect.arrayContaining(["SKILL.md", "reference/api.md"]));
  });

  it("gives the management skill its real CLI install commands", async () => {
    const container = await renderSkill("skillpack");
    const commands = textOf(container, ".v10-blog__article > .v10-blog__prose pre code");

    expect(commands).toEqual(["skillpack auth login\nskillpack install skillpack"]);
    const release = container.querySelector("a[href*='/releases/tag/runtime-v']");
    expect(release?.textContent).toMatch(/^Skillpack runtime \d+\.\d+\.\d+ release$/);
  });

  it("does not claim an install command for a source-only skill", async () => {
    const container = await renderSkill("incident-summary");
    const install = container.querySelector(".v10-blog__article > .v10-blog__prose");

    expect(install?.textContent).not.toContain("skillpack install");
    expect(install?.querySelectorAll("pre")).toHaveLength(0);
    const source = Array.from(install?.querySelectorAll("a") ?? []).find((a) => a.textContent === "View source on GitHub");
    expect(source?.getAttribute("href")).toBe(
      "https://github.com/The-Vibe-Company/skillpack/tree/main/examples/skills/incident-summary",
    );
    expect(textOf(container, ".v10-catalog__facts dt")).toEqual(["License", "Allowed tools", "Source"]);
    expect(textOf(container, ".v10-catalog__files li")).toEqual(["SKILL.md", "companion.json", "scripts/summarize.py"]);
  });

  it("publishes SoftwareSourceCode JSON-LD with only frontmatter facts and the source folder", async () => {
    const container = await renderSkill("incident-summary");
    const script = container.querySelector("script[type='application/ld+json']");

    expect(JSON.parse(script?.textContent ?? "{}")).toEqual({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "SoftwareSourceCode",
          name: "incident-summary",
          description: "Summarize an incident timeline from logs into a concise postmortem draft.",
          license: "MIT",
          codeRepository: "https://github.com/The-Vibe-Company/skillpack/tree/main/examples/skills/incident-summary",
        },
      ],
    });
  });

  it("gives each skill a plain title, its description and a canonical URL", async () => {
    const metadata = await generateMetadata(routeProps("incident-summary"));

    // The layout template appends " · Skillpack".
    expect(metadata.title).toBe("incident-summary");
    expect(metadata.description).toBe("Summarize an incident timeline from logs into a concise postmortem draft.");
    expect(metadata.alternates?.canonical).toBe("/catalog/incident-summary");
    expect(metadata.openGraph).toMatchObject({ url: "/catalog/incident-summary", title: "incident-summary · Skillpack" });
  });
});
