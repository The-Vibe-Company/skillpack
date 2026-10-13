"use client";

import { useEffect } from "react";

/**
 * Marks the table-of-contents link for the section being read with `aria-current="location"`.
 * The links are server-rendered; this only toggles the attribute as the reader scrolls.
 */
export function TocActiveState({ ids }: { ids: readonly string[] }) {
  useEffect(() => {
    const headings = ids.map((id) => document.getElementById(id)).filter((heading) => heading !== null);
    if (headings.length === 0) return;
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[data-toc-link]"));
    let frame = 0;

    const update = () => {
      frame = 0;
      // A heading counts as current once it has scrolled past the top third of the viewport.
      const line = window.innerHeight / 3;
      let current: string | null = null;
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top <= line) current = heading.id;
        else break;
      }
      // At the very bottom a short last section can never reach that line; it is the one on screen.
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (atBottom && current !== null) current = headings[headings.length - 1]?.id ?? current;
      for (const link of links) {
        if (link.dataset.tocLink === current) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      }
    };
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [ids]);

  return null;
}
