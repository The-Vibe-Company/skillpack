"use client";

import { useEffect, useRef } from "react";

/**
 * A thin bar along the top of the viewport showing how much of `#targetId` has been read.
 * Decorative: the scrollbar already conveys position to assistive technology.
 */
export function ReadingProgress({ targetId }: { targetId: string }) {
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = document.getElementById(targetId);
    if (!target || !bar.current) return;
    const fill = bar.current;
    let frame = 0;

    const update = () => {
      frame = 0;
      const rect = target.getBoundingClientRect();
      const readable = rect.height - window.innerHeight;
      const progress = readable <= 0 ? (rect.top <= 0 ? 1 : 0) : -rect.top / readable;
      fill.style.transform = `scaleX(${Math.min(1, Math.max(0, progress))})`;
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
  }, [targetId]);

  return (
    <div className="v10-progress" aria-hidden="true">
      <div ref={bar} className="v10-progress__fill" />
    </div>
  );
}
