# Public agent discovery

The web app advertises `/llms.txt`, `/sitemap.xml`, and the static Agent Skills index
at `/.well-known/agent-skills/index.json` through additive RFC 8288 Link headers.
Framework resource preloads remain present. `robots.txt` allows all crawlers and
explicitly allows the named AI crawlers with the requested Content Signals.

Home, `/blog`, and `/blog/<slug>` support `Accept: text/markdown`. Middleware rewrites
to independently pre-generated `/md/...` routes. Both representations vary on Accept;
HTML continues to use its existing static rendering and cache policy. The pinned
Next.js 15.5.24 package patches its CommonJS and ESM templates to append
framework Vary tokens. Its response-header adapter also merges subsequent Vary
writes with existing tokens (case-insensitively), preserving Accept when a render
replaces the header. Recheck
HTTP variants when upgrading Next.js and remove the patch when upstream preserves
custom Vary values. The patch also appends Accept to the generated RSC route
manifest: Vercel uses that value to override app-route and prerender response
headers, independently of the Node response adapter. The compiled app-page development and production runtimes
also append Accept to their own Vary value, preserving interception-route Next-URL
behavior; dynamic serverless pages externalize these runtimes directly.
The web build asserts that
both the deployment manifest and the built home runtime preserve Accept and all
framework dimensions. Article bodies
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

The existing authenticated `/mcp` and OAuth routes retain their behavior. RFC 9728
resource discovery returns JSON: `/.well-known/oauth-protected-resource` identifies
the request origin, and `/.well-known/oauth-protected-resource/mcp` identifies
`<origin>/mcp`. Both preserve Better Auth's authorization servers, scopes and other
metadata. The web proxy forwards the request origin only for the MCP discovery
challenge, keeping it independent of the configured token issuer. MCP 401
challenges link to the MCP-specific document on that origin; successful public
pages do not advertise a challenge. Anonymous `/mcp/public` requires no OAuth.
When upstream PRM omits scopes, both documents publish Better Auth's existing public
OIDC scopes: `openid`, `profile`, `email`, `offline_access`. An explicit upstream
scope list is preserved. Requests with an Authorization header retain the existing
external MCP transport, including large uploads, through a before-files rewrite.
The API still validates every token. The `/mcp` web handler relays requests without
an Authorization header, preserving bodies, status and protocol headers; only a 401 challenge's
discovery URL is adapted. This also works while previews use an older deployed API.
The A2A card includes `supportedInterfaces` for the existing JSONRPC `/a2a`
interface at protocol version 0.3.0, alongside its legacy URL and transport fields.

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

## Browser tools and capability manifests

The root layout feature-detects the current `document.modelContext` WebMCP API and
its earlier `navigator.modelContext` form. It registers `search_skills`, `get_skill`,
`list_blog_posts`, and `read_blog_post` as read-only tools. They map only to the
existing anonymous `/mcp/public` tools and always omit browser credentials. Private
page content, session state, workspace APIs and write tools are never exposed.
When the API is absent, the component renders nothing and does no work. Registration
is scoped to the component lifetime and supports cancellation.

`/.well-known/ai-catalog.json` uses the ARD v0.91 `entries` envelope, a `specVersion`
compatibility marker of `"0.91"`, and domain-anchored
`urn:air:` identifiers. Its five public resources are the MCP server card, A2A card,
Agent Skills index, RFC 9727 API catalog and `llms.txt`. The root head links it with
`rel="ai-catalog"`; `robots.txt` includes an `Agentmap` using the configured site origin.
The robots route remains statically generated, preserving its existing behavior.

`/.well-known/poppy.json` follows the Poppy draft 0.3 discovery schema: organization
identity matches the request host, and `auth.issuer` repeats an existing authorization
server from the root protected-resource metadata. It advertises only `web: {}` for
ordinary signed-out browsing. It does not claim Poppy sessions, API token support,
conversations, browser-session endpoints or sign-in extensions; the existing auth
flow is unchanged. Publishing this discovery document is not a claim of full Poppy
session or OAuth-profile conformance.
Both `/.well-known/oauth-authorization-server` and the RFC 8414 issuer-path form
`/.well-known/oauth-authorization-server/auth` preserve upstream OAuth metadata and
add `poppy_domains` for the existing issuer's hostname. In production that is
`["skillpack.app"]`, matching `poppy.json`'s organization domain `skillpack.app`.
Preview manifests identify the preview host but retain the production issuer; the
production authorization server does not bind arbitrary preview domains. Full Poppy
domain binding is therefore only expected on the production host. This metadata
extension changes no issuer, endpoint, scope grant, token, consent or session flow.

Schema sources: [ARD](https://github.com/ards-project/ard-spec/blob/main/spec/schemas/ard-entry.schema.json),
[Poppy](https://github.com/personal-agent-protocol/personal-agent-protocol/blob/main/kit/company/schemas/poppy.schema.json),
[WebMCP](https://webmachinelearning.github.io/webmcp/).
DNS-AID records are proposed in the PR description only; this change performs no DNS writes.
