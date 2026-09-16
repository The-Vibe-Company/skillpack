/**
 * Product promise:
 * An MCP connection acts with the consenting member's own rights inside exactly the one workspace
 * they chose on the consent screen, and stops working the moment that membership ends.
 *
 * Regression caught:
 * Dropping the membership join in the pre-tenant resolver, writing the workspace mapping before
 * `assertMember` succeeds, or letting a tool take a workspace argument would let one connection read
 * or mutate an organization its member never consented to — or one they were removed from.
 *
 * Why this test is integrated:
 * The boundary spans the MCP tool server, the tenant transaction, the real `mcp_client_workspaces`
 * and Better Auth OAuth tables, the SECURITY DEFINER resolver, and PostgreSQL's own cascades.
 *
 * Failure proof:
 * Removing the membership join from `companion_resolve_mcp_connection` keeps a removed member
 * connected; binding the workspace without `assertMember` lets a non-member consent into another
 * organization; and dropping the org predicate in the tool layer makes `skills_list` return the
 * other workspace's skills.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { schema } from "@skillpack/db";
import {
  bindMcpClientWorkspace,
  listMcpConnections,
  resolveMcpConnection,
  revokeMcpConnection,
  unbindMcpClientWorkspace,
} from "@skillpack/core/services";
import type { SkillDatabaseRuntime, SkillDatabaseStorage } from "@skillpack/core";
import { createSkillpackMcpServer } from "../../src/mcp/server";
import {
  createIntegrationFixture,
  integrationDb,
  integrationSql,
  seedPersonalLabel,
  seedSkill,
  type IntegrationFixture,
  type TestActor,
} from "./testDatabase";

process.env.COMPANION_BILLING_MODE = "off";
process.env.COMPANION_SECRETS_MASTER_KEY ??= Buffer.alloc(32, 13).toString("base64");

const unreachableRuntime: SkillDatabaseRuntime = {
  execute: () => Promise.reject(new Error("the skill database runtime must not be reached")),
};
const unreachableStorage: SkillDatabaseStorage = {
  get: () => Promise.reject(new Error("skill database storage must not be reached")),
  put: () => Promise.reject(new Error("skill database storage must not be reached")),
  delete: () => Promise.reject(new Error("skill database storage must not be reached")),
};

/** Record the consent row Better Auth writes when a member approves a grant. */
async function recordConsent(clientId: string, userId: string): Promise<void> {
  await integrationDb.insert(schema.oauthConsent).values({
    id: randomUUID(),
    clientId,
    userId,
    scopes: "openid offline_access",
    consentGiven: true,
  });
}

async function registerOAuthClient(clientId: string): Promise<void> {
  await integrationDb.insert(schema.oauthApplication).values({
    id: randomUUID(),
    name: "Companion",
    clientId,
    clientSecret: "",
    redirectUrls: "https://companions.build/oauth/callback",
    type: "public",
    disabled: false,
  });
}

