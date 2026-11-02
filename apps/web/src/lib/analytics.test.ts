// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAnalytics,
  forgetPostHogStorage,
  type AnalyticsClient,
  type AnalyticsConfig,
  type AnalyticsQueueOptions,
  type BrowserUrl,
  type PageContext,
} from "./analytics";

function recorder(): AnalyticsClient {
  return { init: vi.fn(), identify: vi.fn(), capture: vi.fn(), reset: vi.fn() };
}

/** Lets the lazily loaded client arrive and the calls queued behind it run. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const production: AnalyticsConfig = {
  vercelEnv: "production",
  projectToken: "phc_test",
  uiHost: "https://us.posthog.com",
};
const member = { userId: "user-1", email: "ada@acme.dev", org: { org_id: "org-1", name: "Acme" } };

/** A tab whose address bar the test moves, as a client-side navigation would. */
function fakeTab(start = "https://skillpack.dev/?utm_source=linkedin") {
  let url = start;
  const shown: string[] = [];
  const browserUrl: BrowserUrl = {
    get: () => url,
    set: (next) => {
      url = next;
      shown.push(next);
    },
  };
  const pageContext = (): PageContext => {
    const { href, host, pathname } = new URL(url);
    return { $current_url: href, $host: host, $pathname: pathname };
  };
  return {
    browserUrl,
    pageContext,
    shown,
    navigate: (next: string) => {
      url = next;
    },
    get url() {
      return url;
    },
  };
}

/** Records the address bar each client call ran under. */
function urlRecorder(tab: ReturnType<typeof fakeTab>) {
  const seen: Array<[string, string]> = [];
  const record = (name: string) => vi.fn().mockImplementation(() => void seen.push([name, tab.url]));
  const capture = vi.fn().mockImplementation((event: string) => void seen.push([event, tab.url]));
  const client: AnalyticsClient = {
    init: record("init"),
    identify: record("identify"),
    capture,
    reset: record("reset"),
  };
  return { client, seen };
}

function queueOptions(tab: ReturnType<typeof fakeTab>, options: AnalyticsQueueOptions = {}): AnalyticsQueueOptions {
  return { browserUrl: tab.browserUrl, pageContext: tab.pageContext, wait: async () => {}, ...options };
}

