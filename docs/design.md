# Skillpack architecture

Skillpack is a self-hostable Skills Hub.

- `apps/web`: Next.js skill libraries, package detail, secrets, and workspace settings.
- `apps/api`: REST/tRPC authentication, authorization, and domain services.
- `apps/worker`: GitHub mirrors, billing, and Skill Database object cleanup.
- `cli`: external Skills Hub client.
- `packages/contracts`: shared API and package contracts.
- `packages/db`: Drizzle schema, forward migrations, tenant RLS, and role grants.
- `packages/core`: shared authorization and services, without Next.js dependencies.
- `packages/skills`: package parsing, validation, dependencies, and versioning.
- `packages/skilldb`: declared tenant-scoped SQLite state.
- `packages/storage`: S3-compatible archives, releases, images, and database objects.
- `packages/skillpack-skill`: bundled workflow for delegated external agents.

Every tenant-owned query is scoped by org_id. Forced RLS is defense in depth. Personal skills,
labels, and Skill Database realms remain creator-only with no administrator override.
API and worker use separate NOBYPASSRLS roles; migration ownership is isolated from both.
Historical migrations and their compatibility role-grant support remain replayable.

## Skills Hub

Packages are validated without executing scripts. Publication writes immutable version/file
metadata, dependency edges, secret slots, database declarations, and an audit event. Share performs
the only personal-to-org transition and includes required private dependencies after an explicit
plan. Install records are per member and do not copy skill rows.

Public release promotion pins one exact organization skill version and checksum. Upload/download
transfer tickets are short-lived, purpose-specific, non-replayable where required, and revalidated
at redemption. GitHub sync writes deterministic, digest-verifiable repository state.

Skills may declare bounded SQLite tables. Core validates additive schema evolution and access,
`packages/skilldb` executes parameterized statements, and object storage persists realms with
conditional generation checks. The worker cleans queued database objects and expires reported skill activations.

## Secrets and delegated Agent Auth

The human CLI uses a separate browser approval flow for a normal workspace PAT. An unauthenticated CLI creates a five-minute request with a random public ID and the hash of a private verifier. A signed-in member sees the complete key authority and selects one current workspace. Approval stores only the decision and member/workspace identity; the browser never receives the PAT. The CLI proves possession of its verifier when polling. A single atomic consume precedes PAT issuance under the selected tenant context, which rechecks membership. This differs from Agent Auth's constrained child PATs. An environment API key bypasses browser login but retains the same server authorization checks.

Secret plaintext is accepted only on write or rotation, envelope-encrypted, and never returned by
ordinary CRUD. Skill bindings refer to stable slots. External clients retrieve authorized values
only through preflight and short-lived, non-replayable grants. Logs and audit metadata remain
value-free.

Agent Auth connects external coding agents to the Skills Hub. Tenant capabilities are limited to
skill, Skill Database, and skill-secret operations constrained to one exact workspace;
`public-skills:install` remains instance-wide. Agent Auth never grants Skillpack chat, provider,
desktop, or lifecycle access.

An Agent Auth child PAT snapshots only active exact-workspace grants, caps expiry at seven days and
the earliest source expiry, and stores value-free provenance. Callers cannot choose scopes or
organizations, PATs cannot mint child PATs, and a target-bound token requires the matching declared
target. Possession remains bearer authority until expiry or revocation.

## MCP connections

The anonymous `/mcp/public` endpoint is separate from workspace connections: it serves only
explicitly listed public catalogue snapshots and published blog articles through read-only tools.
It forwards no client credentials and grants no workspace access. The catalogue's default-off
flag still applies. Public discovery, Markdown representations and the synchronous A2A adapter
are documented in [Public agent discovery](agent-discovery.md).

Skillpack is also an OAuth 2.1 authorization server and an MCP server, so a hosted agent platform
can reach the Skills Hub without a personal access token. Better Auth's `@better-auth/mcp`
provider serves authorization, token and dynamic registration endpoints under `/auth/oauth2/*`.
The previous `/auth/mcp/authorize`, `/auth/mcp/token` and `/auth/mcp/register` URLs remain aliases.
Discovery uses issuer `/auth`, authorization-server metadata at
`/.well-known/oauth-authorization-server/auth`, and protected-resource metadata at
`/.well-known/oauth-protected-resource/mcp`; the original `/auth/.well-known/*` metadata URLs
remain available. Every URL lives on the one public origin configured by `BETTER_AUTH_URL`.
PKCE S256 is required. Unauthenticated dynamic registration is explicitly enabled; registered
clients receive only authorization-code and refresh-token grants, never machine credentials.
Provider administration and managed-client endpoints are not published; global resource policy
cannot be changed by workspace members.

An MCP connection carries session-equivalent rights, not Agent Auth capabilities: it acts as the
member who consented, inside the one workspace selected on the consent screen. The
`mcp_client_workspaces` mapping fixes that workspace; no tool accepts a workspace argument.

Every browser authorization forces `prompt=consent`, including requests to the legacy alias;
authorization POSTs are rejected. The provider's signed OAuth query is exchanged server-side for
an opaque, ten-minute consent ticket tied to the current member and browser session. The consent
screen receives only that ticket. `POST /v1/mcp/consent` rechecks ownership and membership, binds
the workspace, consumes the ticket atomically, and invokes provider consent in-process. Direct
`/auth/oauth2/consent` and legacy `/auth/mcp/get-session` remain closed. Provider login returns
through the web sign-in screen and resumes browser authorization before requesting consent.