/** Connect an MCP client to a tool server for one resolved connection, exactly as the route does. */
async function connectTools(input: { clientId: string; userId: string }): Promise<Client | null> {
  const connection = await resolveMcpConnection(input);
  if (!connection) return null;
  const server = createSkillpackMcpServer({
    connection,
    skillDatabaseRuntime: unreachableRuntime,
    skillDatabaseStorage: unreachableStorage,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "integration", version: "1" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function payload(result: CallToolResult): string {
  return result.content.map((entry) => (entry.type === "text" ? entry.text : "")).join("\n");
}

/** The JSON argument values an MCP tool call carries. */
type ToolCallValue = string | number | boolean | null | ToolCallValue[] | { [key: string]: ToolCallValue };
interface ToolCallArguments {
  [key: string]: ToolCallValue | undefined;
}

/** `callTool` widens its result for compatibility clients; this server only ever returns the modern shape. */
async function callTool(client: Client, name: string, args: ToolCallArguments): Promise<CallToolResult> {
  // SAFETY: `Client.callTool` returns `CallToolResult` unless a legacy result schema is requested,
  // and this suite never requests one.
  return await client.callTool({ name, arguments: args }) as CallToolResult;
}

let fixture: IntegrationFixture;
let developerClientId: string;
let outsiderClientId: string;
let orgSkillA: Awaited<ReturnType<typeof seedSkill>>;
let orgSkillB: Awaited<ReturnType<typeof seedSkill>>;
let ownerPersonalSkill: Awaited<ReturnType<typeof seedSkill>>;
let developer: TestActor;

beforeAll(async () => {
  fixture = await createIntegrationFixture();
  developer = fixture.developer;
  developerClientId = `mcp-client-developer-${fixture.suffix}`;
  outsiderClientId = `mcp-client-outsider-${fixture.suffix}`;
  await registerOAuthClient(developerClientId);
  await registerOAuthClient(outsiderClientId);

  orgSkillA = await seedSkill({
    orgId: fixture.orgA,
    creator: fixture.owner,
    slug: `workspace-a-skill-${fixture.suffix.slice(0, 8)}`,
    scope: "org",
  });
  orgSkillB = await seedSkill({
    orgId: fixture.orgB,
    creator: fixture.outsider,
    slug: `workspace-b-skill-${fixture.suffix.slice(0, 8)}`,
    scope: "org",
  });
  ownerPersonalSkill = await seedSkill({
    orgId: fixture.orgA,
    creator: fixture.owner,
    slug: `owner-private-${fixture.suffix.slice(0, 8)}`,
    scope: "personal",
  });
  await seedPersonalLabel({
    orgId: fixture.orgA,
    owner: fixture.owner,
    skillId: ownerPersonalSkill.id,
    path: "private",
  });
});

afterAll(async () => {
  await fixture.cleanup();
  await integrationSql.end();
});

describe("MCP connections stay bound to their consented workspace", () => {
  it("refuses consent into a workspace the member does not belong to", async () => {
    await expect(
      bindMcpClientWorkspace({ actor: fixture.outsider, orgId: fixture.orgA, clientId: outsiderClientId }),
    ).rejects.toThrow(/not a member/i);

    const rows = await integrationDb
      .select()
      .from(schema.mcpClientWorkspaces)
      .where(eq(schema.mcpClientWorkspaces.clientId, outsiderClientId));
    expect(rows).toHaveLength(0);
  });

  it("records the consented workspace and resolves it back for that member only", async () => {
    await bindMcpClientWorkspace({ actor: developer, orgId: fixture.orgA, clientId: developerClientId });
    await recordConsent(developerClientId, developer.id);

    const [row] = await integrationDb
      .select()
      .from(schema.mcpClientWorkspaces)
      .where(eq(schema.mcpClientWorkspaces.clientId, developerClientId));
    expect(row?.orgId).toBe(fixture.orgA);
    expect(row?.userId).toBe(developer.id);

    const resolved = await resolveMcpConnection({ clientId: developerClientId, userId: developer.id });
    expect(resolved?.orgId).toBe(fixture.orgA);
    expect(resolved?.actor.id).toBe(developer.id);

    // The same client presented by a different Better Auth user resolves to nothing.
    expect(await resolveMcpConnection({ clientId: developerClientId, userId: fixture.owner.id })).toBeNull();
    // An unconsented client resolves to nothing even for a real member.
    expect(await resolveMcpConnection({ clientId: outsiderClientId, userId: developer.id })).toBeNull();
  });

  it("reads only the consented workspace, and never another member's personal skills", async () => {
    const client = await connectTools({ clientId: developerClientId, userId: developer.id });
    expect(client).not.toBeNull();
    try {
      const listed = payload(await callTool(client!, "skills_list", {}));
      expect(listed).toContain(orgSkillA.slug);
      expect(listed).not.toContain(orgSkillB.slug);
      expect(listed).not.toContain(ownerPersonalSkill.slug);

      const accessible = payload(await callTool(client!, "skills_list", { lib: "accessible" }));
      expect(accessible).not.toContain(ownerPersonalSkill.slug);

      const foreign = await callTool(client!, "skill_get", { slug: orgSkillB.slug });
      expect(foreign.isError).toBe(true);

      const workspace = payload(await callTool(client!, "workspace_info", {}));
      expect(workspace).toContain(fixture.orgA);
      expect(workspace).not.toContain(fixture.orgB);
    } finally {
      await client?.close();
    }
  });

  it("archives a skill as the delete, records the audit row, and restores it again", async () => {
    const client = await connectTools({ clientId: developerClientId, userId: developer.id });
    try {
      const archived = await callTool(client!, "skill_archive", { slug: orgSkillA.slug, reason: "superseded" });
      expect(archived.isError).toBeFalsy();

      const [skill] = await integrationDb
        .select()
        .from(schema.skills)
        .where(and(eq(schema.skills.orgId, fixture.orgA), eq(schema.skills.id, orgSkillA.id)));
      expect(skill?.archivedAt).not.toBeNull();
      expect(skill?.archivedBy).toBe(developer.id);

      const audit = await integrationDb
        .select()
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.orgId, fixture.orgA), eq(schema.auditLog.targetId, orgSkillA.id)));
      expect(audit.map((entry) => entry.action)).toContain("skill.archive");

      const hidden = payload(await callTool(client!, "skills_list", {}));
      expect(hidden).not.toContain(orgSkillA.slug);

      const restored = await callTool(client!, "skill_restore", { slug: orgSkillA.slug });
      expect(restored.isError).toBeFalsy();

      const [back] = await integrationDb
        .select()
        .from(schema.skills)
        .where(and(eq(schema.skills.orgId, fixture.orgA), eq(schema.skills.id, orgSkillA.id)));
      expect(back?.archivedAt).toBeNull();
    } finally {
      await client?.close();
    }
  });

  it("validates a publish without storing anything when asked for a dry run", async () => {
    const client = await connectTools({ clientId: developerClientId, userId: developer.id });
    const slug = `dry-run-${fixture.suffix.slice(0, 8)}`;
    try {
      const result = await callTool(client!, "skill_publish", {
        slug,
        files: [
          {
            path: "SKILL.md",
            content: `---\nname: ${slug}\ndescription: A skill published over MCP for validation only.\n---\n\nSteps.\n`,
          },
        ],
        dry_run: true,
      });

      expect(result.isError).toBeFalsy();
      expect(payload(result)).toContain('"dry_run": true');

      const stored = await integrationDb
        .select()
        .from(schema.skills)
        .where(and(eq(schema.skills.orgId, fixture.orgA), eq(schema.skills.slug, slug)));
      expect(stored).toHaveLength(0);
    } finally {
      await client?.close();
    }
  });

  it("stops resolving the moment the member loses their membership", async () => {
    await integrationDb
      .delete(schema.memberships)
      .where(and(eq(schema.memberships.orgId, fixture.orgA), eq(schema.memberships.userId, developer.id)));
    try {
      expect(await resolveMcpConnection({ clientId: developerClientId, userId: developer.id })).toBeNull();
      expect(await connectTools({ clientId: developerClientId, userId: developer.id })).toBeNull();
    } finally {
      await integrationDb
        .insert(schema.memberships)
        .values({ orgId: fixture.orgA, userId: developer.id, orgRole: "developer" });
    }
  });

  it("refuses to resolve a mapping whose grant was never approved", async () => {
    const clientId = `mcp-unapproved-${fixture.suffix}`;
    await registerOAuthClient(clientId);
    // The consent screen writes the mapping just before it approves. If the approval never lands,
    // the row must be inert rather than a standing workspace binding.
    await bindMcpClientWorkspace({ actor: fixture.owner, orgId: fixture.orgA, clientId });

    expect(await resolveMcpConnection({ clientId, userId: fixture.owner.id })).toBeNull();

    await recordConsent(clientId, fixture.owner.id);
    expect((await resolveMcpConnection({ clientId, userId: fixture.owner.id }))?.orgId).toBe(fixture.orgA);

    await revokeMcpConnection({ actor: fixture.owner, clientId });
  });

  it("undoes the binding it wrote when the caller abandons the consent", async () => {
    const clientId = `mcp-abandoned-${fixture.suffix}`;
    await registerOAuthClient(clientId);
    await bindMcpClientWorkspace({ actor: fixture.owner, orgId: fixture.orgA, clientId });
    await unbindMcpClientWorkspace({ actor: fixture.owner, orgId: fixture.orgA, clientId });

    expect(
      await integrationDb
        .select()
        .from(schema.mcpClientWorkspaces)
        .where(eq(schema.mcpClientWorkspaces.clientId, clientId)),
    ).toHaveLength(0);
  });

  it("refuses to re-point one member's connection at another member, instead of silently doing nothing", async () => {
    const clientId = `mcp-shared-${fixture.suffix}`;
    await registerOAuthClient(clientId);
    await bindMcpClientWorkspace({ actor: fixture.owner, orgId: fixture.orgA, clientId });

    await expect(
      bindMcpClientWorkspace({ actor: fixture.admin, orgId: fixture.orgA, clientId }),
    ).rejects.toThrow(/already connected by another member/i);

    const [row] = await integrationDb
      .select()
      .from(schema.mcpClientWorkspaces)
      .where(eq(schema.mcpClientWorkspaces.clientId, clientId));
    expect(row?.userId).toBe(fixture.owner.id);

    await revokeMcpConnection({ actor: fixture.owner, clientId });
  });

  it("names the real problem when a client is re-consented into a different workspace", async () => {
    const clientId = `mcp-rebind-${fixture.suffix}`;
    await registerOAuthClient(clientId);
    // The member must belong to *both* workspaces, otherwise `assertMember` would reject the second
    // bind first and this would pass without the pre-check ever running.
    await integrationDb
      .insert(schema.memberships)
      .values({ orgId: fixture.orgA, userId: fixture.outsider.id, orgRole: "developer" });
    try {
      await bindMcpClientWorkspace({ actor: fixture.outsider, orgId: fixture.orgB, clientId });
      await recordConsent(clientId, fixture.outsider.id);

      // `docs/integrations/companions-build.md` tells members to connect the app again for a second
      // workspace; a client that reuses its registered id lands here and deserves a usable message.
      await expect(
        bindMcpClientWorkspace({ actor: fixture.outsider, orgId: fixture.orgA, clientId }),
      ).rejects.toThrow(/already bound to another workspace/i);

      await revokeMcpConnection({ actor: fixture.outsider, clientId });
    } finally {
      await integrationDb
        .delete(schema.memberships)
        .where(
          and(
            eq(schema.memberships.orgId, fixture.orgA),
            eq(schema.memberships.userId, fixture.outsider.id),
          ),
        );
    }
  });

  it("stops resolving once the OAuth client is disabled", async () => {
    const clientId = `mcp-disabled-${fixture.suffix}`;
    await registerOAuthClient(clientId);
    await bindMcpClientWorkspace({ actor: fixture.owner, orgId: fixture.orgA, clientId });
    await recordConsent(clientId, fixture.owner.id);
    expect(await resolveMcpConnection({ clientId, userId: fixture.owner.id })).not.toBeNull();

    await integrationDb
      .update(schema.oauthApplication)
      .set({ disabled: true })
      .where(eq(schema.oauthApplication.clientId, clientId));

    expect(await resolveMcpConnection({ clientId, userId: fixture.owner.id })).toBeNull();

    await revokeMcpConnection({ actor: fixture.owner, clientId });
  });

  it("lists and revokes the caller's own connections, taking the OAuth client with it", async () => {
    const connections = await listMcpConnections({ actor: developer });
    expect(connections.map((entry) => entry.client_id)).toContain(developerClientId);
    expect(await listMcpConnections({ actor: fixture.outsider })).toHaveLength(0);

    expect(await revokeMcpConnection({ actor: fixture.owner, clientId: developerClientId })).toBe(false);
    expect(await revokeMcpConnection({ actor: developer, clientId: developerClientId })).toBe(true);

    const mappings = await integrationDb
      .select()
      .from(schema.mcpClientWorkspaces)
      .where(eq(schema.mcpClientWorkspaces.clientId, developerClientId));
    expect(mappings).toHaveLength(0);
    const clients = await integrationDb
      .select()
      .from(schema.oauthApplication)
      .where(eq(schema.oauthApplication.clientId, developerClientId));
    expect(clients).toHaveLength(0);
  });
});

