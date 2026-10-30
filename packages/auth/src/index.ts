/* oxlint-disable anti-slop/no-unknown-returns, anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-unsafe-dictionary-type -- Better Auth's existing inferred Agent Auth plugin boundary exposes private and unknown response types; the stable public facade below predates the incremental anti-slop gate. */
import { betterAuth } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { emailOTP, jwt } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";
import { getOAuthProviderApi, verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { agentAuth, type AgentSession } from "@better-auth/agent-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import * as z from "zod";
import { db, schema } from "@skillpack/db";
import { passwordResetCodeEmail, sendTransactionalEmail, verificationCodeEmail } from "@skillpack/email";
import {
  AGENT_AUTH_CAPABILITIES,
  authorizeAgentOperation,
  capabilityForAgentOperation,
  emitAgentAuthEvent,
  executeAgentCapability,
  type AgentTenantCapability,
} from "./agent-auth";
import { postgresAgentAuthStorage } from "./postgres-secondary-storage";
import { betterAuthIpAddressHeaders } from "./ip-address";
import {
  authorizationUsesRemoteAgentJwks,
  canonicalAgentAuthHeaders,
  canonicalizeAgentAuthRequest,
  guardAgentAuthRemoteKeys,
} from "./agent-auth-origin";

export * from "./agent-auth";
export * from "./agent-auth-origin";
export { postgresAgentAuthStorage } from "./postgres-secondary-storage";

export const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 30;
export const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24;
/** A valid rolling browser session is sufficient to approve Agent Auth capabilities. */
export const AGENT_AUTH_FRESH_SESSION_WINDOW_SECONDS = 0;

export function getBetterAuthSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret && process.env.NODE_ENV !== "production") {
    return "local-dev-only-better-auth-secret-change-in-production";
  }
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required");
  return secret;
}

/**
 * Google OAuth is opt-in: the "Continue with Google" button always renders, but the social provider is
 * only wired when both credentials are present. Without them, the web `/v1/auth/google` route returns a
 * friendly "unavailable" error instead of the config throwing at boot.
 */
function googleSocialProvider() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return {};
  return { google: { clientId, clientSecret } };
}

function trustedOrigins(): string[] {
  const webUrl = process.env.COMPANION_WEB_URL;
  const authUrl = process.env.BETTER_AUTH_URL;
  const apiUrl = process.env.COMPANION_API_URL;
  const devLoopbackOrigins =
    process.env.NODE_ENV === "production" ? [] : ["http://127.0.0.1:*", "http://localhost:*", "http://[::1]:*"];

  return Array.from(
    new Set(
      [
        webUrl,
        webUrl?.replace("127.0.0.1", "localhost"),
        authUrl,
        authUrl?.replace("127.0.0.1", "localhost"),
        apiUrl,
        apiUrl?.replace("127.0.0.1", "localhost"),
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        "http://127.0.0.1:3001",
        "http://localhost:3001",
        "http://127.0.0.1:3010",
        "http://localhost:3010",
        ...devLoopbackOrigins,
      ].filter((origin): origin is string => Boolean(origin)),
    ),
  );
}

function agentDeviceAuthorizationPage(): string {
  const webBase = process.env.COMPANION_WEB_URL ?? "http://127.0.0.1:3000";
  return new URL("/device/capabilities", webBase).toString();
}

const MCP_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const MCP_REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * The public origin this instance advertises for OAuth and MCP. Better Auth derives its issuer,
 * authorization/token/registration endpoints and `authorization_servers` entry from `BETTER_AUTH_URL`,
 * so the MCP resource identifier must be built from the same origin or discovery cannot agree with
 * itself. A deployment that serves the web app and API on one origin (the `/auth/*` and `/mcp`
 * rewrites in `apps/web/next.config.ts`) therefore sets `BETTER_AUTH_URL` to that public origin.
 */
export function publicInstanceOrigin(): string {
  const configured = process.env.BETTER_AUTH_URL ?? process.env.COMPANION_API_URL ?? "http://127.0.0.1:3001";
  return new URL(configured).origin;
}

