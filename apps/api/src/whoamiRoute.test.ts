import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@skillpack/db";

const serviceMocks = vi.hoisted(() => {
  const noop = vi.fn(async () => undefined);
  return {
    ApiTokenRefreshError: class ApiTokenRefreshError extends Error {},
    ensureUserBootstrap: noop,
    resolveApiToken: vi.fn(),
    getCurrentApiTokenMetadata: vi.fn(),
    listOrgs: vi.fn(),
    getOnboardingState: vi.fn(),
    getMyAvatarUrl: vi.fn(),
    getUserTimezone: vi.fn(),
    updateUserProfile: vi.fn(),
  };
});

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  authenticateAgentRequest: vi.fn(async () => null),
  updateUser: vi.fn(),
  handler: vi.fn(),
  guardAgentAuthRemoteKeys: vi.fn<() => Promise<"allowed" | "remote-jwks" | "body-too-large">>(
    async () => "allowed",
  ),
}));

const dbMocks = vi.hoisted(() => ({
  withTenantContext: vi.fn(async <T>(_input: { orgId: string; userId: string }, fn: (database: Db) => Promise<T>): Promise<T> => {
    // SAFETY: this route harness replaces every database-facing service; no Drizzle method is reachable.
    const database = {} as Db;
    Object.assign(database, { marker: "tenant-db" });
    return fn(database);
  }),
}));

// oxlint-disable-next-line anti-slop/no-module-mocking -- server startup is outside this route behavior proof.
vi.mock("@hono/node-server", () => ({ serve: vi.fn() }));
// oxlint-disable-next-line anti-slop/no-module-mocking -- authentication is supplied by the route harness.
vi.mock("@skillpack/auth", () => ({
  auth: {
    api: { getSession: authMocks.getSession, updateUser: authMocks.updateUser },
    handler: authMocks.handler,
    $Infer: {},
  },
  guardAgentAuthRemoteKeys: authMocks.guardAgentAuthRemoteKeys,
  authenticateAgentRequest: authMocks.authenticateAgentRequest,
  registerAgentCapabilityExecutor: vi.fn(() => () => undefined),
}));
// oxlint-disable-next-line anti-slop/no-module-mocking -- the tenant callback is tested through a typed fake database.
vi.mock("@skillpack/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@skillpack/db")>()),
  ...dbMocks,
}));
// oxlint-disable-next-line anti-slop/no-module-mocking -- service behavior is isolated to test PAT and whoami branches.
vi.mock("@skillpack/core/services", () => serviceMocks);

import { app } from "./index";

describe("GET /v1/auth/whoami", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.getSession.mockResolvedValue(null);
    authMocks.authenticateAgentRequest.mockResolvedValue(null);
    authMocks.guardAgentAuthRemoteKeys.mockResolvedValue("allowed");
    serviceMocks.getUserTimezone.mockResolvedValue(null);
  });

  it("returns 401 only when no authenticated actor exists", async () => {
    const response = await app.request("/v1/auth/whoami");

    expect(response.status).toBe(401);
  });

  it("keeps an authenticated dependency failure retryable as a 5xx", async () => {
    authMocks.getSession.mockResolvedValue({
      user: { id: "user-1", email: "user@example.test", name: "User" },
      session: { id: "session-1" },
    });
    serviceMocks.listOrgs.mockRejectedValue(new Error("database unavailable"));

    const response = await app.request("/v1/auth/whoami");

    expect(response.status).toBe(500);
  });

  it("exposes the stored member timezone to every first-party client", async () => {
    authMocks.getSession.mockResolvedValue({
      user: { id: "user-1", email: "user@example.test", name: "User" },
      session: { id: "session-1" },
    });
    serviceMocks.listOrgs.mockResolvedValue([{ org_id: "org-1", org_role: "developer" }]);
    serviceMocks.getOnboardingState.mockResolvedValue({ onboarded: true });
    serviceMocks.getMyAvatarUrl.mockResolvedValue(null);
    serviceMocks.getUserTimezone.mockResolvedValue("Pacific/Auckland");

    const response = await app.request("/v1/auth/whoami");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      userId: "user-1",
      timezone: "Pacific/Auckland",
    });
  });
});

