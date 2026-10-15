"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const DISMISS_KEY = "skillpack:blog-sticky-cta-dismissed";

/**
 * A small sign-up bar pinned to the bottom of the viewport. It appears once the reader is past
 * the header, steps aside while the `hideWhenVisibleId` element (the end-of-post sign-up) is on
 * screen, and stays closed for the session once dismissed. It never covers the page on load.
 */
export function StickyCta({
  title,
  label,
  href,
  showAfterId,
  hideWhenVisibleId,
}: {
  title: string;
  label: string;
  href: string;
  showAfterId: string;
  hideWhenVisibleId: string;
}) {
  const [pastStart, setPastStart] = useState(false);
  const [endVisible, setEndVisible] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(window.sessionStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      // Storage can be blocked; the bar then simply shows again on the next page.
      setDismissed(false);
    }
    const start = document.getElementById(showAfterId);
    const end = document.getElementById(hideWhenVisibleId);
    const observers: IntersectionObserver[] = [];
    if (start) {
      // Past the start marker means it has scrolled above the viewport, not that it is below it.
      const observer = new IntersectionObserver(([entry]) => {
        if (entry) setPastStart(!entry.isIntersecting && entry.boundingClientRect.top < 0);
      });
      observer.observe(start);
      observers.push(observer);
    }
    if (end) {
      const observer = new IntersectionObserver(([entry]) => setEndVisible(entry?.isIntersecting ?? false));
      observer.observe(end);
      observers.push(observer);
    }
    return () => observers.forEach((observer) => observer.disconnect());
  }, [showAfterId, hideWhenVisibleId]);

  function dismiss() {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Without storage the dismissal lasts for this page only.
    }
  }

  const visible = pastStart && !endVisible && !dismissed;
  return (
    <div className="v10-stickycta" data-visible={visible ? "true" : "false"} aria-hidden={!visible} inert={!visible}>
      <p className="v10-stickycta__title">{title}</p>
      <Link href={href} className="v10-btn v10-btn--primary v10-btn--sm">
        {label}
      </Link>
      <button type="button" className="v10-stickycta__close" aria-label="Dismiss" onClick={dismiss}>
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
