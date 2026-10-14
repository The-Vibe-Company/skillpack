"use client";

import { PostHogProvider as PHProvider } from "@posthog/react";
import posthog from "posthog-js";
import { useEffect, type ReactNode } from "react";
import { analytics, analyticsUser, type Analytics, type AnalyticsUser } from "@/lib/analytics";
import { readSignupMarker, takeSignupArming } from "@/lib/signupMarker";

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

export function PostHogProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    analytics.init();
    void reportSignupFromLocation(analytics);
  }, []);

  if (!analytics.enabled) return <>{children}</>;

  return <PHProvider client={posthog}>{children}</PHProvider>;
}
