// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodeBlock } from "./CodeBlock";
import { StickyCta } from "./ranking/StickyCta";
import { ReadingProgress } from "./ReadingProgress";
import { TocActiveState } from "./TocActiveState";

/*
 * The blog's only client code: the copy button, the table-of-contents highlight, the reading
 * progress bar and the ranking posts' sticky sign-up bar. A copy that claims success after a blocked clipboard, a highlight stuck on the
 * wrong section, or a bar that overflows its track fails the assertions below.
 */

// SAFETY: React's test harness reads this documented global flag; the test owns its boolean value.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

async function render(element: React.ReactElement) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(element);
  });
  return container;
}

function placeAt(element: Element, top: number, height = 40) {
  // SAFETY: happy-dom does no layout; the islands read only `top` and `height` from this rect.
  element.getBoundingClientRect = () => ({ top, height }) as DOMRect;
}

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("code block copy button", () => {
  async function renderBlock() {
    const code = React.createElement("code", { className: "language-bash" }, "skillpack sync --frozen\n");
    return render(React.createElement(CodeBlock, { language: "bash" }, code));
  }

  it("copies the block's code without the trailing newline and announces it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const container = await renderBlock();
    const button = container.querySelector<HTMLButtonElement>("button[aria-label='Copy code']");

    expect(button?.type).toBe("button");
    expect(button?.textContent).toBe("Copy");
    await act(async () => {
      button?.click();
    });

    expect(writeText).toHaveBeenCalledWith("skillpack sync --frozen");
    expect(button?.dataset.state).toBe("copied");
    expect(button?.textContent).toBe("Copied");
    expect(container.querySelector("[role='status']")?.textContent).toBe("Code copied to clipboard");
  });

  it("says the copy failed when the clipboard is blocked, then resets", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const container = await renderBlock();
    const button = container.querySelector<HTMLButtonElement>("button[aria-label='Copy code']");

    await act(async () => {
      button?.click();
    });
    expect(button?.textContent).toBe("Copy failed");
    expect(container.querySelector("[role='status']")?.textContent).toBe("Could not copy code");

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(button?.textContent).toBe("Copy");
    expect(container.querySelector("[role='status']")?.textContent).toBe("");
  });
});

describe("table of contents active state", () => {
  it("marks the last heading that has scrolled past the top third of the viewport", async () => {
    document.body.innerHTML = `
      <nav><a href="#one" data-toc-link="one">One</a><a href="#two" data-toc-link="two">Two</a><a href="#three" data-toc-link="three">Three</a></nav>
      <h2 id="one">One</h2><h2 id="two">Two</h2><h2 id="three">Three</h2>`;
    const byId = (id: string) => {
      const element = document.getElementById(id);
      if (!element) throw new Error(`missing #${id}`);
      return element;
    };
    const [one, two, three] = [byId("one"), byId("two"), byId("three")];
    placeAt(one, -400);
    placeAt(two, 50);
    placeAt(three, window.innerHeight);
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 10_000 });

    await render(React.createElement(TocActiveState, { ids: ["one", "two", "three"] }));
    const current = () => Array.from(document.querySelectorAll("[aria-current='location']")).map((a) => a.textContent);
    expect(current()).toEqual(["Two"]);

    placeAt(two, window.innerHeight);
    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });
    expect(current()).toEqual(["One"]);
  });
});

describe("reading progress bar", () => {
  it("fills with the share of the article scrolled past, clamped to the track", async () => {
    document.body.innerHTML = `<div id="article-body"></div>`;
    const article = document.getElementById("article-body") ?? document.body;
    const readable = 1000;
    placeAt(article, -250, readable + window.innerHeight);

    const container = await render(React.createElement(ReadingProgress, { targetId: "article-body" }));
    const fill = container.querySelector<HTMLElement>(".v10-progress__fill");
    expect(container.querySelector(".v10-progress")?.getAttribute("aria-hidden")).toBe("true");
    expect(fill?.style.transform).toBe("scaleX(0.25)");

    placeAt(article, -5000, readable + window.innerHeight);
    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });
    expect(fill?.style.transform).toBe("scaleX(1)");
  });
});

describe("sticky sign-up bar", () => {
  type Observed = { target: Element; callback: IntersectionObserverCallback };
  let observed: Observed[] = [];

  function stubObserver() {
    observed = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(private readonly callback: IntersectionObserverCallback) {}
        observe(target: Element) {
          observed.push({ target, callback: this.callback });
        }
        // next/link observes its anchor for prefetching; the bar's own markers are found by id.
        unobserve() {}
        disconnect() {}
      },
    );
  }

  function report(id: string, isIntersecting: boolean, top: number) {
    const entry = observed.find((item) => item.target.id === id);
    // SAFETY: StickyCta reads only `isIntersecting` and `boundingClientRect.top` from the entry and never touches the observer argument.
    act(() => entry?.callback([{ isIntersecting, boundingClientRect: { top } } as IntersectionObserverEntry], {} as IntersectionObserver));
  }

  async function renderBar() {
    for (const id of ["start", "end"]) document.body.appendChild(Object.assign(document.createElement("div"), { id }));
    const container = await render(
      React.createElement(StickyCta, { title: "Your team's skills.", label: "Sign up", href: "/login", showAfterId: "start", hideWhenVisibleId: "end" }),
    );
    return container.querySelector<HTMLElement>(".v10-stickycta");
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it("stays hidden and inert until the reader scrolls past the header, and steps aside at the end", async () => {
    stubObserver();
    const bar = await renderBar();

    expect(bar?.dataset.visible).toBe("false");
    expect(bar?.hasAttribute("inert")).toBe(true);
    report("start", true, 10);
    expect(bar?.dataset.visible).toBe("false");
    report("start", false, -400);
    expect(bar?.dataset.visible).toBe("true");
    expect(bar?.hasAttribute("inert")).toBe(false);
    report("end", true, 300);
    expect(bar?.dataset.visible).toBe("false");
    // Below the viewport is not past it: scrolling back up to the top hides the bar again.
    report("end", false, 900);
    report("start", false, 900);
    expect(bar?.dataset.visible).toBe("false");
  });

  it("stays closed for the session once dismissed", async () => {
    stubObserver();
    const bar = await renderBar();
    report("start", false, -400);

    act(() => bar?.querySelector<HTMLButtonElement>("button[aria-label='Dismiss']")?.click());

    expect(bar?.dataset.visible).toBe("false");
    expect(window.sessionStorage.getItem("skillpack:blog-sticky-cta-dismissed")).toBe("1");
    act(() => roots.splice(0).forEach((root) => root.unmount()));
    document.body.innerHTML = "";
    const again = await renderBar();
    report("start", false, -400);
    expect(again?.dataset.visible).toBe("false");
  });
});