/** The exact MCP resource identifier: the URL companions.build (and any MCP client) pins. */
export function mcpResourceUrl(): string {
  return new URL("/mcp", publicInstanceOrigin()).toString();
}

function mcpWebPage(path: string): string {
  const webBase = process.env.COMPANION_WEB_URL ?? "http://127.0.0.1:3000";
  return new URL(path, webBase).toString();
}

/**
 * OAuth 2.1 authorization server for MCP clients. Unlike Agent Auth (60-second JWTs, one capability
 * per request, device approval) an MCP connection is a long-lived delegated grant that acts with the
 * connecting member's own rights inside one consented workspace. `prompt=consent` is what routes the
 * browser to `/mcp/consent`, where that workspace is chosen and recorded.
 */
export const skillpackMcpPlugin: ReturnType<typeof mcp> = mcp({
  loginPage: mcpWebPage("/mcp/login"),
  consentPage: mcpWebPage("/mcp/consent"),
  resource: mcpResourceUrl(),
  allowDynamicClientRegistration: true,
  allowUnauthenticatedClientRegistration: true,
  // Global resource policy is operator configuration, never a tenant member's authority.
  resourcePrivileges: () => false,
  clientPrivileges: ({ action }) => action === "create",
  grantTypes: ["authorization_code", "refresh_token"],
  clientRegistrationDefaultScopes: ["openid", "profile", "email", "offline_access"],
  clientRegistrationAllowedScopes: ["openid", "profile", "email", "offline_access"],
  clientRegistrationAllowedResources: [mcpResourceUrl()],
  // The instance exposes one MCP resource. Existing 1.6 clients have no resource linkage yet.
  enforcePerClientResources: false,
  refreshTokenReuseInterval: 0,
  accessTokenExpiresIn: MCP_ACCESS_TOKEN_TTL_SECONDS,
  refreshTokenExpiresIn: MCP_REFRESH_TOKEN_TTL_SECONDS,
});

export const skillpackAgentAuthPlugin: ReturnType<typeof agentAuth> = agentAuth({
  providerName: "Skillpack",
  providerDescription: "Deploy, govern, and install organization skills through narrowly delegated capabilities.",
  modes: ["delegated"],
  capabilities: [...AGENT_AUTH_CAPABILITIES],
  validateCapabilities: (requested) =>
    requested.every((name) => AGENT_AUTH_CAPABILITIES.some((capability) => capability.name === name)),
  requireAuthForCapabilities: false,
  approvalMethods: ["device_authorization"],
  resolveApprovalMethod: () => "device_authorization",
  deviceAuthorizationPage: agentDeviceAuthorizationPage(),
  // Dynamic host registration remains enabled, but only with inline public JWKs. Agent Auth
  // 0.6.2 fetches remote JWKS URLs before signature verification, so both this callback and the
  // outer request guard reject that transport before the plugin can perform network I/O.
  allowDynamicHostRegistration: (ctx) =>
    !authorizationUsesRemoteAgentJwks(ctx.headers?.get("authorization")),
  defaultHostCapabilities: [],
  jwtMaxAge: 60,
  // Better Auth already rejects missing or expired browser sessions. Do not layer a recent-login
  // requirement on top: an active rolling session remains valid for device approval.
  freshSessionWindow: AGENT_AUTH_FRESH_SESSION_WINDOW_SECONDS,
  // Agent records and grants persist until explicit revocation. Every
  // request still uses a one-minute JWT and consumes its JTI exactly once.
  agentSessionTTL: 0,
  agentMaxLifetime: 0,
  absoluteLifetime: 0,
  resolveGrantTTL: () => null,
  jtiCacheStorage: "secondary-storage",
  jwksCacheStorage: "secondary-storage",
  dangerouslySkipJtiCheck: false,
  // Agent Auth 0.6.2 adds the request Host to accepted JWT audiences when proxy trust is enabled.
  // The exported handler canonicalizes Agent Auth origin headers instead, so the plugin only
  // evaluates the configured public origin.
  trustProxy: false,
  async onExecute({ capability, arguments: args, agentSession, grant }) {
    return executeAgentCapability({ capability, arguments: args, session: agentSession, grant });
  },
  onEvent: emitAgentAuthEvent,
});

