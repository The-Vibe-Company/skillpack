/** Real OAuth provider/storage test: browser consent, PKCE, refresh and immediate revocation. */
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { makeSignature } from "better-auth/crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@skillpack/db";
import {
  auth, decideMcpConsent, getBetterAuthSecret, getMcpPendingAuthorization,
  getMcpTokenSession, mcpResourceUrl, publicInstanceOrigin,
} from "@skillpack/auth";
import { bindMcpClientWorkspace, resolveMcpConnection, revokeMcpConnection } from "@skillpack/core/services";
import { createIntegrationFixture, integrationDb, type IntegrationFixture, type TestActor } from "./testDatabase";

let fixture: IntegrationFixture;
async function browser(actor: TestActor): Promise<Headers> {
  const token = randomUUID();
  await integrationDb.insert(schema.session).values({
    id: randomUUID(), userId: actor.id, token, expiresAt: new Date(Date.now() + 3600_000),
  });
  const signature = await makeSignature(token, getBetterAuthSecret());
  const prefix = process.env.BETTER_AUTH_COOKIE_PREFIX ?? "better-auth";
  return new Headers({ cookie: `${prefix}.session_token=${encodeURIComponent(`${token}.${signature}`)}` });
}
function request(path: string, init?: RequestInit): Promise<Response> {
  return auth.handler(new Request(new URL(path, publicInstanceOrigin()), init));
}
async function tokenRequest(endpoint: string, values: Record<string, string>) {
  const response = await request(endpoint, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values),
  });
  const body = z.object({ access_token: z.string().optional(), refresh_token: z.string().optional(), error: z.string().optional() }).parse(await response.json());
  return { response, body };
}

beforeAll(async () => { fixture = await createIntegrationFixture(); });
afterAll(async () => { await fixture?.cleanup(); });

