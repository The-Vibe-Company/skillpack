// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

async function renderLanding(): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(React.createElement(LandingPage));
  });
  return container;
}

function portal(container: HTMLElement): HTMLElement {
  const match = container.querySelector<HTMLElement>('[data-screen-label="portal-capture"]');
  if (!match) throw new Error("Portal capture not found");
  return match;
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not found: ${text}`);
  return match;
}

function navButton(container: HTMLElement, label: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll<HTMLButtonElement>(".v5-portal__navitem")).find(
    (candidate) => candidate.textContent?.trim().startsWith(label),
  );
  if (!match) throw new Error(`Portal navigation button not found: ${label}`);
  return match;
}

function row(container: HTMLElement, id: string): HTMLElement {
  const match = Array.from(container.querySelectorAll<HTMLElement>('[role="button"]')).find(
    (candidate) => candidate.querySelector(".v5-portal__name")?.textContent === id,
  );
  if (!match) throw new Error(`Portal row not found: ${id}`);
  return match;
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
});

describe("LandingPage portal preview", () => {
  it("models the canonical personal and organization libraries without retired stars or teams", async () => {
    const container = await renderLanding();
    const capture = portal(container);

    expect(capture.querySelectorAll(".v5-portal__crow")).toHaveLength(5);
    expect(navButton(capture, "Organization").getAttribute("aria-current")).toBe("true");
    expect(capture.textContent).not.toContain("Starred");
    expect(capture.textContent).not.toContain("Team picks");
    expect(capture.textContent).not.toContain("Teams");
    expect(capture.textContent).toContain("click around: filter, pick a skill.");

    await act(async () => navButton(capture, "My Skills").click());

    expect(capture.querySelectorAll(".v5-portal__crow")).toHaveLength(1);
    expect(row(capture, "incident-notes").getAttribute("aria-pressed")).toBe("true");
    expect(capture.querySelector(".v6-pdrawer__title")?.textContent).toBe("incident-notes");

    const clearLibrary = capture.querySelector<HTMLButtonElement>('[aria-label="Clear library filter"]');
    if (!clearLibrary) throw new Error("Clear library filter button not found");
    await act(async () => clearLibrary.click());
    expect(navButton(capture, "Organization").getAttribute("aria-current")).toBe("true");
    expect(capture.querySelectorAll(".v5-portal__crow")).toHaveLength(5);

    await act(async () => navButton(capture, "My Skills").click());
    await act(async () => button(capture, "Recently updated").click());

    expect(capture.querySelectorAll(".v5-portal__crow")).toHaveLength(0);
    expect(capture.textContent).toContain("No recently updated skills in My Skills.");
    expect(capture.textContent).toContain("No skill selected.");
  });

  it("supports mouse and keyboard selection and keeps installation feedback in the focused control", async () => {
    const container = await renderLanding();
    const capture = portal(container);
    const triage = row(capture, "triage");

    await act(async () => triage.click());
    expect(triage.getAttribute("aria-pressed")).toBe("true");
    expect(capture.querySelector(".v6-pdrawer__title")?.textContent).toBe("triage");

    const releaseNotes = row(capture, "release-notes");

    releaseNotes.focus();
    await act(async () => {
      releaseNotes.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(releaseNotes.getAttribute("aria-pressed")).toBe("true");
    expect(capture.querySelector(".v6-pdrawer__title")?.textContent).toBe("release-notes");

    const install = button(capture, "Install");
    install.focus();
    await act(async () => install.click());

    expect(document.activeElement).toBe(install);
    expect(install.disabled).toBe(false);
    expect(install.getAttribute("aria-disabled")).toBe("true");
    expect(install.getAttribute("aria-pressed")).toBe("true");
    expect(install.textContent?.trim()).toBe("Installed");

    const migrateDb = row(capture, "migrate-db");
    await act(async () => {
      migrateDb.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    });
    expect(migrateDb.getAttribute("aria-pressed")).toBe("true");
  });

  it("uses native links for navigation and avoids absolute data-residency promises", async () => {
    const container = await renderLanding();
    const share = Array.from(container.querySelectorAll("a")).find(
      (candidate) => candidate.textContent?.trim() === "Share a skill",
    );
    const howItWorks = Array.from(container.querySelectorAll("a")).find(
      (candidate) => candidate.textContent?.trim() === "See how it works",
    );
    const github = Array.from(container.querySelectorAll("a")).find(
      (candidate) => candidate.textContent?.trim() === "GitHub ↗",
    );
    const vibeCompany = Array.from(container.querySelectorAll("a")).find(
      (candidate) => candidate.textContent?.trim() === "The Vibe Company",
    );
    const privacy = Array.from(container.querySelectorAll("a")).find(
      (candidate) => candidate.textContent?.trim() === "Privacy",
    );

    expect(share?.getAttribute("href")).toBe("/login");
    expect(howItWorks?.getAttribute("href")).toBe("#problem");
    expect(github?.getAttribute("href")).toBe("https://github.com/The-Vibe-Company/skillpack");
    expect(github?.getAttribute("target")).toBe("_blank");
    expect(vibeCompany?.getAttribute("href")).toBe("https://thevibecompany.co");
    expect(vibeCompany?.getAttribute("target")).toBe("_blank");
    const navBlog = container.querySelector<HTMLAnchorElement>('nav[aria-label="Sections"] a[href="/blog"]');
    const footerBlog = container.querySelector<HTMLAnchorElement>('.v10-footer__links a[href="/blog"]');

    expect(privacy?.getAttribute("href")).toBe("/privacy");
    expect(navBlog?.textContent?.trim()).toBe("Blog");
    expect(navBlog?.className).toBe("v10-nav__link");
    expect(footerBlog?.textContent?.trim()).toBe("Blog");
    expect(container.textContent).toContain("an open source tool by The Vibe Company");
    expect(container.textContent).toContain("governance stays on infrastructure you control");
    expect(container.textContent).not.toContain("your data never leave the building");
  });

  it("keeps one H1 and gives every section a descriptive H2", async () => {
    const container = await renderLanding();
    const sectionHeading = (id: string) => container.querySelector(`#${id} h2`)?.textContent;

    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector('[data-screen-label="agents-strip"] h2')?.textContent).toBe(
      "Install skills into Claude Code, Codex and OpenCode",
    );
    expect(sectionHeading("problem")).toBe("Why teams need a private skills registry");
    expect(sectionHeading("how")).toBe("How Skillpack versions and installs SKILL.md packages");
    expect(sectionHeading("agents")).toBe("Connect Claude Code, Codex and OpenCode securely");
    expect(sectionHeading("open-source")).toBe("Open-source, self-hosted skills hub");
  });

  it("keeps landing claims verifiable: no demo metrics, real CLI install flow and only supported --tools agents", async () => {
    const container = await renderLanding();
    const strip = container.querySelector<HTMLElement>('[data-screen-label="agents-strip"]');
    const agents = Array.from(strip?.querySelectorAll(".lp-agent") ?? []).map((agent) => agent.lastChild?.textContent);
    const installStep = Array.from(container.querySelectorAll<HTMLElement>(".lp-step")).find(
      (step) => step.querySelector("h3")?.textContent === "Install everywhere",
    );

    expect(agents).toEqual(["Claude Code", "Codex", "OpenCode"]);
    expect(container.textContent).not.toContain("Any MCP client");
    expect(Array.from(container.querySelectorAll(".lp-hub__node strong")).map((node) => node.textContent)).toEqual([
      "Claude Code",
      "OpenCode",
      "Codex",
    ]);
    expect(container.textContent).not.toContain("12,480");
    expect(container.textContent).not.toContain("last 30 days");
    expect(installStep?.textContent).toContain("--tools");
    expect(installStep?.textContent).toContain("sha256");
    expect(installStep?.textContent).toContain("--pin");
    expect(installStep?.textContent).toContain("skillpack update --all --dry-run");
    expect(installStep?.textContent).toContain("skillpack sync --frozen");
    expect(installStep?.textContent).not.toContain("when the checksum changes");
  });

  it("publishes SoftwareApplication and Organization JSON-LD for search engines", async () => {
    const container = await renderLanding();
    const scripts = container.querySelectorAll('script[type="application/ld+json"]');

    expect(scripts).toHaveLength(2);
    expect(JSON.parse(scripts[0]?.textContent ?? "null")).toMatchObject({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "SoftwareApplication", name: "Skillpack", applicationCategory: "DeveloperApplication" },
        { "@type": "Organization", name: "Skillpack", url: "https://skillpack.app" },
      ],
    });
  });
});
