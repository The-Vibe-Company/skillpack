import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// Serverless adapters use this manifest to override response headers, including static Markdown.
// Checking only middleware or `next start` misses a separate representation cache boundary.
const manifest = JSON.parse(readFileSync(new URL("../.next/routes-manifest.json", import.meta.url), "utf8"));
const vary = new Set((manifest.rsc?.varyHeader ?? "").toLowerCase().split(",").map((token) => token.trim()));
for (const token of ["accept", "rsc", "next-router-state-tree", "next-router-prefetch", "next-router-segment-prefetch"]) {
  assert.ok(vary.has(token), `Next's deployment manifest is missing Vary: ${token}`);
}
console.log("Agent discovery deployment headers preserve Accept and Next cache dimensions.");

// Dynamic lambdas externalize the compiled runtime directly, bypassing its module loader.
const { routeModule } = createRequire(import.meta.url)("../.next/server/app/page.js");
const runtimeVary = new Set(routeModule.getVaryHeader("/", []).toLowerCase().split(",").map((token) => token.trim()));
for (const token of ["accept", "rsc", "next-router-state-tree", "next-router-prefetch", "next-router-segment-prefetch"]) {
  assert.ok(runtimeVary.has(token), `Built app-page runtime is missing Vary: ${token}`);
}
console.log("Dynamic app-page deployment headers preserve Accept and Next cache dimensions.");

// Authenticated uploads must keep the external proxy rather than enter a serverless body limit.
assert.ok(manifest.rewrites.beforeFiles.some((rewrite) => rewrite.source === "/mcp"
  && rewrite.destination.endsWith("/mcp")
  && rewrite.has?.some((condition) => condition.type === "header" && condition.key === "authorization")),
"Authenticated MCP requests must retain their external transport before local route handling");
