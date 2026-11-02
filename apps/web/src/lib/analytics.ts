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
 *
 * `forgetStoredIdentity` erases what PostHog persisted in this browser without loading it. A logout
 * submits its form right after `reset`, often before the client could arrive, so the identity must be
 * dropped synchronously or the next visitor would inherit it.
 */
export function createAnalytics(
  loadClient: () => Promise<AnalyticsClient>,
  config: AnalyticsConfig,
  forgetStoredIdentity: () => void = () => {},
): Analytics {
  const enabled = config.vercelEnv === "production" && !!config.projectToken;
  let client: Promise<AnalyticsClient | null> | null = null;
  let loaded = false;
  const withClient = (use: (client: AnalyticsClient) => void) => {
    void client?.then((posthog) => {
      if (posthog) use(posthog);
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
        (posthog) => {
          posthog.init(projectToken, {
            api_host: POSTHOG_PROXY_PATH,
            ui_host: config.uiHost,
            defaults: "2026-05-30",
          });
          loaded = true;
          return posthog;
        },
        // Analytics is best-effort: a chunk that fails to load leaves every call a no-op.
        () => null,
      );
      return true;
    },
    identify(user) {
      withClient((posthog) => identify(posthog, user));
    },
    signedUp(user, marker) {
      withClient((posthog) => {
        if (user) identify(posthog, user);
        // The member usually navigates on immediately; skip the batch queue so the event is not lost.
        posthog.capture("signed_up", { method: marker.method, signup_page: marker.signupPage }, { send_instantly: true });
      });
    },
    reset() {
      if (!enabled) return;
      if (!loaded) forgetStoredIdentity();
      withClient((posthog) => posthog.reset());
    },
  };
}

/**
 * Remove what PostHog persisted for `projectToken`: its `ph_<token>_*` entries in local and session
 * storage and its cookie, which PostHog may have set on any parent domain of this host. The name follows
 * posthog-js's default persistence name.
 */
export function forgetPostHogStorage(
  projectToken: string,
  target: {
    document: { cookie: string; location: { hostname: string } };
    storages: Array<() => Pick<Storage, "length" | "key" | "removeItem">>;
  },
): void {
  const prefix = `ph_${projectToken.replace(/\+/g, "PL").replace(/\//g, "SL").replace(/=/g, "EQ")}_`;
  for (const storage of target.storages) {
    try {
      const store = storage();
      const keys = Array.from({ length: store.length }, (_, index) => store.key(index));
      for (const key of keys) if (key?.startsWith(prefix)) store.removeItem(key);
    } catch {
      // Storage may be blocked; the cookie below still goes.
    }
  }
  const labels = target.document.location.hostname.split(".");
  const domains = labels.slice(0, -1).map((_, index) => `; domain=.${labels.slice(index).join(".")}`);
  for (const domain of ["", ...domains]) {
    target.document.cookie = `${prefix}posthog=; Max-Age=0; path=/${domain}`;
  }
}

const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

export const analytics = createAnalytics(
  () => import("posthog-js").then((module) => module.default),
  {
    vercelEnv: process.env.NEXT_PUBLIC_VERCEL_ENV,
    projectToken,
    uiHost: posthogHosts(process.env.NEXT_PUBLIC_POSTHOG_HOST).ui,
  },
  () => {
    if (!projectToken) return;
    forgetPostHogStorage(projectToken, { document, storages: [() => window.localStorage, () => window.sessionStorage] });
  },
);
