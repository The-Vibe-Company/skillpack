/* oxlint-disable anti-slop/no-unknown-returns, anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-unsafe-dictionary-type -- Better Auth's existing inferred Agent Auth plugin boundary exposes private and unknown response types; the stable public facade below predates the incremental anti-slop gate. */
import { betterAuth } from "better-auth";
import { emailOTP, mcp } from "better-auth/plugins";
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
  // Better Auth appends `?<authorize query>` to this URL, so it cannot be `/login?next=…`. The web
  // route re-frames the query as a `next` target and clears the plugin's resume cookie.
  loginPage: mcpWebPage("/mcp/login"),
  resource: mcpResourceUrl(),
  oidcConfig: {
    // The plugin overwrites this from the outer option; `OIDCOptions` still requires it.
    loginPage: mcpWebPage("/mcp/login"),
    allowDynamicClientRegistration: true,
    requirePKCE: true,
    allowPlainCodeChallengeMethod: false,
    consentPage: mcpWebPage("/mcp/consent"),
    accessTokenExpiresIn: MCP_ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenExpiresIn: MCP_REFRESH_TOKEN_TTL_SECONDS,
  },
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
    // Secondary storage keys verification values by their identifier, and the OAuth consent step
    // re-issues the authorization code by *renaming* a pending value's identifier. That rename only
    // reaches the database row, so a cache-only value would leave the new code unresolvable and
    // every MCP token exchange would fail with `invalid_grant`. Keeping verification values in the
    // database as well makes the authorize → consent → token chain read and write the same record.
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
    skillpackMcpPlugin,
  ],
  advanced: {
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
  return configuredAuth.handler(canonical);
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

/**
 * The stored access-token row Better Auth returns for a bearer credential. Expiry is re-checked
 * here so a stale row can never authorize a call.
 */
const mcpAccessTokenSchema = z.object({
  userId: z.string().min(1),
  clientId: z.string().min(1),
  scopes: z.string().default(""),
  accessTokenExpiresAt: z.coerce.date(),
});

/**
 * Validate an MCP bearer access token. Better Auth owns the token lookup; this facade narrows the
 * row to the identity the MCP server needs and re-checks expiry. The workspace binding lives in
 * `mcp_client_workspaces`, not in the token.
 */
export async function getMcpTokenSession(headers: Headers): Promise<McpTokenSession | null> {
  let row: unknown;
  try {
    row = await configuredAuth.api.getMcpSession({ headers });
  } catch {
    // Keep verification failures indistinguishable at the MCP boundary.
    return null;
  }
  const parsed = mcpAccessTokenSchema.safeParse(row);
  if (!parsed.success || parsed.data.accessTokenExpiresAt.getTime() <= Date.now()) return null;
  return {
    userId: parsed.data.userId,
    clientId: parsed.data.clientId,
    scopes: parsed.data.scopes.split(" ").filter(Boolean),
  };
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

/**
 * The authorization Better Auth stores against a consent code. Parsed here rather than trusted:
 * only the fields the consent screen and the workspace binding depend on are accepted.
 */
const storedMcpAuthorizationSchema = z.object({
  value: z
    .string()
    .transform((value, ctx) => {
      try {
        return JSON.parse(value);
      } catch {
        ctx.addIssue({ code: "custom", message: "stored authorization is not JSON" });
        return z.NEVER;
      }
    })
    .pipe(
      z.object({
        clientId: z.string().min(1),
        userId: z.string().min(1),
        scope: z.array(z.string()).default([]),
        redirectURI: z.string().min(1),
        requireConsent: z.literal(true),
      }),
    ),
  expiresAt: z.coerce.date(),
});

/**
 * Resolve the client and member a consent code belongs to. The MCP consent route needs both before
 * it writes a workspace mapping, and Better Auth replaces the code with a fresh one once the
 * decision is recorded, so this must run first.
 *
 * The lookup goes through Better Auth's own verification adapter rather than the `verification`
 * table: this instance configures secondary storage, so pending authorizations live there.
 */
export async function getMcpPendingAuthorization(consentCode: string): Promise<McpPendingAuthorization | null> {
  if (!consentCode) return null;
  const context = await configuredAuth.$context;
  const pending = storedMcpAuthorizationSchema.safeParse(
    await context.internalAdapter.findVerificationValue(consentCode),
  );
  if (!pending.success || pending.data.expiresAt.getTime() <= Date.now()) return null;
  const authorization = pending.data.value;
  const [client] = await db
    .select({ name: schema.oauthApplication.name, disabled: schema.oauthApplication.disabled })
    .from(schema.oauthApplication)
    .where(eq(schema.oauthApplication.clientId, authorization.clientId))
    .limit(1);
  if (!client || client.disabled) return null;
  return {
    clientId: authorization.clientId,
    userId: authorization.userId,
    scopes: authorization.scope,
    clientName: client.name || null,
    redirectOrigin: safeOrigin(authorization.redirectURI),
  };
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

const mcpConsentResultSchema = z.object({ redirectURI: z.string().min(1) });

/** Record the member's MCP consent decision and return the URL to hand back to the client. */
export async function decideMcpConsent(input: {
  headers: Headers;
  accept: boolean;
  consentCode: string;
}): Promise<{ redirectURI: string }> {
  const result = await configuredAuth.api.oAuthConsent({
    headers: input.headers,
    body: { accept: input.accept, consent_code: input.consentCode },
  });
  const parsed = mcpConsentResultSchema.safeParse(result);
  if (!parsed.success) throw new Error("the authorization server did not return a redirect target");
  return { redirectURI: parsed.data.redirectURI };
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
