import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  agentAuthProxyHeaders,
  canonicalAliasRedirect,
  legacyCatalogRedirect,
  legacyRuntimeRedirect,
  middleware,
  posthogProxyHeaders,
  trailingSlashRedirect,
} from "./middleware";

describe("canonical host middleware", () => {
  it.each(["/projects", "/projects/legacy/session", "/runs/legacy"])(
    "permanently redirects removed runtime URL %s to Skills without preserving runtime state",
    (path) => {
      const request = new NextRequest(`https://skillpack.app${path}?run=stale`);
      expect(legacyRuntimeRedirect(request)?.toString()).toBe("https://skillpack.app/skills");
      const response = middleware(request);
      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe("https://skillpack.app/skills");
    },
  );

  it.each([
    ["/catalog/skillpack", "https://skillpack.app/catalog/the-vibe-company/skillpack"],
    ["/catalog/incident-summary?ref=old", "https://skillpack.app/catalog/the-vibe-company/incident-summary"],
  ])("moves the build-time catalog URL %s permanently under the official workspace", (path, location) => {
    const response = middleware(new NextRequest(`https://skillpack.app${path}`));
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe(location);
  });

  it.each(["/catalog", "/catalog/acme/release-helper", "/catalog/the-vibe-company/skillpack"])(
    "serves public catalog path %s without a redirect",
    (path) => {
      const request = new NextRequest(`https://skillpack.app${path}`);
      expect(legacyCatalogRedirect(request)).toBeNull();
      expect(legacyRuntimeRedirect(request)).toBeNull();
      expect(middleware(request).headers.get("location")).toBeNull();
    },
  );

  it.each([
    ["/catalog/", "https://skillpack.app/catalog"],
    ["/blog/agent-skills/?ref=x", "https://skillpack.app/blog/agent-skills?ref=x"],
    ["/v1/auth/whoami//", "https://skillpack.app/v1/auth/whoami"],
  ])("keeps the default permanent trailing-slash redirect for %s", (path, location) => {
    const response = middleware(new NextRequest(`https://skillpack.app${path}`));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(location);
  });

  it.each(["/", "/ingest/e/", "/ingest/flags/", "/ingest/static/array.js"])(
    "leaves %s for the router and the PostHog proxy",
    (path) => {
      expect(trailingSlashRedirect(new NextRequest(`https://skillpack.app${path}`))).toBeNull();
      expect(middleware(new NextRequest(`https://skillpack.app${path}`)).headers.get("location")).toBeNull();
    },
  );

  it("redirects www to the configured apex while preserving path and query", () => {
    const request = new NextRequest("https://www.skillpack.app/skills?lib=mine&skill=demo");

    const destination = canonicalAliasRedirect(request, "https://skillpack.app");
    expect(destination?.toString()).toBe("https://skillpack.app/skills?lib=mine&skill=demo");
  });

  it("does not redirect requests already using the canonical host", () => {
    const request = new NextRequest("https://skillpack.app/skills?lib=mine");

    expect(canonicalAliasRedirect(request, "https://skillpack.app")).toBeNull();
  });

  it("returns a permanent redirect response for the alias", () => {
    const previous = process.env.COMPANION_WEB_URL;
    process.env.COMPANION_WEB_URL = "https://skillpack.app";
    try {
      const response = middleware(new NextRequest("https://www.skillpack.app/login?next=%2Fskills"));
      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe("https://skillpack.app/login?next=%2Fskills");
    } finally {
      if (previous === undefined) delete process.env.COMPANION_WEB_URL;
      else process.env.COMPANION_WEB_URL = previous;
    }
  });

  it("marks Agent Auth protocol and signed API rewrites with the fixed configured origin", () => {
    const request = new NextRequest("https://skillpack.app/auth/host/create", {
      headers: { "x-forwarded-host": "untrusted.example" },
    });
    const headers = agentAuthProxyHeaders(request, "https://skillpack.app");

    expect(headers?.get("x-companion-agent-auth-origin")).toBe("https://skillpack.app");
    expect(headers?.get("x-forwarded-host")).toBe("untrusted.example");
    expect(agentAuthProxyHeaders(
      new NextRequest("https://skillpack.app/v1/skills?workspace_id=workspace-1"),
      "https://skillpack.app",
    )?.get("x-companion-agent-auth-origin")).toBe("https://skillpack.app");
    expect(agentAuthProxyHeaders(
      new NextRequest("https://skillpack.app/skills"),
      "https://skillpack.app",
    )).toBeNull();
  });

  it("strips Skillpack credentials from requests proxied to PostHog", () => {
    const request = new NextRequest("https://skillpack.app/ingest/e/", {
      headers: {
        cookie: "__Secure-better-auth.session_token=secret; companion_org=org-1",
        authorization: "Bearer pat",
        "content-type": "text/plain",
      },
    });

    const headers = posthogProxyHeaders(request);
    expect(headers?.has("cookie")).toBe(false);
    expect(headers?.has("authorization")).toBe(false);
    expect(headers?.get("content-type")).toBe("text/plain");

    const response = middleware(request);
    const forwarded = response.headers.get("x-middleware-override-headers")?.split(",") ?? [];
    expect(forwarded).toContain("content-type");
    expect(forwarded).not.toContain("cookie");
    expect(forwarded).not.toContain("authorization");
    expect(response.headers.get("x-middleware-request-cookie")).toBeNull();
  });

  it("leaves credentials on non-PostHog paths", () => {
    expect(posthogProxyHeaders(new NextRequest("https://skillpack.app/ingestion"))).toBeNull();
    expect(posthogProxyHeaders(new NextRequest("https://skillpack.app/skills"))).toBeNull();
  });

  it("forwards the Agent Auth origin marker into the external rewrite request", () => {
    const previous = process.env.COMPANION_WEB_URL;
    process.env.COMPANION_WEB_URL = "https://skillpack.app";
    try {
      const response = middleware(new NextRequest("https://skillpack.app/auth/agent/register"));
      expect(response.headers.get("x-middleware-request-x-companion-agent-auth-origin"))
        .toBe("https://skillpack.app");
      expect(response.headers.get("x-middleware-override-headers"))
        .toContain("x-companion-agent-auth-origin");
    } finally {
      if (previous === undefined) delete process.env.COMPANION_WEB_URL;
      else process.env.COMPANION_WEB_URL = previous;
    }
  });
});