Resolution requires both the workspace mapping and approved consent, and re-proves membership on
every request. Approval failures unwind their binding. Revocation deletes the client and cascades
its access tokens, refresh tokens, consents and workspace mapping. Token validation also checks
client disabling and any linked browser session; refresh rotation rejects replay without a reuse
window. New authorizations pin the exact `/mcp` resource audience.

Migration 0198 upgrades the existing identity tables in place, retains client IDs and exact-workspace
mappings, splits refresh grants from access tokens, hashes the formerly plaintext credentials, and copies
live browser sessions from the PostgreSQL cache into the now-required durable session table.
Existing opaque access and refresh tokens retain their original expiries and authorization checks;
legacy access tokens have no audience claim and remain confined by the same client/workspace mapping.
The cutover requires stopping old API instances before applying the migration and deploying the
new API. In-flight 1.6 authorization/consent requests must restart; issued credentials and approved
connections survive. Migrated confidential clients retain both Basic and body-secret authentication;
new clients use their registered authentication method. OAuth/JWKS tables remain global, API-only identity data; worker roles have no
access. Pending consent tickets use the atomic PostgreSQL secondary store.

Tools mirror the REST surface through the same `@skillpack/core` services, so authorization, audit
rows and tenancy behave identically on both. Skillpack has no hard delete, so `skill_archive` is
documented as the delete and `skill_restore` undoes it. Secret plaintext stays behind the same
three-step preflight, grant and redeem sequence.

The bundled management skill is named `skillpack` and served at `/v1/local-skills/skillpack`.
The former `companion` route remains an alias; both names use the existing per-member installation
key `companion` so rebranding does not reset installation history. Package manifests, credential
paths, and transport headers retain their compatibility names. New installs use a `skillpack` folder.

## Runtime skill usage collection

The standalone Go runtime observes approved Codex/Claude hooks, OpenCode plugin events and incremental transcripts for
registered sessions. It constructs a redacted event from verified install metadata, queues it in
private SQLite, and wakes a bounded sender. Setup verifies an Ed25519 release manifest and the exact
archive SHA-256 before activating a native binary. No package-supplied plugin or model-generated
tracking command runs. See [runtime operations](skillpack-runtime.md).

`POST /v1/skill-usage-events` validates a 4 KB schema and commits a durable pre-tenant receipt before
returning its event ID. Unknown, duplicate and known skill IDs follow the same receipt path. Capacity
pressure returns 429; database failure returns 503. A worker resolves actual tenant/version and
inserts observations idempotently. Receipt payloads are cleared after processing and opaque IDs
retained for eight days. The 10k-event client queue expires after seven days; server observations
retain 90 days. API/worker roles can invoke only their narrow security definers, with forced RLS.

`GET /v1/skills/:slug/usage` rechecks membership and personal ownership. Invocations, requests, reads
and historical agent reports remain distinct. Declared identities are not verified accounts.
The retired `/v1/skill-usage` emitter, generated HTTP instructions and in-place archive retrofit are
removed. Historical migrations remain replayable; old statistics remain a separate category.

The configured release phase publishes a new patch for every active organization skill, all authors,
using a latest-version guard and immutable content-addressed archives. Public pins and historical
versions are preserved. A rerun skips committed runtime migrations and replans a concurrent publish.
Skillpack bootstrap updates clean user installs for this exact technical patch. Pins, customizations
and repository copies remain explicit exceptions; repository updates are reviewable PR changes.

## Opt-in public catalog

The [catalog backend](public-catalog.md) adds separate listing consent to complete public releases.
Owner/Admin submissions and Developer requests freeze release metadata; validation enables discovery.
Platform moderation is separate from organization roles; API-only security definers provide the
cross-organization queue and audited decisions, surfaced at the session-only `/platform/catalog` screen, which 404s for non-moderators. Operator-managed moderator grants and org publishing
policies cannot be changed through tenant writes. A check-report reader consumes persisted reports for the
exact frozen identity; absent reports remain pending, and auto-approval also requires an allowlist.
Anonymous org/slug installs pin that validated snapshot and verify its content-addressed ZIP;
package delivery rechecks listing visibility and the feature flag after storage retrieval.
Its anonymous read API exposes only validated snapshot content through narrowly scoped pre-tenant
PostgreSQL functions. `SKILLPACK_PUBLIC_CATALOG` defaults off; token-based sharing remains separate.
The web reads the same flag server-side and, only when it is on, renders publishing controls in the
public release dialog and the anonymous `/catalog` pages and sitemap entries from that API.

Anonymous catalog reports use API-only security definers for durable rate-limited writes and
platform-moderator-only reads. Report text and abuse hashes have no tenant read policy; see
[public catalog reporting](public-catalog.md#anonymous-reporting).

## Operator statistics

`GET /v1/stats` returns instance-wide account counts from the global auth `user` table:
`total_users`, `new_users_1d`, and `new_users_7d`. New-user windows are rolling 24-hour
and seven-day periods ending at database query time, inclusive at both boundaries.
`active_users_1d` and `active_users_7d` are `null`: the data model has no reliable
per-user activity tracking. Session timestamps and unverified usage identities are not proxies.

Set `STATS_TOKEN` to a strong random secret on the Railway API service (or the self-hosted
API process). Send it as `Authorization: Bearer <token>`. Missing or incorrect credentials,
or an unset/empty `STATS_TOKEN`, return 401. Responses use `Cache-Control: no-store`.
This operator credential grants aggregate instance statistics only; the endpoint runs
a read-only SELECT before session middleware and returns no account identities.
