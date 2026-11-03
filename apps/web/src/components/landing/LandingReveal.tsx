"use client";

import { useEffect } from "react";

/* Pointer-tracked card glow is decoration for precise pointers only; touch
   and reduced-motion visitors keep the static hover border. */
const GLOW_QUERY = "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)";

/** Client island for the landing's scroll reveal, ambient-background pausing and card glow;
    the page itself renders on the server and stays fully visible if this never runs. */
export function LandingReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll(".v5-reveal"));
    let fired = false;
    const io = new IntersectionObserver(
      (entries) => {
        fired = true;
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("v5-reveal--in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.1 },
    );
    els.forEach((el) => io.observe(el));
    /* Fail open: if IO never fires (some embedded contexts), reveal everything. */
    const fallback = setTimeout(() => {
      if (!fired) els.forEach((el) => el.classList.add("v5-reveal--in"));
    }, 700);

    /* Ambient backgrounds animate by default; pause them while off-screen. */
    const ambient = new IntersectionObserver((entries) => {
      entries.forEach((e) => e.target.classList.toggle("lp-ambient--paused", !e.isIntersecting));
    });
    document.querySelectorAll(".lp-ambient").forEach((el) => ambient.observe(el));

    const glow = window.matchMedia(GLOW_QUERY);
    let frame = 0;
    let pending: { card: HTMLElement; x: number; y: number } | null = null;
    const onPointerMove = (event: PointerEvent) => {
      if (!glow.matches || !(event.target instanceof Element)) return;
      const card = event.target.closest<HTMLElement>(".lp-glow");
      if (!card) return;
      const rect = card.getBoundingClientRect();
      pending = { card, x: event.clientX - rect.left, y: event.clientY - rect.top };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!pending) return;
        pending.card.style.setProperty("--lp-mx", `${pending.x}px`);
        pending.card.style.setProperty("--lp-my", `${pending.y}px`);
        pending = null;
      });
    };
    document.addEventListener("pointermove", onPointerMove, { passive: true });

    return () => {
      clearTimeout(fallback);
      io.disconnect();
      ambient.disconnect();
      document.removeEventListener("pointermove", onPointerMove);
      cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
