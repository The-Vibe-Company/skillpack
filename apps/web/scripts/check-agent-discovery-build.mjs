import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Serverless adapters use this manifest to override response headers, including static Markdown.
// Checking only middleware or `next start` misses a separate representation cache boundary.
const manifest = JSON.parse(readFileSync(new URL("../.next/routes-manifest.json", import.meta.url), "utf8"));
const vary = new Set((manifest.rsc?.varyHeader ?? "").toLowerCase().split(",").map((token) => token.trim()));
for (const token of ["accept", "rsc", "next-router-state-tree", "next-router-prefetch", "next-router-segment-prefetch"]) {
  assert.ok(vary.has(token), `Next's deployment manifest is missing Vary: ${token}`);
}
console.log("Agent discovery deployment headers preserve Accept and Next cache dimensions.");
