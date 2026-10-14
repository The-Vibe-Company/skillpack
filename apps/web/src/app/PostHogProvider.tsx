"use client";

import { PostHogProvider as PHProvider } from "@posthog/react";
import posthog from "posthog-js";
import { useEffect, type ReactNode } from "react";
import { analytics, analyticsUser, type Analytics, type AnalyticsUser } from "@/lib/analytics";
import { readSignupMarker } from "@/lib/signupMarker";

async function loadSignedInUser(): Promise<AnalyticsUser | null> {
  try {
    const response = await fetch("/v1/auth/whoami", { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) return null;
    const user = analyticsUser.safeParse(await response.json());
    return user.success ? user.data : null;
  } catch {
    return null;
  }
}

/**
 * Report a signup announced by the page that sent the member here. The marker is removed from the
 * address bar either way, so a reload or a copied link never reports the signup twice.
 */
export async function reportSignupFromLocation(target: Analytics): Promise<void> {
  const marker = readSignupMarker(window.location.hash);
  if (!marker) return;
  const { pathname, search } = window.location;
  window.history.replaceState(window.history.state, "", `${pathname}${search}`);
  if (!target.init()) return;
  target.signedUp(await loadSignedInUser(), marker);
}

export function PostHogProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    analytics.init();
    void reportSignupFromLocation(analytics);
  }, []);

  if (!analytics.enabled) return <>{children}</>;

  return <PHProvider client={posthog}>{children}</PHProvider>;
}
