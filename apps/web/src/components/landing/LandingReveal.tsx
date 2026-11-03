"use client";

import { useEffect } from "react";

/**
 * Client island for the landing's scroll reveal; the page itself renders on the server.
 *
 * Everything is visible in the server HTML and before hydration. After hydration, and only when the
 * visitor accepts motion, blocks still below the fold wait (transform and opacity only, so nothing
 * moves the layout) and play once as they scroll in. Blocks already on screen never animate.
 * It also dismisses the phone menu (followed link, outside click, Escape).
 */
export function LandingReveal() {
  useEffect(() => {
    // The phone menu is a native <details>: it opens without script; once hydrated it also closes on
    // a followed link, a click or tap outside it, and Escape (which returns focus to its button).
    const openMenu = () => document.querySelector<HTMLDetailsElement>(".hm-menu[open]");
    const onClick = (event: MouseEvent) => {
      const menu = openMenu();
      const target = event.target;
      if (!menu || !(target instanceof Element)) return;
      if (!menu.contains(target) || target.closest("a")) menu.removeAttribute("open");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const menu = openMenu();
      if (event.key !== "Escape" || !menu) return;
      menu.removeAttribute("open");
      menu.querySelector<HTMLElement>("summary")?.focus();
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKeyDown);

    let io: IntersectionObserver | null = null;
    let fallback: ReturnType<typeof setTimeout> | undefined;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (!reduced) {
      const fold = window.innerHeight;
      // Read every position first, then write, so the pass costs one layout.
      const pending = Array.from(document.querySelectorAll(".v5-reveal")).filter((el) => el.getBoundingClientRect().top > fold);
      const show = (el: Element) => {
        el.classList.remove("v5-reveal--wait");
        el.classList.add("v5-reveal--in");
      };
      let fired = false;
      io = new IntersectionObserver(
        (entries) => {
          fired = true;
          entries.forEach((e) => {
            if (e.isIntersecting) {
              show(e.target);
              io?.unobserve(e.target);
            }
          });
        },
        { rootMargin: "0px 0px -8% 0px" },
      );
      pending.forEach((el) => {
        el.classList.add("v5-reveal--wait");
        io?.observe(el);
      });
      /* Fail open: if IO never fires (some embedded contexts), show everything. */
      fallback = setTimeout(() => {
        if (!fired) pending.forEach(show);
      }, 700);
    }
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKeyDown);
      clearTimeout(fallback);
      io?.disconnect();
    };
  }, []);
  return null;
}
