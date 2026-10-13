// @vitest-environment happy-dom

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { loadCatalogSkill } from "@/lib/catalog";
import { CatalogSkillView } from "./CatalogSkillView";

// SAFETY: React's test harness reads this documented global flag; the test owns its boolean value.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A published SKILL.md: frontmatter, the generated usage block, then an authored body with an H1
// and raw HTML.
const PUBLISHED_SKILL_MD = `---
name: demo
description: Does one thing.
license: MIT
---
<!-- skillpack:usage:start -->
## Skillpack runtime

Usage is observed locally by skillpack-runtime when installed through Skillpack.
<!-- skillpack:usage:end -->

# Demo

Safe text.

<div class="raw">raw html</div>

<script>alert(1)</script>
`;

const RELEASE = { version: "0.3.1", url: "https://github.com/The-Vibe-Company/skillpack/releases/tag/runtime-v0.3.1" };

const roots: Root[] = [];
const tempDirs: string[] = [];

function publishedSkill() {
  const root = mkdtempSync(join(tmpdir(), "skillpack-catalog-view-"));
  tempDirs.push(root);
  mkdirSync(join(root, "demo"));
  writeFileSync(join(root, "demo", "SKILL.md"), PUBLISHED_SKILL_MD);
  return loadCatalogSkill({ dir: "demo", install: "source" }, root);
}

async function render(element: React.ReactElement): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(element);
  });
  return container;
}

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
  tempDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

describe("catalog skill view", () => {
  it("renders the SKILL.md body without its usage block, raw HTML or a second H1", async () => {
    const container = await render(React.createElement(CatalogSkillView, { skill: publishedSkill(), release: RELEASE }));
    const body = container.querySelector(".v10-catalog__skillmd");

    expect(Array.from(container.querySelectorAll("h1")).map((h1) => h1.textContent)).toEqual(["demo"]);
    expect(Array.from(body?.querySelectorAll("h2") ?? []).map((h2) => h2.textContent)).toEqual(["Demo"]);
    expect(body?.textContent).toContain("Safe text.");
    expect(container.innerHTML).not.toContain("skillpack:usage");
    expect(body?.textContent).not.toContain("Usage is observed locally");
    expect(body?.textContent).not.toContain("Skillpack runtime");
    expect(body?.querySelector(".raw")).toBeNull();
    expect(body?.querySelector("script")).toBeNull();
    expect(body?.textContent).not.toContain("raw html");
    expect(body?.textContent).not.toContain("alert(1)");
  });

  it("links the given runtime release for the CLI installer", async () => {
    const container = await render(React.createElement(CatalogSkillView, { skill: publishedSkill(), release: RELEASE }));
    const link = container.querySelector(`a[href='${RELEASE.url}']`);

    expect(link?.textContent).toBe("Skillpack runtime 0.3.1 release");
  });
});
