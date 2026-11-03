// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LandingReveal } from "./LandingReveal";

/**
 * Product promise:
 * Landing copy is never hidden for visitors who reduce motion, and only blocks still below the fold
 * wait for their one-time reveal. The phone menu closes on a followed link, an outside click and
 * Escape, which hands focus back to its button.
 *
 * Why this test is component-level:
 * The behaviour lives entirely in this client island and the DOM it observes.
 */

// SAFETY: React's test harness reads this documented global flag; the test owns its boolean value.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const observed: Element[] = [];
const observers: RecordingIntersectionObserver[] = [];

class RecordingIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly thresholds = [0];
  constructor(private readonly callback: IntersectionObserverCallback) {
    observers.push(this);
  }
  observe(target: Element) {
    observed.push(target);
  }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  /** Reports `target` as scrolled into view. */
  enter(target: Element) {
    // SAFETY: This fixture supplies the two IntersectionObserverEntry fields the island reads.
    this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this);
  }
}

function stubBrowser(reduceMotion: boolean) {
  vi.stubGlobal("IntersectionObserver", RecordingIntersectionObserver);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduceMotion && query.includes("reduce"), media: query }));
}

function page() {
  document.body.innerHTML = `
    <details class="hm-menu" open><summary>Menu</summary><nav><a href="#how">How it works</a></nav></details>
    <p id="outside">Outside</p>
    <h2 class="v5-reveal" id="above">Above the fold</h2>
    <h2 class="v5-reveal" id="below">Below the fold</h2>`;
  const above = document.getElementById("above")!;
  const below = document.getElementById("below")!;
  vi.spyOn(above, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 100, 300, 40));
  vi.spyOn(below, "getBoundingClientRect").mockReturnValue(new DOMRect(0, window.innerHeight + 400, 300, 40));
  const menu = document.querySelector<HTMLDetailsElement>(".hm-menu")!;
  return { above, below, menu };
}

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(React.createElement(LandingReveal)));
}

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  observed.splice(0);
  observers.splice(0);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("LandingReveal", () => {
  it("hides nothing when the visitor prefers reduced motion", async () => {
    stubBrowser(true);
    const { above, below } = page();
    await mount();

    expect(document.querySelectorAll(".v5-reveal--wait")).toHaveLength(0);
    expect(above.className).toBe("v5-reveal");
    expect(below.className).toBe("v5-reveal");
    expect(observed).toHaveLength(0);
  });

  it("holds back only blocks below the fold and shows each once it scrolls in", async () => {
    stubBrowser(false);
    const { above, below } = page();
    await mount();

    expect(above.classList.contains("v5-reveal--wait")).toBe(false);
    expect(below.classList.contains("v5-reveal--wait")).toBe(true);
    expect(observed).toEqual([below]);

    act(() => observers.at(-1)?.enter(below));

    expect(below.classList.contains("v5-reveal--wait")).toBe(false);
    expect(below.classList.contains("v5-reveal--in")).toBe(true);
  });

  it("closes the phone menu on a followed link, an outside click and Escape", async () => {
    stubBrowser(false);
    const { menu } = page();
    await mount();

    act(() => menu.querySelector("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(menu.open).toBe(false);

    menu.open = true;
    act(() => menu.querySelector("summary")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    menu.open = true;
    act(() => document.getElementById("outside")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(menu.open).toBe(false);

    menu.open = true;
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(menu.open).toBe(false);
    expect(document.activeElement).toBe(menu.querySelector("summary"));
  });
});