describe("0187 MCP OAuth schema", () => {
  it("creates the OAuth tables, the tenant-scoped mapping with RLS, and the pre-tenant resolvers", async () => {
    const tables = await integrationSql<{ relname: string; relrowsecurity: boolean }[]>`
      select relname, relrowsecurity
      from pg_catalog.pg_class
      where relname in ('oauth_application', 'oauth_access_token', 'oauth_consent', 'mcp_client_workspaces')
        and relnamespace = 'public'::regnamespace
      order by relname
    `;
    expect(tables.map((row) => row.relname)).toEqual([
      "mcp_client_workspaces",
      "oauth_access_token",
      "oauth_application",
      "oauth_consent",
    ]);
    // Only the tenant-owned mapping carries RLS; the Better Auth identity tables are global, like
    // `user` and `session`, and are reached solely through the API role's unprotected-table grant.
    expect(tables.find((row) => row.relname === "mcp_client_workspaces")?.relrowsecurity).toBe(true);
    expect(tables.filter((row) => row.relname.startsWith("oauth_")).every((row) => !row.relrowsecurity)).toBe(true);

    const functions = await integrationSql<{ proname: string }[]>`
      select proname from pg_catalog.pg_proc
      where proname in (
        'companion_resolve_mcp_connection',
        'companion_list_mcp_connections',
        'companion_revoke_mcp_connection'
      )
      order by proname
    `;
    expect(functions.map((row) => row.proname)).toEqual([
      "companion_list_mcp_connections",
      "companion_resolve_mcp_connection",
      "companion_revoke_mcp_connection",
    ]);
  });

  it("cascades an access token and its workspace mapping away with the client", async () => {
    const clientId = `mcp-cascade-${fixture.suffix}`;
    await registerOAuthClient(clientId);
    await integrationDb.insert(schema.oauthAccessToken).values({
      id: randomUUID(),
      accessToken: `access-${clientId}`,
      refreshToken: `refresh-${clientId}`,
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60_000),
      refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
      clientId,
      userId: fixture.owner.id,
      scopes: "openid offline_access",
    });
    await bindMcpClientWorkspace({ actor: fixture.owner, orgId: fixture.orgA, clientId });
    await recordConsent(clientId, fixture.owner.id);

    expect(await revokeMcpConnection({ actor: fixture.owner, clientId })).toBe(true);
    expect(
      await integrationDb
        .select()
        .from(schema.oauthAccessToken)
        .where(eq(schema.oauthAccessToken.clientId, clientId)),
    ).toHaveLength(0);
    expect(
      await integrationDb
        .select()
        .from(schema.mcpClientWorkspaces)
        .where(eq(schema.mcpClientWorkspaces.clientId, clientId)),
    ).toHaveLength(0);
  });
});
