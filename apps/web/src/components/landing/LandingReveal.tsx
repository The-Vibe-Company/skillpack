"use client";

import { useEffect } from "react";

/** Client island for the landing's scroll reveal; the page itself renders on the server. */
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
    return () => {
      clearTimeout(fallback);
      io.disconnect();
    };
  }, []);
  return null;
}