describe("analytics", () => {
  it.each([
    ["preview", { ...production, vercelEnv: "preview" }],
    ["development", { ...production, vercelEnv: "development" }],
    ["a build outside Vercel", { ...production, vercelEnv: undefined }],
    ["a missing project token", { ...production, projectToken: "" }],
  ])("never reaches PostHog for %s", async (_label, config) => {
    const client = recorder();
    const load = vi.fn(async () => client);
    const forget = vi.fn();
    const analytics = createAnalytics(load, config, forget);

    expect(analytics.enabled).toBe(false);
    expect(analytics.init()).toBe(false);
    analytics.identify(member);
    analytics.signedUp(member, { method: "email", signupPage: "/login" });
    analytics.reset();
    await settle();

    expect(load).not.toHaveBeenCalled();
    expect(forget).not.toHaveBeenCalled();
    expect(client.init).not.toHaveBeenCalled();
    expect(client.identify).not.toHaveBeenCalled();
    expect(client.capture).not.toHaveBeenCalled();
    expect(client.reset).not.toHaveBeenCalled();
  });

  it("loads and initializes PostHog once in production through the first-party proxy", async () => {
    const client = recorder();
    const load = vi.fn(async () => client);
    const analytics = createAnalytics(load, production);

    expect(analytics.init()).toBe(true);
    expect(analytics.init()).toBe(true);
    await settle();

    expect(load).toHaveBeenCalledTimes(1);
    expect(client.init).toHaveBeenCalledTimes(1);
    expect(client.init).toHaveBeenCalledWith(
      "phc_test",
      {
        api_host: "/ingest",
        ui_host: "https://us.posthog.com",
        defaults: "2026-05-30",
        capture_pageview: false,
        capture_pageleave: true,
      },
      undefined,
    );
  });

  it("stays silent in production until initialized", async () => {
    const client = recorder();
    const load = vi.fn(async () => client);
    const analytics = createAnalytics(load, production);

    analytics.identify(member);
    analytics.reset();
    await settle();

    expect(load).not.toHaveBeenCalled();
    expect(client.identify).not.toHaveBeenCalled();
    expect(client.reset).not.toHaveBeenCalled();
  });

  it("identifies the new member before capturing signed_up", async () => {
    const client = recorder();
    const load = vi.fn(async () => client);
    const analytics = createAnalytics(load, production);
    analytics.init();

    analytics.signedUp(member, { method: "google", signupPage: "/login" });
    await settle();

    expect(client.identify).toHaveBeenCalledWith("user-1", { email: "ada@acme.dev", org: "Acme", org_id: "org-1" });
    expect(client.capture).toHaveBeenCalledWith(
      "signed_up",
      expect.objectContaining({ method: "google", signup_page: "/login" }),
      expect.objectContaining({ send_instantly: true }),
    );
    expect(vi.mocked(client.identify).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(client.capture).mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("records a member without a workspace yet and still captures when the session is unreadable", async () => {
    const client = recorder();
    const load = vi.fn(async () => client);
    const analytics = createAnalytics(load, production);
    analytics.init();

    analytics.signedUp({ userId: "user-2", email: "new@acme.dev", org: null }, { method: "email", signupPage: "/login" });
    analytics.signedUp(null, { method: "email", signupPage: "/login" });
    await settle();

    expect(client.identify).toHaveBeenCalledTimes(1);
    expect(client.identify).toHaveBeenCalledWith("user-2", { email: "new@acme.dev", org: null, org_id: null });
    expect(client.capture).toHaveBeenCalledTimes(2);
  });

  it("resets the identified member on logout", async () => {
    const client = recorder();
    const load = vi.fn(async () => client);
    const analytics = createAnalytics(load, production);
    analytics.init();

    analytics.reset();
    await settle();

    expect(client.reset).toHaveBeenCalledTimes(1);
  });

  it("runs calls made before the client arrives once it has initialized, in order", async () => {
    const client = recorder();
    let arrive: (client: AnalyticsClient) => void = () => {};
    const analytics = createAnalytics(() => new Promise((resolve) => (arrive = resolve)), production);

    analytics.init();
    analytics.identify(member);
    analytics.reset();
    expect(client.init).not.toHaveBeenCalled();

    arrive(client);
    await settle();

    expect(vi.mocked(client.init).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(client.identify).mock.invocationCallOrder[0] ?? 0,
    );
    expect(vi.mocked(client.identify).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(client.reset).mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("stays a no-op when the PostHog chunk fails to load", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const analytics = createAnalytics(() => Promise.reject(new Error("chunk load failed")), production, undefined, {
      wait: async () => {},
    });

    expect(analytics.init()).toBe(true);
    analytics.identify(member);
    analytics.signedUp(member, { method: "email", signupPage: "/login" });
    analytics.reset();

    await expect(settle()).resolves.toBeUndefined();
  });

  it("forgets the stored identity at once when a logout resets before the client arrives", async () => {
    const client = recorder();
    const forget = vi.fn();
    const analytics = createAnalytics(async () => client, production, forget);

    analytics.reset();
    expect(forget).toHaveBeenCalledTimes(1);

    analytics.init();
    analytics.reset();
    expect(forget).toHaveBeenCalledTimes(2);
    await settle();
    expect(client.reset).toHaveBeenCalledTimes(2);

    analytics.reset();
    expect(forget).toHaveBeenCalledTimes(2);
    expect(client.reset).toHaveBeenCalledTimes(3);
  });
});

describe("analytics before PostHog arrives", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the URL and time of a pageview made before a client-side navigation", async () => {
    const tab = fakeTab();
    const { client, seen } = urlRecorder(tab);
    let arrive: (client: AnalyticsClient) => void = () => {};
    const analytics = createAnalytics(
      () => new Promise((resolve) => (arrive = resolve)),
      production,
      undefined,
      queueOptions(tab),
    );

    analytics.pageview();
    const landedAt = Date.now();
    analytics.init();
    tab.navigate("https://skillpack.dev/skills");
    analytics.pageview();
    arrive(client);
    await settle();

    expect(vi.mocked(client.capture).mock.calls).toEqual([
      [
        "$pageview",
        {
          $current_url: "https://skillpack.dev/?utm_source=linkedin",
          $host: "skillpack.dev",
          $pathname: "/",
        },
        { timestamp: expect.any(Date) },
      ],
      [
        "$pageview",
        { $current_url: "https://skillpack.dev/skills", $host: "skillpack.dev", $pathname: "/skills" },
        { timestamp: expect.any(Date) },
      ],
    ]);
    const landing = vi.mocked(client.capture).mock.calls[0]?.[2]?.timestamp;
    expect(Math.abs((landing?.getTime() ?? 0) - landedAt)).toBeLessThan(1000);
    // posthog-js reads campaign parameters and the session entry URL from the address bar at init.
    expect(seen).toEqual([
      ["init", "https://skillpack.dev/?utm_source=linkedin"],
      ["$pageview", "https://skillpack.dev/?utm_source=linkedin"],
      ["$pageview", "https://skillpack.dev/skills"],
    ]);
    expect(tab.url).toBe("https://skillpack.dev/skills");
  });

  it("sends a signup with the page it happened on, not the one the member moved on to", async () => {
    const tab = fakeTab("https://skillpack.dev/onboarding");
    const { client, seen } = urlRecorder(tab);
    let arrive: (client: AnalyticsClient) => void = () => {};
    const analytics = createAnalytics(
      () => new Promise((resolve) => (arrive = resolve)),
      production,
      undefined,
      queueOptions(tab),
    );

    analytics.init();
    analytics.signedUp(member, { method: "google", signupPage: "/login" });
    tab.navigate("https://skillpack.dev/skills");
    arrive(client);
    await settle();

    expect(client.capture).toHaveBeenCalledWith(
      "signed_up",
      {
        $current_url: "https://skillpack.dev/onboarding",
        $host: "skillpack.dev",
        $pathname: "/onboarding",
        method: "google",
        signup_page: "/login",
      },
      { send_instantly: true, timestamp: expect.any(Date) },
    );
    expect(seen).toEqual([
      ["init", "https://skillpack.dev/onboarding"],
      ["identify", "https://skillpack.dev/onboarding"],
      ["signed_up", "https://skillpack.dev/onboarding"],
    ]);
    expect(tab.url).toBe("https://skillpack.dev/skills");
  });

  it("runs calls made once PostHog is in synchronously, on the page on screen", async () => {
    const tab = fakeTab("https://skillpack.dev/");
    const { client } = urlRecorder(tab);
    const analytics = createAnalytics(async () => client, production, undefined, queueOptions(tab));
    analytics.init();
    await settle();

    tab.navigate("https://skillpack.dev/skills");
    analytics.pageview();
    analytics.reset();

    expect(client.capture).toHaveBeenLastCalledWith(
      "$pageview",
      { $current_url: "https://skillpack.dev/skills", $host: "skillpack.dev", $pathname: "/skills" },
      { timestamp: expect.any(Date) },
    );
    expect(client.reset).toHaveBeenCalledTimes(1);
    expect(tab.shown).toEqual([]);
  });

  it("leaves the address bar alone when the queue spans many pages", async () => {
    const tab = fakeTab("https://skillpack.dev/");
    const { client } = urlRecorder(tab);
    let arrive: (client: AnalyticsClient) => void = () => {};
    const analytics = createAnalytics(
      () => new Promise((resolve) => (arrive = resolve)),
      production,
      undefined,
      queueOptions(tab),
    );

    analytics.init();
    for (const path of ["/", "/a", "/b", "/c", "/d", "/e"]) {
      tab.navigate(`https://skillpack.dev${path}`);
      analytics.pageview();
    }
    arrive(client);
    await settle();

    expect(tab.shown).toEqual([]);
    expect(vi.mocked(client.capture).mock.calls.map(([, properties]) => properties?.$pathname)).toEqual([
      "/",
      "/a",
      "/b",
      "/c",
      "/d",
      "/e",
    ]);
  });

  it("restores the address bar even when a queued call throws, and still runs the rest", async () => {
    const tab = fakeTab("https://skillpack.dev/");
    const { client } = urlRecorder(tab);
    vi.mocked(client.identify).mockImplementation(() => {
      throw new Error("bad identify");
    });
    let arrive: (client: AnalyticsClient) => void = () => {};
    const analytics = createAnalytics(
      () => new Promise((resolve) => (arrive = resolve)),
      production,
      undefined,
      queueOptions(tab),
    );

    analytics.init();
    analytics.identify(member);
    tab.navigate("https://skillpack.dev/skills");
    analytics.pageview();
    arrive(client);
    await settle();

    expect(client.capture).toHaveBeenCalledTimes(1);
    expect(tab.url).toBe("https://skillpack.dev/skills");
  });

  it("warns when the address bar cannot be restored", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tab = fakeTab("https://skillpack.dev/");
    let stuck = false;
    const browserUrl: BrowserUrl = {
      get: tab.browserUrl.get,
      set: (url) => {
        if (stuck) throw new Error("SecurityError: too many calls");
        tab.browserUrl.set(url);
        stuck = true;
      },
    };
    const { client } = urlRecorder(tab);
    let arrive: (client: AnalyticsClient) => void = () => {};
    const analytics = createAnalytics(
      () => new Promise((resolve) => (arrive = resolve)),
      production,
      undefined,
      queueOptions(tab, { browserUrl }),
    );

    analytics.init();
    analytics.pageview();
    tab.navigate("https://skillpack.dev/skills");
    arrive(client);
    await settle();

    expect(client.capture).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("PostHog could not restore the address bar to https://skillpack.dev/skills.");
  });

  it("keeps only the oldest calls once the queue is full", async () => {
    const tab = fakeTab("https://skillpack.dev/");
    const { client } = urlRecorder(tab);
    let arrive: (client: AnalyticsClient) => void = () => {};
    const analytics = createAnalytics(
      () => new Promise((resolve) => (arrive = resolve)),
      production,
      undefined,
      queueOptions(tab, { maxPending: 2 }),
    );

    analytics.init();
    analytics.pageview();
    analytics.identify(member);
    analytics.reset();
    arrive(client);
    await settle();

    expect(client.capture).toHaveBeenCalledTimes(1);
    expect(client.identify).toHaveBeenCalledTimes(1);
    expect(client.reset).not.toHaveBeenCalled();
  });
});

describe("analytics replaying on the real address bar", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("shows each call's URL with the native history API, then restores the URL and router state", async () => {
    window.history.replaceState({ __NA: true, tree: "landing" }, "", "/?utm_source=linkedin");
    const seen: string[] = [];
    const shownPath = () => void seen.push(window.location.pathname + window.location.search);
    const client: AnalyticsClient = {
      ...recorder(),
      init: vi.fn().mockImplementation(shownPath),
      capture: vi.fn().mockImplementation(shownPath),
    };
    let arrive: (client: AnalyticsClient) => void = () => {};
    const analytics = createAnalytics(() => new Promise((resolve) => (arrive = resolve)), production);

    analytics.pageview();
    analytics.init();
    window.history.pushState({ __NA: true, tree: "blog" }, "", "/blog");
    const patched = vi.fn();
    const routerPatchedReplaceState = window.history.replaceState;
    window.history.replaceState = patched;
    analytics.pageview();
    arrive(client);
    await settle();
    window.history.replaceState = routerPatchedReplaceState;

    expect(seen).toEqual(["/?utm_source=linkedin", "/?utm_source=linkedin", "/blog"]);
    expect(patched).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/blog");
    expect(window.history.state).toEqual({ __NA: true, tree: "blog" });
  });
});

