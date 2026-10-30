import { NextResponse, type NextRequest } from "next/server";
import { POSTHOG_PROXY_PATH } from "@/lib/posthogHosts";
import { acceptsMarkdown, AGENT_DISCOVERY_LINKS, hasMarkdownRepresentation } from "@/lib/agentDiscovery";

/**
 * `skipTrailingSlashRedirect` keeps PostHog's slash-terminated API paths intact behind the /ingest
 * proxy. Every other URL keeps Next.js's default permanent redirect to its slash-less form.
 */
export function trailingSlashRedirect(request: NextRequest): URL | null {
  const pathname = request.nextUrl.pathname;
  if (pathname === "/" || !pathname.endsWith("/")) return null;
  if (pathname.startsWith(`${POSTHOG_PROXY_PATH}/`)) return null;
  // A plain URL: NextURL keeps the request's trailing-slash flag and would put the slash back.
  const destination = new URL(request.nextUrl.href);
  destination.pathname = pathname.replace(/\/+$/, "");
  return destination;
}

export function canonicalAliasRedirect(request: NextRequest, configuredWebUrl = process.env.COMPANION_WEB_URL) {
  if (!configuredWebUrl) return null;

  let canonical: URL;
  try {
    canonical = new URL(configuredWebUrl);
  } catch {
    return null;
  }

  const canonicalHost = canonical.hostname.toLowerCase();
  const aliasHost = canonicalHost.startsWith("www.") ? canonicalHost.slice(4) : `www.${canonicalHost}`;
  if (request.nextUrl.hostname.toLowerCase() !== aliasHost) return null;

  const destination = request.nextUrl.clone();
  destination.protocol = canonical.protocol;
  destination.hostname = canonical.hostname;
  destination.port = canonical.port;
  return destination;
}

function isAgentAuthProxyPath(pathname: string): boolean {
  return pathname === "/v1"
    || pathname.startsWith("/v1/")
    || pathname === "/auth/agent"
    || pathname.startsWith("/auth/agent/")
    || pathname === "/auth/host"
    || pathname.startsWith("/auth/host/")
    || pathname === "/auth/capability"
    || pathname.startsWith("/auth/capability/");
}

/**
 * Preserve the fixed public Agent Auth origin across the external Next.js rewrite. Hosting proxies
 * may replace the standard forwarding headers with their own service host, so the API consumes this
 * exact configured-origin marker and still canonicalizes Better Auth's JWT audience to one value.
 */
export function agentAuthProxyHeaders(
  request: NextRequest,
  configuredWebUrl = process.env.COMPANION_WEB_URL,
): Headers | null {
  if (!configuredWebUrl || !isAgentAuthProxyPath(request.nextUrl.pathname)) return null;
  let origin: string;
  try {
    const configured = new URL(configuredWebUrl);
    if (!["http:", "https:"].includes(configured.protocol) || configured.username || configured.password) return null;
    origin = configured.origin;
  } catch {
    return null;
  }
  const headers = new Headers(request.headers);
  headers.set("x-companion-agent-auth-origin", origin);
  return headers;
}

export function legacyRuntimeRedirect(request: NextRequest): URL | null {
  const pathname = request.nextUrl.pathname;
  if (pathname !== "/projects" && !pathname.startsWith("/projects/")
    && pathname !== "/runs" && !pathname.startsWith("/runs/")) return null;
  const destination = request.nextUrl.clone();
  destination.pathname = "/skills";
  destination.search = "";
  return destination;
}

/** The workspace that publishes the official skills the build-time catalog once served. */
const LEGACY_CATALOG_ORG_SLUG = "the-vibe-company";

/**
 * The build-time catalog served official skills at `/catalog/:slug`. The live catalog is keyed by
 * workspace slug, so those one-segment URLs move permanently under the official workspace.
 */
export function legacyCatalogRedirect(request: NextRequest): URL | null {
  const match = /^\/catalog\/([^/]+)\/?$/.exec(request.nextUrl.pathname);
  if (!match?.[1]) return null;
  const destination = request.nextUrl.clone();
  destination.pathname = `/catalog/${LEGACY_CATALOG_ORG_SLUG}/${match[1]}`;
  destination.search = "";
  return destination;
}

/**
 * The /ingest proxy is same-origin, so the browser attaches Skillpack's session cookie to every
 * PostHog request. Drop credentials before the external rewrite so they never reach PostHog.
 */
export function posthogProxyHeaders(request: NextRequest): Headers | null {
  const pathname = request.nextUrl.pathname;
  if (pathname !== POSTHOG_PROXY_PATH && !pathname.startsWith(`${POSTHOG_PROXY_PATH}/`)) return null;
  const headers = new Headers(request.headers);
  headers.delete("cookie");
  headers.delete("authorization");
  return headers;
}

export function middleware(request: NextRequest) {
  const slashless = trailingSlashRedirect(request);
  if (slashless) return NextResponse.redirect(slashless, 308);
  const destination = canonicalAliasRedirect(request);
  if (destination) return NextResponse.redirect(destination, 308);
  const skillsDestination = legacyRuntimeRedirect(request);
  if (skillsDestination) return NextResponse.redirect(skillsDestination, 308);
  const catalogDestination = legacyCatalogRedirect(request);
  if (catalogDestination) return NextResponse.redirect(catalogDestination, 301);
  const headers = posthogProxyHeaders(request) ?? agentAuthProxyHeaders(request);
  const markdownPage = hasMarkdownRepresentation(request.nextUrl.pathname);
  let response: NextResponse;
  if (markdownPage && ["GET", "HEAD"].includes(request.method) && acceptsMarkdown(request.headers.get("accept"))) {
    const markdownUrl = request.nextUrl.clone();
    markdownUrl.pathname = request.nextUrl.pathname === "/" ? "/md" : `/md${request.nextUrl.pathname}`;
    response = NextResponse.rewrite(markdownUrl);
  } else {
    response = headers ? NextResponse.next({ request: { headers } }) : NextResponse.next();
  }
  // Append rather than replace: framework preloads and other discovery entries must survive.
  response.headers.append("Link", AGENT_DISCOVERY_LINKS);
  if (markdownPage) response.headers.append("Vary", "Accept");
  return response;
}