// Server-only endpoint gives the provider a complete Better Auth endpoint context without
// publishing token introspection or accepting unverified JWT payloads at the MCP boundary.
const skillpackMcpVerificationPlugin = {
  id: "skillpack-mcp-verification",
  endpoints: {
    verifySkillpackMcpAccessToken: createAuthEndpoint.serverOnly({
      method: "POST",
      body: z.object({ token: z.string().min(1) }),
    }, async (context) => getOAuthProviderApi(context, skillpackMcpPlugin.options)
      .requireActiveAccessToken(context.body.token)),
  },
};

const configuredAuth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? process.env.COMPANION_API_URL ?? "http://127.0.0.1:3001",
  basePath: "/auth",
  secret: getBetterAuthSecret(),
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  secondaryStorage: postgresAgentAuthStorage,
  // Keep rate limits enabled in every environment. Secondary storage makes
  // the counters process-independent and durable enough for fixed windows.
  rateLimit: {
    enabled: true,
    storage: "secondary-storage",
  },
  emailAndPassword: {
    enabled: true,
    // Email signups must confirm a 6-digit OTP (emailOTP plugin) before they get a session.
    requireEmailVerification: true,
  },
  verification: {
    // Authorization codes and replay tombstones must remain durable alongside the provider's
    // database-backed sessions and refresh grants, even when secondary storage is configured.
    storeInDatabase: true,
  },
  emailVerification: {
    // After /email-otp/verify-email succeeds, create the session so the user lands logged in.
    autoSignInAfterVerification: true,
    // An unverified sign-in re-sends a fresh OTP so the UI can route straight to the verify screen.
    sendOnSignIn: true,
  },
  socialProviders: googleSocialProvider(),
  session: {
    storeSessionInDatabase: true,
    // Keep active devices signed in for 30 days. Better Auth refreshes the database expiry and
    // session-token cookie at most once per day; the API middleware forwards that Set-Cookie to
    // browser-facing responses so this remains a true rolling window.
    expiresIn: SESSION_EXPIRES_IN_SECONDS,
    updateAge: SESSION_UPDATE_AGE_SECONDS,
  },
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 600, // seconds (10 minutes)
      // Take over email verification so confirmation uses a 6-digit code (not a magic link).
      overrideDefaultEmailVerification: true,
      async sendVerificationOTP({ email, otp, type }) {
        // `type` is "email-verification" (signup / verify / unverified sign-in) or
        // "forget-password" (password reset). Both delivered via the shared email sender (Resend in prod).
        const mail =
          type === "forget-password"
            ? passwordResetCodeEmail({ to: email, code: otp })
            : verificationCodeEmail({ to: email, code: otp });
        await sendTransactionalEmail(mail);
      },
    }),
    skillpackAgentAuthPlugin,
    jwt(),
    skillpackMcpPlugin,
    skillpackMcpVerificationPlugin,
  ],
  advanced: {
    // Railway's public edge sets a single X-Real-IP. Do not trust arbitrary forwarded
    // chains or vendor headers on the publicly reachable API (see deploy/railway/README.md).
    ipAddress: { ipAddressHeaders: betterAuthIpAddressHeaders() },
    cookiePrefix: process.env.BETTER_AUTH_COOKIE_PREFIX ?? "better-auth",
    database: {
      generateId: () => crypto.randomUUID(),
    },
    defaultCookieAttributes: {
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  },
  trustedOrigins: trustedOrigins(),
});

// Export the stable Better Auth surface. The Agent Auth package currently
// leaks a private `BatchResponseItem` from its inferred plugin type; narrowing
// the public value avoids generating a declaration that depends on that
// private symbol while the dedicated helpers below retain Agent Auth typing.
interface PublicAuth {
  handler: (request: Request) => Promise<Response>;
  api: {
    getSession: (input: {
      headers: Headers;
      query?: { disableRefresh?: boolean };
      returnHeaders?: boolean;
    }) => Promise<unknown>;
    updateUser: (input: {
      headers: Headers;
      body: { name?: string; image?: string | null };
    }) => Promise<unknown>;
  };
  $Infer: {
    Session: {
      user: {
        id: string;
        name: string;
        email: string;
        emailVerified: boolean;
        image?: string | null;
        createdAt: Date;
        updatedAt: Date;
      };
      session: {
        id: string;
        userId: string;
        token: string;
        expiresAt: Date;
        ipAddress?: string | null;
        userAgent?: string | null;
        createdAt: Date;
        updatedAt: Date;
      };
    };
  };
}

