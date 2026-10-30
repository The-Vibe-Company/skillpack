import { describe, expect, it } from "vitest";
import type { McpTokenSession } from "@skillpack/auth";
import type { McpConnection } from "@skillpack/core/services";
import {
  authenticateMcpRequest,
  forceMcpConsentPrompt,
  isUnpublishedAuthPath,
  mcpAuthenticateChallenge,
  type McpAuthenticationDependencies,
} from "./auth";

const connection: McpConnection = {
  actor: { id: "user-1", email: "member@example.test", name: "Member" },
  orgId: "11111111-1111-4111-8111-111111111111",
  clientId: "client-1",
};

function dependencies(input: {
  session?: McpTokenSession | null;
  resolved?: McpConnection | null;
  onResolve?: (value: { clientId: string; userId: string }) => void;
}): McpAuthenticationDependencies {
  return {
    readTokenSession: async () => input.session ?? null,
    resolveConnection: async (value) => {
      input.onResolve?.(value);
      return input.resolved ?? null;
    },
  };
}

describe("MCP request authentication", () => {
  it("resolves the consented connection for a valid access token", async () => {
    const seen: { clientId: string; userId: string }[] = [];
    const resolved = await authenticateMcpRequest(
      new Headers({ authorization: "Bearer token" }),
      dependencies({
        session: { userId: "user-1", clientId: "client-1", scopes: ["openid", "offline_access"] },
        resolved: connection,
        onResolve: (value) => seen.push(value),
      }),
    );

    expect(resolved).toEqual(connection);
    expect(seen).toEqual([{ clientId: "client-1", userId: "user-1" }]);
  });

  it("refuses a request whose token does not resolve to a session", async () => {
    let resolveCalled = false;
    const resolved = await authenticateMcpRequest(
      new Headers(),
      dependencies({ session: null, onResolve: () => { resolveCalled = true; } }),
    );

    expect(resolved).toBeNull();
    expect(resolveCalled).toBe(false);
  });

  it("refuses a valid token whose client has no consented workspace or lost its membership", async () => {
    const resolved = await authenticateMcpRequest(
      new Headers({ authorization: "Bearer token" }),
      dependencies({
        session: { userId: "user-1", clientId: "client-1", scopes: ["openid"] },
        resolved: null,
      }),
    );

    expect(resolved).toBeNull();
  });

  it.each([
    "https://evil.test", "http://skillpack.app", "http://www.skillpack.app",
    "https://skillpack-x.evil.vercel.app", "https://skillpack-x-another-team.vercel.app",
    "http://skillpack-x-the-vibe-company.vercel.app", "https://skillpack-x-the-vibe-company.vercel.app:8443",
    "https://skillpack-x-the-vibe-company.vercel.app.evil.test", "https://skillpack--the-vibe-company.vercel.app",
    "not a URL", "javascript:alert(1)", "https://user:password@skillpack.app", "https://skillpack.app/path", 'https://evil.test/"',
  ])("ignores an untrusted discovery origin %s", (marker) => {
    expect(mcpAuthenticateChallenge("https://skillpack.app", marker)).toBe(
      'Bearer resource_metadata="https://skillpack.app/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it.each([
    "https://skillpack.app", "https://www.skillpack.app",
    "https://skillpack-x-the-vibe-company.vercel.app",
    "https://skillpack-git-codex-agent-ready-metadat-72e112-the-vibe-company.vercel.app",
  ])("honors an allowed production or project-preview origin %s", (marker) => {
    expect(mcpAuthenticateChallenge("https://configured.example", marker)).toBe(
      `Bearer resource_metadata="${marker}/.well-known/oauth-protected-resource/mcp"`,
    );
  });

  it("honors exact configured web and public-instance origins, including local development", () => {
    for (const marker of ["https://hub.example.test", "https://issuer.example.test"]) {
      expect(mcpAuthenticateChallenge("https://hub.example.test", marker, ["https://issuer.example.test"])).toBe(
        `Bearer resource_metadata="${marker}/.well-known/oauth-protected-resource/mcp"`,
      );
    }
    expect(mcpAuthenticateChallenge("http://127.0.0.1:3000", "http://127.0.0.1:3001", ["http://127.0.0.1:3001"])).toBe(
      'Bearer resource_metadata="http://127.0.0.1:3001/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it("points an unauthenticated client at this instance's protected-resource metadata", () => {
    expect(mcpAuthenticateChallenge("https://skillpack.app")).toBe(
      'Bearer resource_metadata="https://skillpack.app/.well-known/oauth-protected-resource/mcp"',
    );
  });
});

function promptsOf(request: Request): string[] {
  return new URL(request.url).searchParams.getAll("prompt");
}

describe("MCP authorization is always routed through the consent screen", () => {
  const authorize = "https://skillpack.app/auth/mcp/authorize?response_type=code&client_id=abc";

  it("adds the consent prompt a client left out", () => {
    expect(promptsOf(forceMcpConsentPrompt(new Request(authorize)))).toEqual(["consent"]);
  });

  it("replaces a prompt the client chose for itself", () => {
    expect(promptsOf(forceMcpConsentPrompt(new Request(`${authorize}&prompt=none`)))).toEqual(["consent"]);
    expect(promptsOf(forceMcpConsentPrompt(new Request(`${authorize}&prompt=login`)))).toEqual(["consent"]);
  });

  it("collapses a repeated prompt, which would otherwise smuggle a second value past the rewrite", () => {
    // `searchParams.get` returns only the first value, and the router downstream collapses repeats
    // into an array that matches neither of the plugin's string comparisons — so a guard that read
    // the current value before rewriting would pass this through untouched and skip consent.
    for (const query of ["&prompt=consent&prompt=none", "&prompt=none&prompt=consent", "&prompt=consent&prompt=consent"]) {
      expect(promptsOf(forceMcpConsentPrompt(new Request(`${authorize}${query}`)))).toEqual(["consent"]);
    }
  });

  it("carries the session cookie through the rewrite", () => {
    // The rewrite builds a new Request. Dropping the init would lose the Cookie header, bounce every
    // authorize to the login page, and still satisfy every assertion about the query string.
    const signedIn = new Request(`${authorize}&prompt=none`, { headers: { cookie: "better-auth.session_token=abc" } });
    const rewritten = forceMcpConsentPrompt(signedIn);
    expect(rewritten.headers.get("cookie")).toBe("better-auth.session_token=abc");
    expect(promptsOf(rewritten)).toEqual(["consent"]);
  });

  it("leaves every other Better Auth request alone", () => {
    const token = new Request("https://skillpack.app/auth/mcp/token", { method: "POST" });
    expect(forceMcpConsentPrompt(token)).toBe(token);
    const register = new Request("https://skillpack.app/auth/mcp/register?prompt=none");
    expect(promptsOf(forceMcpConsentPrompt(register))).toEqual(["none"]);
  });

  it("does not publish the endpoints that would bypass the workspace binding", () => {
    expect(isUnpublishedAuthPath("/auth/mcp/get-session")).toBe(true);
    expect(isUnpublishedAuthPath("/auth/oauth2/consent")).toBe(true);
    expect(isUnpublishedAuthPath("/auth/mcp/authorize")).toBe(false);
    expect(isUnpublishedAuthPath("/auth/mcp/token")).toBe(false);
    expect(isUnpublishedAuthPath("/auth/mcp/register")).toBe(false);
  });
});
