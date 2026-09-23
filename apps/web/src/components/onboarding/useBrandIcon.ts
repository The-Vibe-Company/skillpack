"use client";

import { useEffect, useState } from "react";
import { brandIconCandidates, firstLoadableBrandIconCandidate } from "@/lib/onboarding";

const ICON_TIMEOUT_MS = 2500;

/** Resolve through an <img> load rather than fetch: no CORS error in the console when a host blocks it. */
function loadImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    const timer = window.setTimeout(() => {
      image.src = "";
      resolve(false);
    }, ICON_TIMEOUT_MS);
    image.onload = () => {
      window.clearTimeout(timer);
      resolve(image.naturalWidth > 0);
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      resolve(false);
    };
    image.src = url;
  });
}

/**
 * Best-effort logo for a work email domain. Returns the icon URL once it has loaded, `null` while
 * loading or when nothing loads; callers show an initials tile in the meantime.
 */
export function useBrandIcon(domain: string | null): string | null {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    setSrc(null);
    if (!domain) return;
    let cancelled = false;
    void firstLoadableBrandIconCandidate(brandIconCandidates(domain), (candidate) => loadImage(candidate.url)).then(
      (icon) => {
        if (!cancelled) setSrc(icon?.url ?? null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [domain]);

  return src;
}
