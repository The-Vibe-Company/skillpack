"use client";

import type { PostHog } from "posthog-js";
import type { AnalyticsUser } from "./analyticsUser";
import { POSTHOG_PROXY_PATH, posthogHosts } from "./posthogHosts";
import type { SignupMarker } from "./signupMarker";

export type { AnalyticsUser } from "./analyticsUser";

/** The PostHog calls Skillpack makes; tests substitute a recorder. */
export type AnalyticsClient = Pick<PostHog, "init" | "identify" | "capture" | "reset">;

export interface AnalyticsConfig {
  /** Vercel's deployment environment. Only "production" sends analytics. */
  vercelEnv: string | undefined;
  projectToken: string | undefined;
  /** PostHog app origin; events themselves go through the first-party proxy. */
  uiHost: string;
}

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

/**
 * Every call is a no-op until `init` succeeds, so preview and local builds never reach PostHog. The
 * client is loaded on the first `init`, keeping PostHog out of every page's critical JavaScript; calls
 * made before it arrives run in order once it has initialized.
 */
export function createAnalytics(loadClient: () => Promise<AnalyticsClient>, config: AnalyticsConfig): Analytics {
  const enabled = config.vercelEnv === "production" && !!config.projectToken;
  let client: Promise<AnalyticsClient | null> | null = null;
  const withClient = (use: (client: AnalyticsClient) => void) => {
    void client?.then((loaded) => {
      if (loaded) use(loaded);
    });
  };
  const identify = (target: AnalyticsClient, user: AnalyticsUser) => {
    target.identify(user.userId, {
      email: user.email,
      org: user.org?.name ?? null,
      org_id: user.org?.org_id ?? null,
    });
  };
  return {
    enabled,
    init() {
      if (client) return true;
      const projectToken = config.projectToken;
      if (!enabled || !projectToken) return false;
      client = loadClient().then(
        (loaded) => {
          loaded.init(projectToken, {
            api_host: POSTHOG_PROXY_PATH,
            ui_host: config.uiHost,
            defaults: "2026-05-30",
          });
          return loaded;
        },
        // Analytics is best-effort: a chunk that fails to load leaves every call a no-op.
        () => null,
      );
      return true;
    },
    identify(user) {
      withClient((loaded) => identify(loaded, user));
    },
    signedUp(user, marker) {
      withClient((loaded) => {
        if (user) identify(loaded, user);
        // The member usually navigates on immediately; skip the batch queue so the event is not lost.
        loaded.capture("signed_up", { method: marker.method, signup_page: marker.signupPage }, { send_instantly: true });
      });
    },
    reset() {
      withClient((loaded) => loaded.reset());
    },
  };
}

export const analytics = createAnalytics(() => import("posthog-js").then((module) => module.default), {
  vercelEnv: process.env.NEXT_PUBLIC_VERCEL_ENV,
  projectToken: process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
  uiHost: posthogHosts(process.env.NEXT_PUBLIC_POSTHOG_HOST).ui,
});
