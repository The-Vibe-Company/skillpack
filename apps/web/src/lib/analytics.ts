"use client";

import posthog, { type PostHog } from "posthog-js";
import { z } from "zod";
import { POSTHOG_PROXY_PATH, posthogHosts } from "./posthogHosts";
import type { SignupMarker } from "./signupMarker";

/** The PostHog calls Skillpack makes; tests substitute a recorder. */
export type AnalyticsClient = Pick<PostHog, "init" | "identify" | "capture" | "reset">;

export interface AnalyticsConfig {
  /** Vercel's deployment environment. Only "production" sends analytics. */
  vercelEnv: string | undefined;
  projectToken: string | undefined;
  /** PostHog app origin; events themselves go through the first-party proxy. */
  uiHost: string;
}

/** The signed-in member as `/v1/auth/whoami` reports them. */
export const analyticsUser = z.object({
  userId: z.string().min(1),
  email: z.string(),
  org: z.object({ org_id: z.string(), name: z.string() }).nullable().optional(),
});
export type AnalyticsUser = z.infer<typeof analyticsUser>;

export interface Analytics {
  /** True only in production with a project token. */
  readonly enabled: boolean;
  /** Start PostHog once. Returns `enabled`. */
  init(): boolean;
  identify(user: AnalyticsUser): void;
  signedUp(user: AnalyticsUser | null, marker: SignupMarker): void;
  /** Forget the identified member so the next visitor on this browser starts anonymous. */
  reset(): void;
}

/** Every call is a no-op until `init` succeeds, so preview and local builds never reach PostHog. */
export function createAnalytics(client: AnalyticsClient, config: AnalyticsConfig): Analytics {
  const enabled = config.vercelEnv === "production" && !!config.projectToken;
  let active = false;
  const identify = (user: AnalyticsUser) => {
    client.identify(user.userId, {
      email: user.email,
      org: user.org?.name ?? null,
      org_id: user.org?.org_id ?? null,
    });
  };
  return {
    enabled,
    init() {
      if (active || !enabled || !config.projectToken) return active;
      client.init(config.projectToken, {
        api_host: POSTHOG_PROXY_PATH,
        ui_host: config.uiHost,
        defaults: "2026-05-30",
      });
      active = true;
      return true;
    },
    identify(user) {
      if (active) identify(user);
    },
    signedUp(user, marker) {
      if (!active) return;
      if (user) identify(user);
      // The member usually navigates on immediately; skip the batch queue so the event is not lost.
      client.capture("signed_up", { method: marker.method, signup_page: marker.signupPage }, { send_instantly: true });
    },
    reset() {
      if (active) client.reset();
    },
  };
}

export const analytics = createAnalytics(posthog, {
  vercelEnv: process.env.NEXT_PUBLIC_VERCEL_ENV,
  projectToken: process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
  uiHost: posthogHosts(process.env.NEXT_PUBLIC_POSTHOG_HOST).ui,
});
