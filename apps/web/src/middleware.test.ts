import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { agentAuthProxyHeaders, canonicalAliasRedirect, legacyRuntimeRedirect, middleware } from "./middleware";

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
