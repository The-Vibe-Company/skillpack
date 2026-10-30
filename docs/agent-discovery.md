# Public agent discovery

The web app advertises `/llms.txt`, `/sitemap.xml`, and the static Agent Skills index
at `/.well-known/agent-skills/index.json` through additive RFC 8288 Link headers.
Framework resource preloads remain present. `robots.txt` allows all crawlers and
explicitly allows the named AI crawlers with the requested Content Signals.

Home, `/blog`, and `/blog/<slug>` support `Accept: text/markdown`. Middleware rewrites
to independently pre-generated `/md/...` routes. Both representations vary on Accept;
HTML continues to use its existing static rendering and cache policy. The pinned
Next.js 15.5.28 package has a two-line patch (CommonJS and ESM templates) to append
its framework Vary tokens rather than overwrite the middleware header. Recheck
HTTP variants when upgrading Next.js and remove the patch when upstream preserves
custom Vary values. Article bodies
come directly from `content/blog`, including structured YAML fences. Home and
`/llms.txt` share the same overview and article list.

The two public discovery skills document the native release installer and blog
browsing. After editing a served `SKILL.md`, update its SHA-256 digest in `index.json`.
The web behavior tests compare those digests with the exact public-file bytes and
check frontmatter metadata. These public instructions are separate from the bundled
workspace-management skill in `packages/skillpack-skill`.

## Public protocols

`/mcp/public` is a stateless, anonymous, read-only Streamable HTTP MCP endpoint for
public catalogue skills and blog articles. It reuses the MCP SDK already used by the
API. Skill search examines one bounded catalogue page at a time; follow `next_offset`
to continue. The default-off `SKILLPACK_PUBLIC_CATALOG` flag still applies. No incoming
cookies or authorization headers are forwarded to catalogue requests, and private
workspace APIs are never called.

The MCP Server Card is at `/.well-known/mcp/server-card.json`; the A2A Agent Card is
at `/.well-known/agent-card.json`. The A2A endpoint supports synchronous read-only
commands only, as described in its card. `/.well-known/api-catalog` serves an RFC 9727
`application/linkset+json` document linking these public discovery resources.

The existing authenticated `/mcp` and OAuth routes retain their behavior. The existing
`/.well-known/oauth-protected-resource` rewrite continues to serve Better Auth's
metadata for that protected resource; anonymous `/mcp/public` requires no OAuth.

## Web Bot Auth

TODO for the deployment operator: provision a signing identity and private key in a
secret manager before publishing `/.well-known/http-message-signatures-directory`.
No directory or fake key is published here: advertising a signing identity without
an operational signer would misrepresent Web Bot Auth support. Private keys must
never be committed or included in agent discovery documents.

## HTTP verification

With the application running, run
`APP_URL=http://127.0.0.1:3000 node scripts/agent-discovery-smoke.mjs`.
It alternates HTML and Markdown requests to catch cache contamination, verifies
Vary and additive Link headers, checks served digests, and exercises MCP discovery
and article reads. Run against a production build when upgrading Next.js.