const publicConfiguredAuth = configuredAuth as unknown as PublicAuth;

/** 1.6 did not persist confidential clients' chosen secret transport; preserve both legacy forms. */
async function normalizeMcpTokenRequest(request: Request, url: URL, headers: Headers): Promise<Request | Response> {
  const reader = request.clone().body?.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  if (reader) while (true) {
    const { done, value } = await reader.read();
    if (done) { text += decoder.decode(); break; }
    bytes += value.byteLength;
    if (bytes > 64 * 1024) {
      await reader.cancel().catch(() => undefined);
      return Response.json({ error: "request_too_large" }, { status: 413 });
    }
    text += decoder.decode(value, { stream: true });
  }
  const form = new URLSearchParams(text);
  if (!form.has("resource")) form.set("resource", mcpResourceUrl());
  const clientId = form.get("client_id");
  const clientSecret = form.get("client_secret");
  if (!headers.has("authorization") && clientId && clientSecret
    && form.getAll("client_id").length === 1 && form.getAll("client_secret").length === 1) {
    const [client] = await db.select({ referenceId: schema.oauthClient.referenceId })
      .from(schema.oauthClient).where(eq(schema.oauthClient.clientId, clientId)).limit(1);
    // DCR cannot set reference_id. This private marker is written only by migration 0198.
    if (client?.referenceId === "skillpack:mcp-1.6-confidential") {
      headers.set("authorization", `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString("base64")}`);
      form.delete("client_secret");
      form.delete("client_id");
    }
  }
  headers.delete("content-length");
  return new Request(url, { method: "POST", headers, body: form.toString() });
}

/** Retain published 1.6 endpoint URLs while discovery advertises the provider's 1.7 routes. */
async function canonicalizeMcpRequest(request: Request): Promise<Request | Response> {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.pathname = url.pathname.replace(/^\/auth\/mcp\/(authorize|token|register)$/, "/auth/oauth2/$1");
  if (url.pathname === "/auth/oauth2/consent" || url.pathname === "/auth/mcp/get-session") {
    return Response.json({ error: "Not Found" }, { status: 404 });
  }
  if (url.pathname.startsWith("/auth/admin/oauth2")
    || (url.pathname.startsWith("/auth/oauth2/")
      && !["/auth/oauth2/authorize", "/auth/oauth2/token", "/auth/oauth2/register",
        "/auth/oauth2/userinfo", "/auth/oauth2/introspect", "/auth/oauth2/revoke",
        "/auth/oauth2/end-session", "/auth/oauth2/end-session/confirm"].includes(url.pathname))) {
    return Response.json({ error: "Not Found" }, { status: 404 });
  }
  const isAuthorize = url.pathname === "/auth/oauth2/authorize";
  if (isAuthorize && request.method !== "GET") return new Response(null, { status: 405, headers: { allow: "GET" } });
  if (isAuthorize) {
    url.searchParams.set("prompt", "consent");
    if (!url.searchParams.has("resource")) url.searchParams.set("resource", mcpResourceUrl());
  }
  // OAuth provider redirects and proof validation must observe the canonical public origin.
  if (!url.pathname.startsWith("/auth/oauth2/") && !url.pathname.includes("/.well-known/")) return request;
  if (url.pathname === "/.well-known/oauth-authorization-server") url.pathname = "/auth/.well-known/oauth-authorization-server";
  if (url.pathname === "/auth/.well-known/oauth-protected-resource") url.pathname = "/.well-known/oauth-protected-resource";
  const publicUrl = new URL(url.pathname + url.search, publicInstanceOrigin());
  const headers = new Headers(request.headers);
  headers.set("host", publicUrl.host);
  headers.set("x-forwarded-host", publicUrl.host);
  headers.set("x-forwarded-proto", publicUrl.protocol.slice(0, -1));
  if (url.pathname === "/auth/oauth2/token" && request.method === "POST"
    && headers.get("content-type")?.split(";")[0]?.trim() === "application/x-www-form-urlencoded") {
    return normalizeMcpTokenRequest(request, publicUrl, headers);
  }
  return new Request(new Request(publicUrl, request), { headers });
}

