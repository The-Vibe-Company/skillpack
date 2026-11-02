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
  /** Record a view of the page on screen now. */
  pageview(): void;
  identify(user: AnalyticsUser): void;
  signedUp(user: AnalyticsUser | null, marker: SignupMarker): void;
  /** Forget the identified member so the next visitor on this browser starts anonymous. */
  reset(): void;
}

/** The URL properties posthog-js would read from `location` if it were already loaded. */
export interface PageContext {
  $current_url: string;
  $host: string;
  $pathname: string;
}

export interface BrowserUrl {
  get(): string;
  set(url: string): void;
}

export interface AnalyticsQueueOptions {
  /** Where the visitor is right now, stamped on calls that have to wait for the client. */
  pageContext?: () => PageContext;
  browserUrl?: BrowserUrl;
  maxAttempts?: number;
  /** Delay before the second attempt, doubled before each following one. */
  retryDelayMs?: number;
  maxPending?: number;
  wait?: (ms: number) => Promise<void>;
}

interface PendingCall {
  /** The page the call was made on; posthog-js reads it from the address bar when it runs. */
  url: string | undefined;
  run: (client: AnalyticsClient) => void;
}

function currentPage(): PageContext {
  const { href, host, pathname } = window.location;
  return { $current_url: href, $host: host, $pathname: pathname };
}

/**
 * posthog-js reads `location` on its own when it initializes and sends: campaign parameters, the
 * session entry URL, the person's initial URL, `$prev_pageview_pathname`. Queued calls therefore run
 * with the address bar briefly set back to the URL each one was made on, then restored in the same
 * task. The native replaceState is called rather than the one Next.js patches, so the router never
 * sees it.
 */
const addressBar: BrowserUrl = {
  get: () => window.location.href,
  set: (url) => History.prototype.replaceState.call(window.history, window.history.state, "", url),
};

/** Browsers throttle replaceState, so a queue spanning more pages is sent with its own URLs only. */
const MAX_REPLAYED_URLS = 5;

/**
 * Every call is a no-op outside production, so preview and local builds never reach PostHog. The
 * client is loaded on the first `init`, keeping PostHog out of every page's critical JavaScript; calls
 * made before it arrives wait in a capped queue, with the time and URL they were made at, and run in
 * order once it has initialized. A failed load is retried with backoff; after the last attempt the
 * queue is dropped and every call stays a no-op for the rest of the page.
 *
 * `forgetStoredIdentity` erases what PostHog persisted in this browser without loading it. A logout
 * submits its form right after `reset`, often before the client could arrive, so the identity must be
 * dropped synchronously or the next visitor would inherit it.
 */
export function createAnalytics(
  loadClient: () => Promise<AnalyticsClient>,
  config: AnalyticsConfig,
  forgetStoredIdentity: () => void = () => {},
  {
    pageContext = currentPage,
    browserUrl = addressBar,
    maxAttempts = 3,
    retryDelayMs = 1000,
    maxPending = 100,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }: AnalyticsQueueOptions = {},
): Analytics {
  const enabled = config.vercelEnv === "production" && !!config.projectToken;
  let loading: Promise<void> | null = null;
  let client: AnalyticsClient | null = null;
  let abandoned = false;
  const pending: PendingCall[] = [];

  const call = (run: PendingCall["run"], page?: PageContext) => {
    if (!enabled || abandoned) return;
    if (!client) {
      if (pending.length < maxPending) pending.push({ url: page?.$current_url, run });
      return;
    }
    try {
      run(client);
    } catch {
      // Analytics is best-effort and must never break the page that reports.
    }
  };

  // Runs `send` with the address bar showing the URL of each call it is handed, starting with the
  // oldest, and restores the real URL after.
  const atUrlsOf = (calls: PendingCall[], send: (showUrlOf: (call: PendingCall) => void) => void) => {
    const urls = calls.flatMap(({ url }) => (url === undefined ? [] : [url]));
    if (urls.length === 0 || new Set(urls).size > MAX_REPLAYED_URLS) return send(() => {});
    const actualUrl = browserUrl.get();
    let shownUrl = actualUrl;
    const show = (url: string | undefined) => {
      if (url === undefined || url === shownUrl) return;
      try {
        browserUrl.set(url);
      } catch {
        // Calls still carry their own URL properties.
      }
      // Read back: Chrome ignores throttled calls without throwing.
      shownUrl = browserUrl.get();
    };
    try {
      show(urls[0]);
      send(({ url }) => show(url));
    } finally {
      // Tried twice: a tab left on an old URL breaks reloads and shared links.
      for (let tries = 0; tries < 2 && shownUrl !== actualUrl; tries++) show(actualUrl);
      if (shownUrl !== actualUrl) console.warn(`PostHog could not restore the address bar to ${actualUrl}.`);
    }
  };

  const loadWithRetry = async (projectToken: string): Promise<AnalyticsClient | null> => {
    for (let attempt = 1; ; attempt++) {
      try {
        const posthog = await loadClient();
        atUrlsOf(pending, () =>
          posthog.init(projectToken, {
            api_host: POSTHOG_PROXY_PATH,
            ui_host: config.uiHost,
            defaults: "2026-05-30",
            // Pageviews go through `pageview` so one made before PostHog arrives keeps its own URL.
            capture_pageview: false,
            capture_pageleave: true,
          }),
        );
        return posthog;
      } catch (error) {
        if (attempt >= maxAttempts) {
          console.warn(`PostHog failed to load after ${attempt} attempts; analytics are off for this page.`, error);
          return null;
        }
        await wait(retryDelayMs * 2 ** (attempt - 1));
      }
    }
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
      const projectToken = config.projectToken;
      if (!enabled || !projectToken) return false;
      loading ??= loadWithRetry(projectToken).then((posthog) => {
        if (!posthog) {
          abandoned = true;
          pending.length = 0;
          return;
        }
        const queued = pending.splice(0);
        client = posthog;
        atUrlsOf(queued, (showUrlOf) => {
          for (const queuedCall of queued) {
            showUrlOf(queuedCall);
            try {
              queuedCall.run(posthog);
            } catch {
              // One failing call must not hold back the rest of the queue.
            }
          }
        });
      });
      return true;
    },
    pageview() {
      if (!enabled) return;
      const page = pageContext();
      const timestamp = new Date();
      call((posthog) => posthog.capture("$pageview", { ...page }, { timestamp }), page);
    },
    identify(user) {
      if (!enabled) return;
      call((posthog) => identify(posthog, user), pageContext());
    },
    signedUp(user, marker) {
      if (!enabled) return;
      const page = pageContext();
      const timestamp = new Date();
      call((posthog) => {
        if (user) identify(posthog, user);
        // The member usually navigates on immediately; skip the batch queue so the event is not lost.
        posthog.capture(
          "signed_up",
          { ...page, method: marker.method, signup_page: marker.signupPage },
          { send_instantly: true, timestamp },
        );
      }, page);
    },
    reset() {
      if (!enabled) return;
      if (!client) forgetStoredIdentity();
      call((posthog) => posthog.reset());
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
