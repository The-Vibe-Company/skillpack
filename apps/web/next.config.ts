import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { posthogHosts, posthogRewrites } from "./src/lib/posthogHosts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  // Internal workspace packages ship TypeScript source; transpile them.
  transpilePackages: ["@skillpack/contracts", "@skillpack/skills", "@skillpack/core"],
  // Analytics only runs on the Vercel production deployment. Inline the build's environment so the
  // client sees it even when the project does not auto-expose Vercel system variables.
  env: { NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV ?? "" },
  // PostHog's API paths end in a slash (`/e/`, `/flags/`); a trailing-slash redirect would break the
  // /ingest proxy.
  skipTrailingSlashRedirect: true,
  // Blog posts are read from content/blog at build time; keep them beside standalone output too in
  // case a route renders on demand.
  outputFileTracingIncludes: {
    "/blog": ["./content/blog/**/*"],
    "/blog/[slug]": ["./content/blog/**/*"],
    "/blog/[slug]/opengraph-image": ["./content/blog/**/*", "./assets/fonts/**/*"],
    "/sitemap.xml": ["./content/blog/**/*"],
    "/llms.txt": ["./content/blog/**/*"],
    "/md/[[...path]]": ["./content/blog/**/*"],
    "/mcp/public": ["./content/blog/**/*"],
    "/a2a": ["./content/blog/**/*"],
  },
  async rewrites() {
    const api = process.env.COMPANION_API_URL ?? "http://127.0.0.1:3001";
    return [
      // Agent Auth discovery must live at the public instance root. In local development Web and
      // API use separate origins, so expose the API document through the same URL users copy.
      { source: "/.well-known/agent-configuration", destination: `${api}/.well-known/agent-configuration` },
      { source: "/schemas/:path*", destination: `${api}/v1/schemas/:path*` },
      // The MCP server and its OAuth metadata live on the single public origin. Better Auth serves
      // the metadata under `/auth/.well-known/…`; RFC 8414 discovery for this issuer looks at the
      // root, so both paths resolve to the same documents.
      { source: "/mcp", destination: `${api}/mcp` },
      {
        source: "/.well-known/oauth-authorization-server",
        destination: `${api}/auth/.well-known/oauth-authorization-server`,
      },
      {
        source: "/.well-known/oauth-protected-resource",
        destination: `${api}/auth/.well-known/oauth-protected-resource`,
      },
      { source: "/auth/:path*", destination: `${api}/auth/:path*` },
      { source: "/v1/:path*", destination: `${api}/v1/:path*` },
      { source: "/trpc/:path*", destination: `${api}/trpc/:path*` },
      // First-party PostHog proxy so tracking-domain blockers do not drop product analytics.
      ...posthogRewrites(posthogHosts(process.env.NEXT_PUBLIC_POSTHOG_HOST)),
    ];
  },
};

export default withSentryConfig(config, {
  silent: true,
  telemetry: false,
});