async function hardenedAuthHandler(request: Request): Promise<Response> {
  const remoteKeyGuard = await guardAgentAuthRemoteKeys(request);
  if (remoteKeyGuard !== "allowed") {
    return Response.json(
      remoteKeyGuard === "remote-jwks"
        ? {
            error: "remote_agent_jwks_disabled",
            message: "Agent Auth hosts and agents must register with inline public keys.",
          }
        : {
            error: "agent_auth_request_too_large",
            message: "Agent Auth host requests must be 64 KiB or smaller.",
          },
      { status: remoteKeyGuard === "remote-jwks" ? 400 : 413 },
    );
  }
  const canonical = canonicalizeAgentAuthRequest(request);
  if (!canonical) {
    return Response.json(
      {
        error: "invalid_agent_auth_origin",
        message: "Agent Auth requests must use the configured public origin.",
      },
      { status: 400 },
    );
  }
  const oauthRequest = await canonicalizeMcpRequest(canonical);
  if (oauthRequest instanceof Response) return oauthRequest;
  return bindMcpConsentRedirect(await configuredAuth.handler(oauthRequest), oauthRequest);
}

export const auth: PublicAuth = {
  handler: hardenedAuthHandler,
  api: publicConfiguredAuth.api,
  $Infer: publicConfiguredAuth.$Infer,
};

export type Auth = typeof auth;
export type AuthSession = typeof auth.$Infer.Session;

/** Root discovery payload served outside Better Auth's `/auth` base path. */
export async function getAgentConfiguration(): Promise<Record<string, unknown>> {
  return configuredAuth.api.getAgentConfiguration() as Promise<Record<string, unknown>>;
}

export async function listConnectedAgents(headers: Headers): Promise<unknown> {
  return configuredAuth.api.listAgents({ headers, query: { limit: 100, offset: 0 } });
}

export async function approveAgentCapabilities(input: {
  headers: Headers;
  agentId: string;
  approvalId: string;
  userCode: string;
  capabilities?: string[];
}): Promise<unknown> {
  return configuredAuth.api.approveCapability({
    headers: input.headers,
    body: {
      approval_id: input.approvalId,
      user_code: input.userCode,
      action: "approve",
      capabilities: input.capabilities,
    },
  });
}

export async function denyAgentCapabilities(input: {
  headers: Headers;
  agentId: string;
  approvalId: string;
  reason?: string;
}): Promise<unknown> {
  return configuredAuth.api.approveCapability({
    headers: input.headers,
    body: {
      approval_id: input.approvalId,
      action: "deny",
      reason: input.reason,
    },
  });
}

export async function revokeConnectedAgent(headers: Headers, agentId: string): Promise<unknown> {
  return configuredAuth.api.revokeAgent({ headers, body: { agent_id: agentId } });
}

export async function revokeConnectedHost(headers: Headers, hostId: string): Promise<unknown> {
  return configuredAuth.api.revokeHost({ headers, body: { host_id: hostId } });
}

export async function revokeConnectedCapability(input: {
  headers: Headers;
  agentId: string;
  capability: string;
}): Promise<unknown> {
  return configuredAuth.api.revokeCapability({
    headers: input.headers,
    body: { agent_id: input.agentId, capabilities: [input.capability] },
  });
}

/** One live MCP access token, resolved from a bearer credential. */
export interface McpTokenSession {
  userId: string;
  clientId: string;
  scopes: string[];
}

