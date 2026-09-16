import { z } from "zod";
import { getMcpTokenSession, type McpTokenSession } from "@skillpack/auth";
import { resolveMcpConnection, type McpConnection } from "@skillpack/core/services";

/**
 * The two lookups one MCP request depends on, injected so the boundary can be exercised without a
 * live Better Auth instance or database.
 */
export interface McpAuthenticationDependencies {
  readTokenSession: (headers: Headers) => Promise<McpTokenSession | null>;
  resolveConnection: (input: { clientId: string; userId: string }) => Promise<McpConnection | null>;
}

const liveDependencies: McpAuthenticationDependencies = {
  readTokenSession: (headers) => getMcpTokenSession(headers),
  resolveConnection: (input) => resolveMcpConnection(input),
};

/**
 * Authenticate one MCP request.
 *
 * Better Auth verifies the bearer access token and reports which client and which Better Auth user
 * it belongs to. Everything that decides *what the request may touch* comes from Skillpack: the
 * consented workspace mapping, and the member's current membership of it. There are no Agent Auth
 * capabilities and no PAT scopes here — a connection acts with the member's own rights, so the only
 * authorization questions are "is this still that member" and "are they still in that workspace".
 */
export async function authenticateMcpRequest(
  headers: Headers,
  dependencies: McpAuthenticationDependencies = liveDependencies,
): Promise<McpConnection | null> {
  const session = await dependencies.readTokenSession(headers);
  if (!session) return null;
  return dependencies.resolveConnection({ clientId: session.clientId, userId: session.userId });
}

/**
 * Two Better Auth endpoints the `mcp` plugin mounts are deliberately not part of this product's
 * published surface, and both would undercut the workspace binding if they were reachable:
 *
 * - `/auth/mcp/get-session` returns the stored token row verbatim, so a leaked one-hour access
 *   token could be traded for the thirty-day refresh token. `getMcpTokenSession` reads the same
 *   data in-process and narrows it, so nothing here needs the HTTP route.
 * - `/auth/oauth2/consent` approves a grant without binding a workspace, and upstream only
 *   requires *a* session — it never checks that the session user owns the pending authorization.
 *   `POST /v1/mcp/consent` adds both checks and is the only approval path.
 */
const UNPUBLISHED_AUTH_PATHS: ReadonlySet<string> = new Set(["/auth/mcp/get-session", "/auth/oauth2/consent"]);

/**
 * Force `prompt=consent` on every MCP authorization request.
 *
 * The consent screen is where the member chooses the one workspace a connection may act in, so it
 * is not optional. Better Auth only routes to it when the *client* asks for it: without the
 * parameter the authorize endpoint returns an authorization code immediately, with no consent and
 * no workspace binding. Dynamic client registration is open, as MCP requires, so the client is
 * exactly the party that must not be trusted to ask. Normalize the parameter here instead.
 *
 * The rewrite is unconditional. Reading the current value first would be a bypass: `get` returns
 * only the first of a repeated parameter, while the router downstream collapses repeats into an
 * array that matches neither of the plugin's string comparisons — so `?prompt=consent&prompt=none`
 * would pass a "already asks for consent" check and then skip the consent screen anyway. `set`
 * replaces every occurrence, so there is nothing to compare against.
 */
export function forceMcpConsentPrompt(request: Request): Request {
  if (request.method !== "GET") return request;
  const url = new URL(request.url);
  if (url.pathname !== "/auth/mcp/authorize") return request;
  url.searchParams.set("prompt", "consent");
  return new Request(url, request);
}

/** True for a Better Auth endpoint this product deliberately does not publish. */
export function isUnpublishedAuthPath(pathname: string): boolean {
  return UNPUBLISHED_AUTH_PATHS.has(pathname);
}

/** The RFC 9728 challenge that points an MCP client at this instance's protected-resource metadata. */
export function mcpAuthenticateChallenge(origin: string): string {
  return `Bearer resource_metadata="${new URL("/auth/.well-known/oauth-protected-resource", origin).toString()}"`;
}

/**
 * Body of `POST /v1/mcp/consent`. The workspace is part of the decision, not a later setting: one
 * consented MCP client acts in exactly one organization, chosen here by the signed-in member.
 */
export const mcpConsentInputSchema = z.object({
  consent_code: z.string().trim().min(1).max(200),
  accept: z.boolean(),
  workspace_id: z.string().uuid(),
});
export type McpConsentInput = z.infer<typeof mcpConsentInputSchema>;
