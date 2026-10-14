import { describe, expect, it, vi } from "vitest";
import { createAnalytics, type AnalyticsClient, type AnalyticsConfig } from "./analytics";

function recorder(): AnalyticsClient {
  return { init: vi.fn(), identify: vi.fn(), capture: vi.fn(), reset: vi.fn() };
}

const production: AnalyticsConfig = {
  vercelEnv: "production",
  projectToken: "phc_test",
  uiHost: "https://us.posthog.com",
};
const member = { userId: "user-1", email: "ada@acme.dev", org: { org_id: "org-1", name: "Acme" } };

describe("analytics", () => {
  it.each([
    ["preview", { ...production, vercelEnv: "preview" }],
    ["development", { ...production, vercelEnv: "development" }],
    ["a build outside Vercel", { ...production, vercelEnv: undefined }],
    ["a missing project token", { ...production, projectToken: "" }],
  ])("never reaches PostHog for %s", (_label, config) => {
    const client = recorder();
    const analytics = createAnalytics(client, config);

    expect(analytics.enabled).toBe(false);
    expect(analytics.init()).toBe(false);
    analytics.identify(member);
    analytics.signedUp(member, { method: "email", signupPage: "/login" });
    analytics.reset();

    expect(client.init).not.toHaveBeenCalled();
    expect(client.identify).not.toHaveBeenCalled();
    expect(client.capture).not.toHaveBeenCalled();
    expect(client.reset).not.toHaveBeenCalled();
  });

  it("initializes once in production through the first-party proxy", () => {
    const client = recorder();
    const analytics = createAnalytics(client, production);

    expect(analytics.init()).toBe(true);
    expect(analytics.init()).toBe(true);

    expect(client.init).toHaveBeenCalledTimes(1);
    expect(client.init).toHaveBeenCalledWith("phc_test", {
      api_host: "/ingest",
      ui_host: "https://us.posthog.com",
      defaults: "2026-05-30",
    });
  });

  it("stays silent in production until initialized", () => {
    const client = recorder();
    const analytics = createAnalytics(client, production);

    analytics.identify(member);
    analytics.reset();

    expect(client.identify).not.toHaveBeenCalled();
    expect(client.reset).not.toHaveBeenCalled();
  });

  it("identifies the new member before capturing signed_up", () => {
    const client = recorder();
    const analytics = createAnalytics(client, production);
    analytics.init();

    analytics.signedUp(member, { method: "google", signupPage: "/login" });

    expect(client.identify).toHaveBeenCalledWith("user-1", { email: "ada@acme.dev", org: "Acme", org_id: "org-1" });
    expect(client.capture).toHaveBeenCalledWith(
      "signed_up",
      { method: "google", signup_page: "/login" },
      { send_instantly: true },
    );
    expect(vi.mocked(client.identify).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(client.capture).mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("records a member without a workspace yet and still captures when the session is unreadable", () => {
    const client = recorder();
    const analytics = createAnalytics(client, production);
    analytics.init();

    analytics.signedUp({ userId: "user-2", email: "new@acme.dev", org: null }, { method: "email", signupPage: "/login" });
    analytics.signedUp(null, { method: "email", signupPage: "/login" });

    expect(client.identify).toHaveBeenCalledTimes(1);
    expect(client.identify).toHaveBeenCalledWith("user-2", { email: "new@acme.dev", org: null, org_id: null });
    expect(client.capture).toHaveBeenCalledTimes(2);
  });

  it("resets the identified member on logout", () => {
    const client = recorder();
    const analytics = createAnalytics(client, production);
    analytics.init();

    analytics.reset();

    expect(client.reset).toHaveBeenCalledTimes(1);
  });
});