describe("analytics when PostHog fails to load", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retries a failed load with backoff and then sends what was queued", async () => {
    const tab = fakeTab();
    const { client } = urlRecorder(tab);
    const load = vi
      .fn<() => Promise<AnalyticsClient>>()
      .mockRejectedValueOnce(new Error("ChunkLoadError"))
      .mockRejectedValueOnce(new Error("ChunkLoadError"))
      .mockResolvedValue(client);
    const wait = vi.fn(async () => {});
    const analytics = createAnalytics(load, production, undefined, queueOptions(tab, { wait }));

    analytics.pageview();
    analytics.init();
    analytics.init();
    await settle();

    expect(load).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[1000], [2000]]);
    expect(client.init).toHaveBeenCalledTimes(1);
    expect(client.capture).toHaveBeenCalledWith("$pageview", expect.anything(), expect.anything());
  });

  it("retries a throwing init on a fresh named instance, which posthog-js requires", async () => {
    const tab = fakeTab();
    const retried = recorder();
    const init = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("init failed");
      })
      .mockImplementationOnce(() => retried);
    const client: AnalyticsClient = { ...recorder(), init };
    const load = vi.fn(async () => client);
    const analytics = createAnalytics(load, production, undefined, queueOptions(tab));

    analytics.init();
    analytics.identify(member);
    await settle();
    analytics.reset();

    expect(load).toHaveBeenCalledTimes(2);
    expect(init.mock.calls.map((call) => call[2])).toEqual([undefined, "skillpack_retry_1"]);
    expect(client.identify).not.toHaveBeenCalled();
    expect(retried.identify).toHaveBeenCalledTimes(1);
    expect(retried.reset).toHaveBeenCalledTimes(1);
  });

  it("gives up after the last attempt: drops the queue, warns once, and never loads again", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tab = fakeTab();
    const load = vi.fn(() => Promise.reject(new Error("ChunkLoadError")));
    const forget = vi.fn();
    const analytics = createAnalytics(load, production, forget, queueOptions(tab));

    analytics.pageview();
    analytics.init();
    await settle();
    analytics.init();
    analytics.pageview();
    analytics.reset();
    await settle();

    expect(load).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(forget).toHaveBeenCalledTimes(1);
  });
});

