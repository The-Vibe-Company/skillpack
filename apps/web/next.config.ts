import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  // Internal workspace packages ship TypeScript source; transpile them.
  transpilePackages: ["@skillpack/contracts", "@skillpack/skills", "@skillpack/core"],
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
    ];
  },
};

export default withSentryConfig(config, {
  silent: true,
  telemetry: false,
});
