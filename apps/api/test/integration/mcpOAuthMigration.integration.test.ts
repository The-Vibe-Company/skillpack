/** Seed the real 1.6 storage, then upgrade it: issued credentials and workspace consent survive. */
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("MCP migration test requires an explicit disposable database owner URL");
const admin = postgres(databaseUrl, { max: 1 });
const databaseName = `skillpack_mcp_upgrade_${randomUUID().replaceAll("-", "")}`;
const upgradeUrl = new URL(databaseUrl);
upgradeUrl.pathname = `/${databaseName}`;
upgradeUrl.search = "";
const migrations = fileURLToPath(new URL("../../../../packages/db/drizzle/", import.meta.url));
let sql: ReturnType<typeof postgres>;
const orgId = randomUUID();
const userId = `mcp-upgrade-${randomUUID()}`;
const cachedSessionId = randomUUID();
const cachedSessionToken = randomUUID();
const access = randomUUID();
const refresh = randomUUID();
const secret = randomUUID();
const clientId = `migrated-client-${randomUUID()}`;
const confidentialId = `migrated-confidential-${randomUUID()}`;
const deniedId = `migrated-denied-${randomUUID()}`;
const digest = (value: string) => createHash("sha256").update(value).digest("base64url");
let authModule: typeof import("@skillpack/auth");
let closeAuthDatabase: (() => Promise<void>) | undefined;

async function apply(name: string) {
  for (const statement of (await readFile(`${migrations}/${name}`, "utf8")).split("--> statement-breakpoint")) {
    if (statement.trim()) await sql.unsafe(statement);
  }
}

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  sql = postgres(upgradeUrl.toString(), { max: 1 });
  // OAuth only depends on the unchanged identity and membership tables in the initial schema.
  const initial = (await readdir(migrations)).find((name) => name.startsWith("0000_") && name.endsWith(".sql"));
  if (!initial) throw new Error("initial migration missing");
  await apply(initial);
  await sql.unsafe((await readFile(`${migrations}/0050_agent_auth_identity.sql`, "utf8")).split('CREATE TABLE "agent_auth_ephemeral"')[1]!
    .split("--> statement-breakpoint").slice(0, 1).map((source) => 'CREATE TABLE "agent_auth_ephemeral"' + source).join(""));
  await apply("0187_mcp_oauth.sql");
  await sql`INSERT INTO "user" (id, name, email, email_verified) VALUES (${userId}, 'Upgrade User', ${`${userId}@example.test`}, true)`;
  await sql`INSERT INTO organizations (id, name, slug) VALUES (${orgId}, 'Upgrade Workspace', ${`upgrade-${orgId}`})`;
  await sql`INSERT INTO memberships (org_id, user_id, org_role) VALUES (${orgId}, ${userId}, 'developer')`;
  for (const id of [clientId, confidentialId, deniedId]) {
    await sql`INSERT INTO oauth_application (id, client_id, name, client_secret, redirect_urls, type, metadata)
      VALUES (${id}, ${id}, 'Preserved Client', ${id === confidentialId ? secret : ''},
        'https://client.example.test/callback,https://client.example.test/other', ${id === confidentialId ? 'web' : 'public'}, '{"preserve":"metadata"}')`;
    await sql`INSERT INTO mcp_client_workspaces (client_id, org_id, user_id) VALUES (${id}, ${orgId}, ${userId})`;
    await sql`INSERT INTO oauth_consent (id, client_id, user_id, scopes, consent_given)
      VALUES (${id}, ${id}, ${userId}, 'openid offline_access', ${id !== deniedId})`;
  }
  await sql`INSERT INTO oauth_access_token (id, access_token, refresh_token, client_id, user_id, scopes, access_token_expires_at, refresh_token_expires_at)
    VALUES ('preserved-grant', ${access}, ${refresh}, ${clientId}, ${userId}, 'openid offline_access', now() + interval '1 hour', now() + interval '30 days')`;
  await sql`INSERT INTO oauth_access_token (id, access_token, refresh_token, client_id, user_id, scopes, access_token_expires_at, refresh_token_expires_at)
    VALUES ('confidential-grant', ${`confidential-${access}`}, ${`confidential-${refresh}`}, ${confidentialId}, ${userId},
      'openid offline_access', now() + interval '1 hour', now() + interval '30 days')`;
  await sql`INSERT INTO agent_auth_ephemeral (key, value, expires_at) VALUES (${cachedSessionToken}, ${JSON.stringify({
    session: { id: cachedSessionId, token: cachedSessionToken, userId, expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    user: { id: userId },
  })}, now() + interval '1 hour')`;
  await sql`INSERT INTO agent_auth_ephemeral (key, value) VALUES ('unrelated-non-json-cache-value', 'not JSON')`;
  await apply("0198_better_auth_17_mcp.sql");
  vi.stubEnv("DATABASE_URL", upgradeUrl.toString());
  vi.resetModules();
  authModule = await import("@skillpack/auth");
  closeAuthDatabase = (await import("@skillpack/db")).closeDb;
}, 120_000);

