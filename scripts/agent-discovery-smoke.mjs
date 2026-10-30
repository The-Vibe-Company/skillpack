#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const site = new URL(process.env.APP_URL ?? "http://127.0.0.1:3000");
async function get(path, accept = "*/*") {
  const response = await fetch(new URL(path, site), { headers: { Accept: accept } });
  assert.equal(response.status, 200, `${path}: expected 200`);
  return response;
}
function checkDiscovery(response) {
  const links = response.headers.get("link") ?? "";
  for (const path of ["/llms.txt", "/sitemap.xml", "/.well-known/agent-skills/index.json"]) {
    assert.ok(links.includes(`<${path}>`), `Missing Link for ${path}`);
  }
}
function checkVary(response) {
  const tokens = (response.headers.get("vary") ?? "").toLowerCase().split(",").map((token) => token.trim());
  assert.ok(tokens.includes("accept"), "Missing Vary: Accept");
}
const robots = await (await get("/robots.txt")).text();
for (const agent of ["*", "GPTBot", "OAI-SearchBot", "ClaudeBot", "Claude-SearchBot", "PerplexityBot", "Google-Extended"]) {
  assert.ok(robots.includes(`User-agent: ${agent}\nAllow: /\nContent-Signal: search=yes, ai-input=yes, ai-train=yes`));
}
assert.ok(robots.includes("Sitemap:"));
const llms = await (await get("/llms.txt")).text();
for (const path of ["/", "/blog", "/blog/what-is-skill-md"]) {
  // Alternate representations on the same URL to expose cache contamination in either direction.
  for (const accept of ["text/html", "text/markdown", "text/html"]) {
    const response = await get(path, accept);
    checkDiscovery(response);
    checkVary(response);
    const text = await response.text();
    if (accept === "text/html") {
      assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
      assert.match(text, /<!DOCTYPE html>/i);
      assert.match(response.headers.get("vary") ?? "", /rsc/i);
      // The dynamic home emits preload headers; prerendered blog pages embed their links in HTML.
      if (path === "/") assert.match(response.headers.get("link") ?? "", /rel=preload/);
    } else {
      assert.equal(response.headers.get("content-type"), "text/markdown; charset=utf-8");
      assert.match(text, /^\s*# /);
      if (path === "/") assert.equal(text, llms);
    }
  }
}
const index = await (await get("/.well-known/agent-skills/index.json")).json();
assert.equal(index.$schema, "https://schemas.agentskills.io/discovery/0.2.0/schema.json");
assert.equal(index.skills.length, 2);
for (const skill of index.skills) {
  const bytes = await (await get(skill.url)).arrayBuffer();
  assert.equal(skill.digest, `sha256:${createHash("sha256").update(Buffer.from(bytes)).digest("hex")}`);
}
const catalog = await get("/.well-known/api-catalog");
assert.equal(catalog.headers.get("content-type"), "application/linkset+json");
assert.ok((await catalog.json()).linkset.length > 0);
const catalogHead = await fetch(new URL("/.well-known/api-catalog", site), { method: "HEAD" });
assert.equal(catalogHead.status, 200);
assert.match(catalogHead.headers.get("link") ?? "", /<\/\.well-known\/api-catalog>; rel="api-catalog"/);
const card = await (await get("/.well-known/mcp/server-card.json")).json();
assert.equal(new URL(card.remotes[0].url).pathname, "/mcp/public");
const agentCard = await (await get("/.well-known/agent-card.json")).json();
assert.equal(new URL(agentCard.url).pathname, "/a2a");
for (const message of [
  { method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } } },
  { method: "tools/list", params: {} },
  { method: "tools/call", params: { name: "read_article", arguments: { slug: "what-is-skill-md" } } },
]) {
  const response = await fetch(new URL("/mcp/public", site), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...message }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.ok(result.result && !result.error, `${message.method}: expected result`);
  if (message.method === "tools/list") {
    assert.deepEqual(result.result.tools.map((tool) => tool.name).sort(), ["list_articles", "read_article", "read_skill", "search_skills"]);
    assert.ok(result.result.tools.every((tool) => tool.annotations.readOnlyHint));
  }
}
const oauth = await (await get("/.well-known/oauth-protected-resource")).json();
assert.equal(new URL(oauth.resource).pathname, "/mcp");
assert.ok(oauth.authorization_servers.length > 0);
console.log(`Agent discovery smoke passed: ${site.origin}`);
