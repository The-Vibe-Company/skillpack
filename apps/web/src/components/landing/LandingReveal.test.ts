// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LandingReveal } from "./LandingReveal";

// SAFETY: React's test harness reads this documented global flag; the test owns its boolean value.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const observers: ControlledIntersectionObserver[] = [];
let frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
let root: Root | null = null;

function flushFrames() {
  const queued = Array.from(frames.values());
  frames = new Map();
  queued.forEach((run) => run(0));
}

class ControlledIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly thresholds = [0];
  readonly targets: Element[] = [];

  constructor(private readonly callback: IntersectionObserverCallback) {
    observers.push(this);
  }

  observe(target: Element) {
    this.targets.push(target);
  }

  emit(target: Element, isIntersecting: boolean) {
    // SAFETY: This fixture supplies the two IntersectionObserverEntry fields LandingReveal reads.
    this.callback([{ isIntersecting, target } as IntersectionObserverEntry], this);
  }

  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
}

function stubMotionPreference(allowsGlow: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: allowsGlow, media: query }));
}

async function mountOver(markup: string) {
  document.body.innerHTML = `${markup}<div id="island"></div>`;
  root = createRoot(document.getElementById("island")!);
  await act(async () => root!.render(React.createElement(LandingReveal)));
}

function movePointer(target: Element, x: number, y: number) {
  target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: x, clientY: y }));
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", ControlledIntersectionObserver);
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
    nextFrame += 1;
    frames.set(nextFrame, run);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  observers.splice(0);
  frames = new Map();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("LandingReveal", () => {
  it("leaves ambient backgrounds running until they scroll off-screen, then resumes them", async () => {
    stubMotionPreference(true);
    await mountOver('<div class="lp-hero__bg lp-ambient"></div>');
    const ambient = document.querySelector(".lp-ambient")!;
    const observer = observers.find((candidate) => candidate.targets.includes(ambient))!;

    expect(ambient.classList.contains("lp-ambient--paused")).toBe(false);
    observer.emit(ambient, false);
    expect(ambient.classList.contains("lp-ambient--paused")).toBe(true);
    observer.emit(ambient, true);
    expect(ambient.classList.contains("lp-ambient--paused")).toBe(false);
  });

  it("tracks the pointer on glow cards for fine pointers with motion allowed", async () => {
    stubMotionPreference(true);
    await mountOver('<div class="lp-glow"><p>Card</p></div>');
    const card = document.querySelector<HTMLElement>(".lp-glow")!;

    movePointer(card.querySelector("p")!, 10, 4);
    movePointer(card.querySelector("p")!, 40, 12);

    expect(frames.size).toBe(1);
    expect(card.style.getPropertyValue("--lp-mx")).toBe("");
    flushFrames();
    expect(card.style.getPropertyValue("--lp-mx")).toBe("40px");
    expect(card.style.getPropertyValue("--lp-my")).toBe("12px");
  });

  it("leaves glow cards untouched when the visitor prefers reduced motion or has no fine pointer", async () => {
    stubMotionPreference(false);
    await mountOver('<div class="lp-glow"><p>Card</p></div>');
    const card = document.querySelector<HTMLElement>(".lp-glow")!;

    movePointer(card, 40, 12);
    flushFrames();

    expect(frames.size).toBe(0);
    expect(card.style.getPropertyValue("--lp-mx")).toBe("");
  });

  it("cancels a pending frame and stops listening after unmount", async () => {
    stubMotionPreference(true);
    await mountOver('<div class="lp-glow"></div>');
    const card = document.querySelector<HTMLElement>(".lp-glow")!;

    movePointer(card, 40, 12);
    expect(frames.size).toBe(1);
    act(() => root?.unmount());
    root = null;
    expect(frames.size).toBe(0);
    movePointer(card, 50, 20);
    flushFrames();

    expect(card.style.getPropertyValue("--lp-mx")).toBe("");
  });
});
