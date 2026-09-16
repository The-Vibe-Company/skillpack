import { and, eq } from "drizzle-orm";
import { db, schema, withTenantContext, type Db } from "@skillpack/db";
import {
  listPreTenantMcpConnections,
  resolvePreTenantMcpConnection,
  revokePreTenantMcpConnection,
} from "./preTenant";
import { assertMember, ensureUserBootstrap, type ActorContext } from "./services";

/**
 * MCP connections are session-equivalent, not capability-scoped. A connected client acts with the
 * consenting member's own rights, inside exactly the one workspace chosen on the consent screen.
 * Everything below either proves that binding or manages it; no tool ever selects its own workspace.
 */
export interface McpConnection {
  actor: ActorContext;
  orgId: string;
  clientId: string;
}

/** Resolve an authenticated MCP client to the member and workspace it may act as. */
export async function resolveMcpConnection(input: {
  clientId: string;
  userId: string;
  database?: Db;
}): Promise<McpConnection | null> {
  const database = input.database ?? db;
  const resolved = await resolvePreTenantMcpConnection(database, {
    clientId: input.clientId,
    userId: input.userId,
  });
  if (!resolved) return null;
  const actor: ActorContext = {
    id: resolved.userId,
    email: resolved.email,
    name: resolved.name || resolved.email,
  };
  await ensureUserBootstrap(actor, database);
  return { actor, orgId: resolved.orgId, clientId: input.clientId };
}

/**
 * Record the workspace one MCP client was consented into. Runs inside the chosen tenant context
 * after `assertMember`, so the RLS policy and the membership check agree on the same organization.
 */
export async function bindMcpClientWorkspace(input: {
  actor: ActorContext;
  orgId: string;
  clientId: string;
}): Promise<void> {
  // A binding in another organization is invisible inside the tenant transaction below, so the
  // upsert there could only fail obscurely. The reconnect path documented for reaching a second
  // workspace runs straight into this when a client reuses its registered id, so name it first.
  const existing = await resolvePreTenantMcpConnection(db, {
    clientId: input.clientId,
    userId: input.actor.id,
  });
  if (existing && existing.orgId !== input.orgId) {
    throw new Error(
      "this connection is already bound to another workspace; revoke it first, or connect again as a new client",
    );
  }
  await withTenantContext({ orgId: input.orgId, userId: input.actor.id }, async (database) => {
    await assertMember(database, input.actor, input.orgId);
    // `setWhere` keeps one member from re-pointing another member's connection. PostgreSQL treats a
    // failed DO UPDATE predicate as "nothing happened" rather than an error, so read the row back:
    // reporting a successful connection that no token can ever resolve is worse than refusing it.
    const [bound] = await database
      .insert(schema.mcpClientWorkspaces)
      .values({ clientId: input.clientId, orgId: input.orgId, userId: input.actor.id })
      .onConflictDoUpdate({
        target: schema.mcpClientWorkspaces.clientId,
        set: { orgId: input.orgId, userId: input.actor.id, updatedAt: new Date() },
        setWhere: eq(schema.mcpClientWorkspaces.userId, input.actor.id),
      })
      .returning({ clientId: schema.mcpClientWorkspaces.clientId });
    if (!bound) {
      throw new Error("this client is already connected by another member; start a new connection");
    }
  });
}

/**
 * Undo a workspace binding that its grant never got. The mapping is authorization state, so it must
 * not outlive a consent attempt that failed: an orphan row is a standing workspace binding for a
 * client the member never finished approving.
 */
export async function unbindMcpClientWorkspace(input: {
  actor: ActorContext;
  orgId: string;
  clientId: string;
}): Promise<void> {
  await withTenantContext({ orgId: input.orgId, userId: input.actor.id }, async (database) => {
    await database
      .delete(schema.mcpClientWorkspaces)
      .where(
        and(
          eq(schema.mcpClientWorkspaces.clientId, input.clientId),
          eq(schema.mcpClientWorkspaces.userId, input.actor.id),
        ),
      );
  });
}

export interface McpConnectionSummary {
  client_id: string;
  client_name: string;
  org_id: string;
  org_name: string;
  created_at: string;
  last_token_issued_at: string | null;
}

function isoTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

/** Every MCP connection the caller has consented to, across all of their workspaces. */
export async function listMcpConnections(input: {
  actor: ActorContext;
  database?: Db;
}): Promise<McpConnectionSummary[]> {
  const rows = await listPreTenantMcpConnections(input.database ?? db, input.actor.id);
  return rows.map((row) => ({
    client_id: row.clientId,
    client_name: row.clientName,
    org_id: row.orgId,
    org_name: row.orgName,
    created_at: isoTimestamp(row.createdAt),
    last_token_issued_at: row.lastTokenIssuedAt ? isoTimestamp(row.lastTokenIssuedAt) : null,
  }));
}

/** Revoke one of the caller's own MCP connections: the client, its tokens and its mapping all go. */
export async function revokeMcpConnection(input: {
  actor: ActorContext;
  clientId: string;
  database?: Db;
}): Promise<boolean> {
  return revokePreTenantMcpConnection(input.database ?? db, {
    clientId: input.clientId,
    userId: input.actor.id,
  });
}