describe("GET /v1/tokens/current", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.getSession.mockResolvedValue(null);
    serviceMocks.resolveApiToken.mockResolvedValue(null);
    serviceMocks.getCurrentApiTokenMetadata.mockResolvedValue(null);
    dbMocks.withTenantContext.mockImplementation(async (_input, fn) => {
      // SAFETY: all database calls are mocked in this route harness; only the marker is observed by assertions.
      const database = {} as Db;
      Object.assign(database, { marker: "tenant-db" });
      return fn(database);
    });
  });

  it("returns the PAT identity, workspace, and metadata without exposing the secret", async () => {
    const patActor = { id: "pat-user", email: "pat@example.test", name: "PAT User" };
    serviceMocks.resolveApiToken.mockResolvedValue({
      actor: patActor,
      orgId: "org-pat",
      scopes: ["skills:read", "skills:write", "secrets:read", "secrets:write", "database:read", "database:write", "public-skills:install"],
      sourceType: "human",
    });
    serviceMocks.listOrgs.mockResolvedValue([{ org_id: "org-pat", name: "PAT Workspace", org_role: "developer" }]);
    serviceMocks.getCurrentApiTokenMetadata.mockResolvedValue({
      id: "token-pat",
      prefix: "cmp_pat_abc123",
      scopes: ["skills:read", "skills:write", "secrets:read", "secrets:write", "database:read", "database:write", "public-skills:install"],
      expires_at: "2026-12-22T00:00:00.000Z",
    });

    const response = await app.request("/v1/tokens/current", {
      headers: {
        authorization: "Bearer cmp_pat_secret-value",
        "x-companion-org": "org-cookie-hint",
      },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      user: patActor,
      workspace: { id: "org-pat", name: "PAT Workspace" },
      token: {
        id: "token-pat",
        prefix: "cmp_pat_abc123",
        scopes: ["skills:read", "skills:write", "secrets:read", "secrets:write", "database:read", "database:write", "public-skills:install"],
        expires_at: "2026-12-22T00:00:00.000Z",
      },
    });
    expect(JSON.stringify(body)).not.toContain("secret-value");
    expect(serviceMocks.getCurrentApiTokenMetadata).toHaveBeenCalledWith(expect.objectContaining({
      rawToken: "cmp_pat_secret-value",
      actor: patActor,
      orgId: "org-pat",
      database: { marker: "tenant-db" },
    }));
    expect(dbMocks.withTenantContext).toHaveBeenCalledWith(
      { orgId: "org-pat", userId: "pat-user" },
      expect.any(Function),
    );
  });

  it("requires a bearer PAT even when a browser cookie session exists", async () => {
    authMocks.getSession.mockResolvedValue({
      user: { id: "cookie-user", email: "cookie@example.test", name: "Cookie User" },
      session: { id: "session-1" },
    });

    const response = await app.request("/v1/tokens/current");

    expect(response.status).toBe(401);
    expect(serviceMocks.resolveApiToken).not.toHaveBeenCalled();
    expect(serviceMocks.getCurrentApiTokenMetadata).not.toHaveBeenCalled();
  });

  it("rejects revoked, expired, or unknown bearer tokens before querying metadata", async () => {
    const response = await app.request("/v1/tokens/current", {
      headers: { authorization: "Bearer cmp_pat_revoked" },
    });

    expect(response.status).toBe(401);
    expect(serviceMocks.getCurrentApiTokenMetadata).not.toHaveBeenCalled();
    expect(serviceMocks.listOrgs).not.toHaveBeenCalled();
  });
});

describe("PUT /v1/users/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.getSession.mockResolvedValue({
      user: { id: "user-1", email: "user@example.test", name: "User" },
      session: { id: "session-1" },
    });
    serviceMocks.updateUserProfile.mockResolvedValue({
      id: "user-1",
      name: "User",
      initials: "U",
      timezone: "Pacific/Auckland",
    });
  });

  it("persists a timezone through the shared self-service profile endpoint", async () => {
    const response = await app.request("/v1/users/me", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timezone: "Pacific/Auckland" }),
    });

    expect(response.status).toBe(200);
    expect(serviceMocks.updateUserProfile).toHaveBeenCalledWith(expect.objectContaining({
      actor: expect.objectContaining({ id: "user-1" }),
      name: undefined,
      timezone: "Pacific/Auckland",
    }));
    await expect(response.json()).resolves.toMatchObject({ timezone: "Pacific/Auckland" });
    expect(authMocks.updateUser).not.toHaveBeenCalled();
  });
});

describe("raw Agent Auth capability mutation routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.getSession.mockResolvedValue(null);
    authMocks.guardAgentAuthRemoteKeys.mockResolvedValue("allowed");
  });

  it.each([
    "/auth/agent/approve-capability",
    "/auth/agent/approve-capability/",
    "/auth/agent/grant-capability",
    "/auth/agent/grant-capability//",
  ])("blocks %s before the Better Auth wildcard handler", async (path) => {
    const response = await app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "use_device_approval_route" });
    expect(authMocks.handler).not.toHaveBeenCalled();
  });

  it.each([
    "/auth/host/create",
    "/auth/host/create/",
    "/auth/host/create//",
  ])("forces host creation defaults to an empty capability list at %s", async (path) => {
    authMocks.handler.mockImplementationOnce(async (request: Request) =>
      Response.json(await request.json()));

    const response = await app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Codex host",
        default_capabilities: ["skills:write", "secrets:read"],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: "Codex host", default_capabilities: [] });
  });

  it("runs the remote-key guard before a host wrapper reads or forwards the body", async () => {
    authMocks.guardAgentAuthRemoteKeys.mockResolvedValueOnce("remote-jwks");
    const response = await app.request("/auth/host/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jwks_url: "https://metadata.attacker.example/jwks" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "remote_agent_jwks_disabled" });
    expect(authMocks.handler).not.toHaveBeenCalled();
  });

  it.each([
    "/auth/host/update",
    "/auth/host/update/",
    "/auth/host/update//",
  ])("blocks host default-capability updates at %s", async (path) => {
    const blocked = await app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ host_id: "host-1", default_capabilities: [] }),
    });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ error: "host_default_capabilities_disabled" });
    expect(authMocks.handler).not.toHaveBeenCalled();
  });

  it("forwards identity-only host updates", async () => {
    authMocks.handler.mockResolvedValueOnce(Response.json({ ok: true }));
    const allowed = await app.request("/auth/host/update/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ host_id: "host-1", name: "Renamed host" }),
    });
    expect(allowed.status).toBe(200);
    expect(authMocks.handler).toHaveBeenCalledOnce();
    // SAFETY: the route passes a Request to the Better Auth handler, and this test asserts that forwarded body.
    const forwarded = authMocks.handler.mock.calls[0]?.[0] as Request;
    expect(await forwarded.json()).toEqual({ host_id: "host-1", name: "Renamed host" });
  });
});