afterAll(async () => {
  await closeAuthDatabase?.();
  await sql?.end({ timeout: 1 });
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  await admin.end({ timeout: 1 });
  vi.unstubAllEnvs();
});

describe("0198 OAuth migration", () => {
  it("preserves clients, approved consent, expiry and workspace bindings while hashing credentials", async () => {
    expect(await sql`SELECT id, user_id, token, expires_at > now() AS live FROM "session" WHERE id = ${cachedSessionId}`)
      .toEqual([{ id: cachedSessionId, user_id: userId, token: cachedSessionToken, live: true }]);
    const [client] = await sql`SELECT client_id, redirect_uris, metadata, token_endpoint_auth_method, require_pkce FROM oauth_application WHERE client_id = ${clientId}`;
    expect(client).toMatchObject({ client_id: clientId, redirect_uris: ["https://client.example.test/callback", "https://client.example.test/other"],
      metadata: { preserve: "metadata" }, token_endpoint_auth_method: "none", require_pkce: true });
    const [confidential] = await sql`SELECT client_secret, token_endpoint_auth_method FROM oauth_application WHERE client_id = ${confidentialId}`;
    expect(confidential).toMatchObject({ client_secret: digest(secret), token_endpoint_auth_method: "client_secret_basic" });
    const [grant] = await sql`SELECT token, expires_at > now() AS live FROM oauth_access_token WHERE id = 'preserved-grant'`;
    expect(grant).toMatchObject({ token: digest(access), live: true });
    const [refreshGrant] = await sql`SELECT token, expires_at > now() AS live FROM oauth_refresh_token WHERE id = 'preserved-grant'`;
    expect(refreshGrant).toMatchObject({ token: digest(refresh), live: true });
    expect(await sql`SELECT * FROM companion_resolve_mcp_connection(${clientId}, ${userId})`).toHaveLength(1);
    expect(await sql`SELECT * FROM companion_resolve_mcp_connection(${deniedId}, ${userId})`).toHaveLength(0);
    expect(await sql`SELECT * FROM oauth_consent WHERE client_id = ${deniedId}`).toHaveLength(0);
  });

  it("preserves body-secret authentication for existing confidential clients", async () => {
    const invalid = await authModule.auth.handler(new Request(new URL("/auth/mcp/token", authModule.publicInstanceOrigin()), {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: confidentialId, client_secret: "wrong-secret",
        refresh_token: `confidential-${refresh}` }),
    }));
    expect(invalid.status).toBe(401);
    const response = await authModule.auth.handler(new Request(new URL("/auth/mcp/token", authModule.publicInstanceOrigin()), {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: confidentialId, client_secret: secret,
        refresh_token: `confidential-${refresh}` }),
    }));
    expect(response.status).toBe(200);
    const tokens = z.object({ access_token: z.string() }).parse(await response.json());
    expect(await authModule.getMcpTokenSession(new Headers({ authorization: `Bearer ${tokens.access_token}` })))
      .toMatchObject({ clientId: confidentialId, userId });
  });

  it("accepts the original opaque access token, refreshes the original grant and revokes both", async () => {
    expect(await authModule.getMcpTokenSession(new Headers({ authorization: `Bearer ${access}` }))).toMatchObject({ clientId, userId });
    const response = await authModule.auth.handler(new Request(new URL("/auth/mcp/token", authModule.publicInstanceOrigin()), {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: refresh, resource: authModule.mcpResourceUrl() }),
    }));
    const tokens = z.object({ access_token: z.string(), refresh_token: z.string() }).parse(await response.json());
    expect(response.status, JSON.stringify(tokens)).toBe(200);
    expect(await authModule.getMcpTokenSession(new Headers({ authorization: `Bearer ${tokens.access_token}` }))).toMatchObject({ clientId, userId });
    expect(await sql`SELECT companion_revoke_mcp_connection(${clientId}, ${userId}) AS revoked`).toEqual([{ revoked: true }]);
    expect(await authModule.getMcpTokenSession(new Headers({ authorization: `Bearer ${access}` }))).toBeNull();
    expect(await authModule.getMcpTokenSession(new Headers({ authorization: `Bearer ${tokens.access_token}` }))).toBeNull();
    expect(await sql`SELECT * FROM oauth_refresh_token WHERE client_id = ${clientId}`).toHaveLength(0);
    expect(await sql`SELECT * FROM mcp_client_workspaces WHERE client_id = ${clientId}`).toHaveLength(0);
  });
});
