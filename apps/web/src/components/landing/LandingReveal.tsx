"use client";

import { useEffect } from "react";

/**
 * Client island for the landing's scroll reveal; the page itself renders on the server.
 *
 * Everything is visible in the server HTML and before hydration. After hydration, and only when the
 * visitor accepts motion, blocks still below the fold wait (transform and opacity only, so nothing
 * moves the layout) and play once as they scroll in. Blocks already on screen never animate.
 * It also closes the phone menu when one of its links is followed.
 */
export function LandingReveal() {
  useEffect(() => {
    const closeMenu = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const menu = target.closest(".hm-menu");
      if (menu && target.closest("a")) menu.removeAttribute("open");
    };
    document.addEventListener("click", closeMenu);

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
      document.removeEventListener("click", closeMenu);
      clearTimeout(fallback);
      io?.disconnect();
    };
  }, []);
  return null;
}
