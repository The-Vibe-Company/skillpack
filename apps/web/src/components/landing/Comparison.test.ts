// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Comparison } from "./Comparison";
import { LandingPage } from "./LandingPage";

// SAFETY: React's test harness reads this documented global flag; the test owns its boolean value.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly thresholds = [0];

  constructor(private readonly callback: IntersectionObserverCallback) {}

  observe(target: Element) {
    this.callback(
      // SAFETY: This test fixture supplies the two IntersectionObserverEntry fields useReveal reads.
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      this,
    );
  }

  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
}

async function render(component: React.FunctionComponent): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(React.createElement(component));
  });
  return container;
}

function section(container: HTMLElement): HTMLElement {
  const match = container.querySelector<HTMLElement>("section#compare");
  if (!match) throw new Error("Comparison section not found");
  return match;
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
});

describe("Landing comparison", () => {
  it("sits directly after the open-source section", async () => {
    const container = await render(LandingPage);
    const ids = Array.from(container.querySelectorAll("main > section")).map((candidate) => candidate.id);

    expect(ids.indexOf("compare")).toBe(ids.indexOf("open-source") + 1);
  });

  it("renders an accessible table with a caption, column headers and row headers", async () => {
    const compare = section(await render(Comparison));
    const table = compare.querySelector("table");
    const region = compare.querySelector('[role="region"]');

    expect(compare.querySelector("h2")?.textContent).toBe("Skillpack vs public skills directories vs gists and Slack");
    expect(table?.querySelector("caption")?.textContent).toContain("Varies");
    expect(region?.getAttribute("aria-labelledby")).toBe(table?.querySelector("caption")?.id);
    expect(region?.getAttribute("tabindex")).toBe("0");
    expect(Array.from(table?.querySelectorAll('thead th[scope="col"]') ?? []).map((th) => th.textContent)).toEqual([
      "Capability",
      "Skillpack",
      "Public skills directories",
      "Gists & Slack",
    ]);

    const rows = Array.from(table?.querySelectorAll("tbody tr") ?? []);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.querySelector('th[scope="row"]')).not.toBeNull();
      expect(row.querySelectorAll("td")).toHaveLength(3);
    }
  });

  it("only cites real CLI commands and supported tool ids", async () => {
    const compare = section(await render(Comparison));
    const commands = Array.from(compare.querySelectorAll("code")).map((code) => code.textContent ?? "");

    expect(commands).toContain("skillpack sync --frozen");
    expect(commands).toContain("skillpack skills validate");
    for (const command of commands) expect(command).toMatch(/^skillpack (install|update|sync|setup|doctor|skills) /);

    const tools = commands.flatMap((command) => command.match(/--tools (\S+)/)?.[1]?.split(",") ?? []);
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) expect(["codex", "claude-code", "opencode"]).toContain(tool);
  });

  it("keeps competitor columns generic and avoids unverifiable claims", async () => {
    const text = section(await render(Comparison)).textContent ?? "";

    for (const banned of [
      "skills.sh",
      "skillsdirectory",
      "agensi",
      "smithery",
      "aiskill",
      "Cursor",
      "npm install",
      "skills install",
      "Free",
      "SOC 2",
      "ISO",
    ]) {
      expect(text).not.toContain(banned);
    }
  });
});