/** Validate through the provider in-process, including signature, expiry, client and session revocation. */
export async function getMcpTokenSession(headers: Headers): Promise<McpTokenSession | null> {
  const authorization = headers.get("authorization");
  const match = /^Bearer ([^\s]+)$/i.exec(authorization ?? "");
  if (!match) return null;
  try {
    const claims = await configuredAuth.api.verifySkillpackMcpAccessToken({ body: { token: match[1]! } });
    const parsed = z.object({
      sub: z.string().min(1), azp: z.string().min(1), exp: z.number(),
      scope: z.string().default(""), aud: z.union([z.string().transform((value) => [value]), z.array(z.string())]).optional(),
      cnf: z.unknown().optional(),
    }).safeParse(claims);
    if (!parsed.success || parsed.data.exp * 1000 <= Date.now() || parsed.data.cnf) return null;
    const audiences = parsed.data.aud;
    if (audiences && !audiences.includes(mcpResourceUrl())) return null;
    // Only migrated opaque tokens can lack an audience. New authorization always pins /mcp.
    if (!audiences && match[1]!.includes(".")) return null;
    return { userId: parsed.data.sub, clientId: parsed.data.azp, scopes: parsed.data.scope.split(" ").filter(Boolean) };
  } catch {
    return null;
  }
}

/** The pending authorization behind one consent code, read before the decision is recorded. */
export interface McpPendingAuthorization {
  clientId: string;
  userId: string;
  scopes: string[];
  clientName: string | null;
  /**
   * Origin of the redirect URI the authorization code would be sent to. A client name comes from
   * unauthenticated dynamic registration, so anyone can register "Skillpack (official)"; the
   * redirect target is the field that actually distinguishes one client from an impostor.
   */
  redirectOrigin: string | null;
}

const storedMcpAuthorizationSchema = z.object({
  userId: z.string().min(1),
  sessionId: z.string().min(1),
  oauthQuery: z.string().min(1),
});

async function readMcpConsentTicket(consentCode: string) {
  if (!/^[a-f0-9-]{36}$/.test(consentCode)) return null;
  const stored = await postgresAgentAuthStorage.get(`mcp-consent:${consentCode}`);
  if (!stored) return null;
  try {
    const parsed = storedMcpAuthorizationSchema.safeParse(JSON.parse(stored));
    if (!parsed.success || !await verifyOAuthQueryParams(parsed.data.oauthQuery, getBetterAuthSecret())) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/** The opaque ticket binds the provider's signed query to the member and browser session. */
export async function getMcpPendingAuthorization(consentCode: string): Promise<McpPendingAuthorization | null> {
  const ticket = await readMcpConsentTicket(consentCode);
  if (!ticket) return null;
  const query = new URLSearchParams(ticket.oauthQuery);
  const clientId = query.get("client_id");
  if (!clientId) return null;
  const [client] = await db.select({ name: schema.oauthClient.name, disabled: schema.oauthClient.disabled })
    .from(schema.oauthClient).where(eq(schema.oauthClient.clientId, clientId)).limit(1);
  if (!client || client.disabled) return null;
  return {
    clientId, userId: ticket.userId,
    scopes: (query.get("scope") ?? "").split(" ").filter(Boolean),
    clientName: client.name || null, redirectOrigin: safeOrigin(query.get("redirect_uri") ?? ""),
  };
}

/** Replace a provider consent redirect with a short-lived, session-owned, single-use ticket. */
async function bindMcpConsentRedirect(response: Response, request: Request): Promise<Response> {
  const location = response.headers.get("location");
  let body: { redirect?: boolean; url?: string } | undefined;
  if (!location && response.headers.get("content-type")?.includes("application/json")) {
    try { body = z.object({ redirect: z.boolean().optional(), url: z.string().optional() }).parse(await response.clone().json()); } catch { return response; }
  }
  const target = location ?? body?.url;
  if (!target) return response;
  const url = new URL(target, publicInstanceOrigin());
  if (url.origin !== new URL(mcpWebPage("/mcp/consent")).origin || url.pathname !== "/mcp/consent") return response;
  const oauthQuery = url.search.slice(1);
  if (!await verifyOAuthQueryParams(oauthQuery, getBetterAuthSecret())) {
    return Response.json({ error: "invalid_consent_request" }, { status: 400 });
  }
  const session = await configuredAuth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "invalid_consent_session" }, { status: 401 });
  const code = crypto.randomUUID();
  const ttl = Math.min(600, Number(url.searchParams.get("exp")) - Math.floor(Date.now() / 1000));
  if (!Number.isFinite(ttl) || ttl <= 0) return Response.json({ error: "expired_consent_request" }, { status: 400 });
  await postgresAgentAuthStorage.set(`mcp-consent:${code}`, JSON.stringify({
    userId: session.user.id, sessionId: session.session.id, oauthQuery,
  }), ttl);
  url.search = new URLSearchParams({ consent_code: code }).toString();
  const headers = new Headers(response.headers);
  if (location) {
    headers.set("location", url.toString());
    return new Response(response.body, { status: response.status, headers });
  }
  headers.delete("content-length");
  return Response.json({ ...body, url: url.toString() }, { status: response.status, headers });
}

