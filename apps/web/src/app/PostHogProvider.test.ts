// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Analytics } from "@/lib/analytics";
import { armSignupMarker } from "@/lib/signupMarker";
import { reportSignupFromLocation } from "./PostHogProvider";

function fakeAnalytics(enabled: boolean): Analytics {
  return { enabled, init: vi.fn(() => enabled), identify: vi.fn(), signedUp: vi.fn(), reset: vi.fn() };
}

const whoami = {
  userId: "user-1",
  email: "ada@acme.dev",
  name: "ada",
  org: { org_id: "org-1", name: "Acme", slug: "acme" },
  onboarded: false,
};

describe("reportSignupFromLocation", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => Response.json(whoami));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
    window.sessionStorage.clear();
  });

  it("reports the signup with the session's member and strips the marker", async () => {
    window.history.replaceState(null, "", "/onboarding?step=workspace#signed_up=google&signup_page=%2Flogin");
    armSignupMarker(() => window.sessionStorage);
    const analytics = fakeAnalytics(true);

    await reportSignupFromLocation(analytics);

    expect(fetchMock).toHaveBeenCalledWith("/v1/auth/whoami", { cache: "no-store", credentials: "same-origin" });
    expect(analytics.signedUp).toHaveBeenCalledWith(
      { userId: "user-1", email: "ada@acme.dev", org: { org_id: "org-1", name: "Acme" } },
      { method: "google", signupPage: "/login" },
    );
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      "/onboarding?step=workspace",
    );
  });

  it("still reports the signup when the session cannot be read", async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 503 }));
    window.history.replaceState(null, "", "/skills#signed_up=email&signup_page=%2Flogin");
    armSignupMarker(() => window.sessionStorage);
    const analytics = fakeAnalytics(true);

    await reportSignupFromLocation(analytics);

    expect(analytics.signedUp).toHaveBeenCalledWith(null, { method: "email", signupPage: "/login" });
  });

  it("ignores a marker this tab's login form did not arm, such as a shared link", async () => {
    window.history.replaceState(null, "", "/skills#signed_up=email&signup_page=%2Flogin");
    const analytics = fakeAnalytics(true);

    await reportSignupFromLocation(analytics);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(analytics.signedUp).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("");
  });

  it("reports once: the arming is consumed by the landing page", async () => {
    window.history.replaceState(null, "", "/skills#signed_up=email&signup_page=%2Flogin");
    armSignupMarker(() => window.sessionStorage);
    const analytics = fakeAnalytics(true);

    await reportSignupFromLocation(analytics);
    window.history.replaceState(null, "", "/skills#signed_up=email&signup_page=%2Flogin");
    await reportSignupFromLocation(analytics);

    expect(analytics.signedUp).toHaveBeenCalledTimes(1);
  });

  it("drops a stale arming on a page load without a marker", async () => {
    armSignupMarker(() => window.sessionStorage);
    window.history.replaceState(null, "", "/skills");

    await reportSignupFromLocation(fakeAnalytics(true));

    expect(window.sessionStorage.length).toBe(0);
  });

  it("strips the marker without any request outside production", async () => {
    window.history.replaceState(null, "", "/skills#signed_up=email&signup_page=%2Flogin");
    armSignupMarker(() => window.sessionStorage);
    const analytics = fakeAnalytics(false);

    await reportSignupFromLocation(analytics);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(analytics.signedUp).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("");
  });

  it("leaves other fragments alone", async () => {
    window.history.replaceState(null, "", "/settings#profile");
    const analytics = fakeAnalytics(true);

    await reportSignupFromLocation(analytics);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#profile");
  });
});
