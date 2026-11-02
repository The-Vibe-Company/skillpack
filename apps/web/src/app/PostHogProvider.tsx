"use client";

import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { analytics, type Analytics, type AnalyticsUser } from "@/lib/analytics";
import { readSignupMarker, takeSignupArming } from "@/lib/signupMarker";

async function loadSignedInUser(): Promise<AnalyticsUser | null> {
  try {
    const response = await fetch("/v1/auth/whoami", { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) return null;
    const [{ analyticsUser }, body] = await Promise.all([import("@/lib/analyticsUser"), response.json()]);
    const user = analyticsUser.safeParse(body);
    return user.success ? user.data : null;
  } catch {
    return null;
  }
}

/**
 * Report a signup announced by the login form that sent the member here. The marker is removed from
 * the address bar either way, and it only counts when this tab's login form armed it, so a reload, a
 * copied link, or a crafted URL never reports a signup.
 */
export async function reportSignupFromLocation(target: Analytics): Promise<void> {
  const armed = takeSignupArming(() => window.sessionStorage);
  const marker = readSignupMarker(window.location.hash);
  if (!marker) return;
  const { pathname, search } = window.location;
  window.history.replaceState(window.history.state, "", `${pathname}${search}`);
  if (!armed || !target.init()) return;
  target.signedUp(await loadSignedInUser(), marker);
}

/** Latest start for analytics when the visitor has not interacted yet, counted from the page load. */
export const ANALYTICS_FALLBACK_DELAY_MS = 8000;
const FIRST_INTERACTION = ["pointerdown", "keydown", "scroll", "wheel", "touchstart"] as const;

/**
 * Run `task` once, on the visitor's first interaction or a while after the page has loaded, whichever
 * comes first. PostHog, its session recorder and its extensions cost several hundred milliseconds of
 * main thread; keeping them out of the load leaves that time to rendering and hydration.
 */
export function afterFirstInteraction(task: () => void, fallbackMs = ANALYTICS_FALLBACK_DELAY_MS): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    cancel();
    task();
  };
  const startFallback = () => {
    timer = setTimeout(run, fallbackMs);
  };
  const cancel = () => {
    clearTimeout(timer);
    window.removeEventListener("load", startFallback);
    for (const type of FIRST_INTERACTION) window.removeEventListener(type, run);
  };
  for (const type of FIRST_INTERACTION) window.addEventListener(type, run, { once: true, passive: true });
  if (document.readyState === "complete") startFallback();
  else window.addEventListener("load", startFallback, { once: true });
  return cancel;
}

export function PostHogProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  useEffect(() => {
    void reportSignupFromLocation(analytics);
    return afterFirstInteraction(() => analytics.init());
  }, []);
  // One pageview per path, recorded as it renders so it keeps its URL while PostHog is still loading.
  // It follows the effect above, which has already taken a signup marker out of the address bar.
  useEffect(() => {
    analytics.pageview();
  }, [pathname]);

  return <>{children}</>;
}