/** The origin of a stored redirect URI, or null when it is not a URL this screen should echo. */
function safeOrigin(redirectUri: string): string | null {
  try {
    const parsed = new URL(redirectUri);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** Consume the session-owned consent ticket before asking the provider to issue a code. */
export async function decideMcpConsent(input: {
  headers: Headers; accept: boolean; consentCode: string;
  beforeApprove?: () => Promise<void>;
}): Promise<{ redirectURI: string }> {
  const ticket = await readMcpConsentTicket(input.consentCode);
  const session = await configuredAuth.api.getSession({ headers: input.headers });
  if (!ticket || !session || ticket.userId !== session.user.id || ticket.sessionId !== session.session.id) {
    throw new Error("this authorization request belongs to a different or expired session");
  }
  const consumed = await postgresAgentAuthStorage.getAndDelete(`mcp-consent:${input.consentCode}`);
  if (!consumed) throw new Error("this authorization request has already been decided");
  if (input.accept) await input.beforeApprove?.();
  const result = await configuredAuth.api.oauth2Consent({
    asResponse: false,
    headers: input.headers, body: { accept: input.accept, oauth_query: ticket.oauthQuery },
    request: new Request(new URL("/auth/oauth2/consent", publicInstanceOrigin()), { method: "POST", headers: input.headers }),
  });
  const parsed = z.object({ url: z.string().min(1) }).safeParse(result);
  if (!parsed.success) throw new Error("the authorization server did not return a redirect target");
  return { redirectURI: new URL(parsed.data.url, publicInstanceOrigin()).toString() };
}

export interface AuthenticatedAgentRequest {
  session: AgentSession;
  actor: {
    id: string;
    email: string;
    name: string;
  };
  workspaceId: string;
  capability: AgentTenantCapability;
}

/**
 * Validate a short-lived Agent Auth JWT for one closed REST operation.
 * Signature, audience, expiry, revocation and replay are handled by the
 * plugin; this layer additionally enforces the exact workspace grant.
 */
export async function authenticateAgentRequest(input: {
  headers: Headers;
  method: string;
  pathname: string;
  workspaceId: string | null;
}): Promise<AuthenticatedAgentRequest | null> {
  // A JTI is one-use. Reject non-registry requests before invoking the plugin
  // so this middleware never consumes a JWT intended for Better Auth's own
  // `/auth/capability/execute` endpoint (or any unrelated route).
  if (!input.workspaceId || !capabilityForAgentOperation(input.method, input.pathname)) return null;
  const headers = canonicalAgentAuthHeaders(input.headers);
  if (!headers) return null;
  let session: AgentSession | null;
  try {
    session = await configuredAuth.api.getAgentSession({ headers });
  } catch {
    // Keep verification failures indistinguishable at the API boundary. The
    // caller will return its normal unauthenticated response and no JWT data
    // (including a replayed JTI) is exposed.
    return null;
  }
  if (!session) return null;
  const authorization = authorizeAgentOperation({
    session,
    method: input.method,
    pathname: input.pathname,
    workspaceId: input.workspaceId,
  });
  if (!authorization) return null;
  return {
    session,
    actor: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name || session.user.email,
    },
    workspaceId: authorization.workspaceId,
    capability: authorization.capability,
  };
}