describe("forgetPostHogStorage", () => {
  it("removes the persisted identity from storage and from the cookie on every parent domain", () => {
    const cookies: string[] = [];
    const document = {
      location: { hostname: "www.skillpack.app" },
      get cookie() {
        return "";
      },
      set cookie(value: string) {
        cookies.push(value);
      },
    };
    const entries = ["ph_phc_aPLbSLcEQ_posthog", "ph_phc_aPLbSLcEQ_window_id", "ph_phc_other_posthog", "sx_prefs"];
    const storage = { length: entries.length, key: (index: number) => entries[index] ?? null, removeItem: vi.fn() };

    forgetPostHogStorage("phc_a+b/c=", { document, storages: [() => storage] });

    expect(storage.removeItem.mock.calls).toEqual([["ph_phc_aPLbSLcEQ_posthog"], ["ph_phc_aPLbSLcEQ_window_id"]]);
    expect(cookies).toEqual([
      "ph_phc_aPLbSLcEQ_posthog=; Max-Age=0; path=/",
      "ph_phc_aPLbSLcEQ_posthog=; Max-Age=0; path=/; domain=.www.skillpack.app",
      "ph_phc_aPLbSLcEQ_posthog=; Max-Age=0; path=/; domain=.skillpack.app",
    ]);
  });

  it("still clears the cookie when storage is blocked", () => {
    const cookies: string[] = [];
    const document = {
      location: { hostname: "localhost" },
      get cookie() {
        return "";
      },
      set cookie(value: string) {
        cookies.push(value);
      },
    };

    forgetPostHogStorage("phc_x", {
      document,
      storages: [
        () => {
          throw new Error("SecurityError");
        },
      ],
    });

    expect(cookies).toEqual(["ph_phc_x_posthog=; Max-Age=0; path=/"]);
  });
});