describe("Better Auth 1.7 MCP provider", () => {
  for (const namespace of ["oauth2", "mcp"]) {
    it(`completes ${namespace} registration, session-owned consent, PKCE, refresh and revocation`, async () => {
      const headers = await browser(fixture.developer);
      const outsider = await browser(fixture.outsider);
      const registered = await request(`/auth/${namespace}/register`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_name: "MCP OAuth integration", redirect_uris: ["https://client.example.test/callback"],
          token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
      });
      expect(registered.status, await registered.clone().text()).toBe(201);
      const registration = z.object({ client_id: z.string() }).parse(await registered.json());
      const clientId = registration.client_id;
      const verifier = randomUUID() + randomUUID();
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      const query = new URLSearchParams({ client_id: clientId, response_type: "code", redirect_uri: "https://client.example.test/callback",
        scope: "openid offline_access", code_challenge: challenge, code_challenge_method: "S256", state: "test-state", prompt: "none" });
      const authorization = await request(`/auth/${namespace}/authorize?${query}`, { headers });
      expect(authorization.status, await authorization.clone().text()).toBe(302);
      const consentUrl = new URL(authorization.headers.get("location")!);
      expect(consentUrl.pathname).toBe("/mcp/consent");
      expect(consentUrl.searchParams.has("sig")).toBe(false);
      const code = consentUrl.searchParams.get("consent_code")!;
      const pending = await getMcpPendingAuthorization(code);
      expect(pending).toMatchObject({ clientId, userId: fixture.developer.id, redirectOrigin: "https://client.example.test" });
      expect(await resolveMcpConnection({ clientId, userId: fixture.developer.id })).toBeNull();
      await expect(decideMcpConsent({ headers: outsider, accept: true, consentCode: code })).rejects.toThrow(/different|expired/);
      expect(await getMcpPendingAuthorization(code)).not.toBeNull();
      await expect(bindMcpClientWorkspace({ actor: fixture.developer, orgId: fixture.orgB, clientId })).rejects.toThrow();
      const approved = await decideMcpConsent({ headers, accept: true, consentCode: code, beforeApprove: async () => {
        await bindMcpClientWorkspace({ actor: fixture.developer, orgId: fixture.orgA, clientId });
      } });
      const callback = new URL(approved.redirectURI);
      expect(callback.origin).toBe("https://client.example.test");
      expect(callback.searchParams.get("state")).toBe("test-state");
      expect(await getMcpPendingAuthorization(code)).toBeNull();
      await expect(decideMcpConsent({ headers, accept: true, consentCode: code })).rejects.toThrow();
      const tokens = await tokenRequest(`/auth/${namespace}/token`, { grant_type: "authorization_code", client_id: clientId,
        code: callback.searchParams.get("code")!, code_verifier: verifier, redirect_uri: "https://client.example.test/callback" });
      expect(tokens.response.status, JSON.stringify(tokens.body)).toBe(200);
      expect(tokens.body.access_token).toBeTruthy();
      expect(tokens.body.refresh_token).toBeTruthy();
      const identity = await getMcpTokenSession(new Headers({ authorization: `Bearer ${tokens.body.access_token}` }));
      expect(identity).toMatchObject({ clientId, userId: fixture.developer.id });
      expect((await resolveMcpConnection(identity!))?.orgId).toBe(fixture.orgA);
      const refreshed = await tokenRequest(`/auth/${namespace}/token`, { grant_type: "refresh_token", client_id: clientId,
        refresh_token: tokens.body.refresh_token!, resource: mcpResourceUrl() });
      expect(refreshed.response.status, JSON.stringify(refreshed.body)).toBe(200);
      expect(await getMcpTokenSession(new Headers({ authorization: `Bearer ${refreshed.body.access_token}` }))).not.toBeNull();
      const replay = await tokenRequest(`/auth/${namespace}/token`, { grant_type: "refresh_token", client_id: clientId,
        refresh_token: tokens.body.refresh_token! });
      expect(replay.response.status).toBeGreaterThanOrEqual(400);
      expect(await revokeMcpConnection({ actor: fixture.developer, clientId })).toBe(true);
      expect(await getMcpTokenSession(new Headers({ authorization: `Bearer ${refreshed.body.access_token}` }))).toBeNull();
      expect((await tokenRequest(`/auth/${namespace}/token`, { grant_type: "refresh_token", client_id: clientId,
        refresh_token: refreshed.body.refresh_token! })).response.status).toBeGreaterThanOrEqual(400);
    });
  }

  it("closes direct consent, legacy token-session disclosure and authorization POST bypasses", async () => {
    for (const path of ["/auth/oauth2/consent", "/auth/oauth2/consent/", "/auth/mcp/get-session", "/auth/mcp/get-session/"]) {
      expect((await request(path, { method: "POST" })).status).toBe(404);
    }
    for (const path of ["/auth/oauth2/authorize", "/auth/mcp/authorize"]) {
      expect((await request(path, { method: "POST", body: "prompt=none" })).status).toBe(405);
    }
  });

  it("keeps provider administration and managed client creation outside member authority", async () => {
    const headers = await browser(fixture.owner);
    headers.set("content-type", "application/json");
    for (const path of ["/auth/admin/oauth2/resources", "/auth/admin/oauth2/create-client", "/auth/oauth2/create-client", "/auth/oauth2/update-client"]) {
      expect((await request(path, { method: "POST", headers, body: "{}" })).status).toBe(404);
    }
  });

  it("serves discovery with the canonical issuer and resource", async () => {
    const metadata = await request("/auth/.well-known/oauth-authorization-server");
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toMatchObject({ issuer: `${publicInstanceOrigin()}/auth`, authorization_endpoint: `${publicInstanceOrigin()}/auth/oauth2/authorize` });
    for (const path of ["/auth/oauth2/userinfo", "/auth/oauth2/end-session"]) {
      expect((await request(path)).status).not.toBe(404);
    }
    for (const path of ["/auth/oauth2/introspect", "/auth/oauth2/revoke"]) {
      expect((await request(path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "" })).status).not.toBe(404);
    }
    const resource = await request("/auth/.well-known/oauth-protected-resource");
    expect(resource.status).toBe(200);
    expect(await resource.json()).toMatchObject({ resource: mcpResourceUrl(), authorization_servers: [`${publicInstanceOrigin()}/auth`] });
  });
});
