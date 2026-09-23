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

Skillpack is also an OAuth 2.1 authorization server and an MCP server, so a hosted agent platform
can reach the Skills Hub without a personal access token. Better Auth's `mcp` plugin serves
authorization, token and dynamic client registration endpoints under `/auth/mcp/*`, with metadata at
`/auth/.well-known/oauth-*` and the resource itself at `/mcp`. Every URL lives on the one public
origin, so a deployment sets `BETTER_AUTH_URL` to that origin. PKCE S256 is required, there are no
static client secrets, and registration is dynamic.

An MCP connection carries session-equivalent rights, not Agent Auth capabilities: it acts as the
member who consented, with exactly the access that member already has. What bounds it is the
workspace. The consent screen makes the member choose one organization, and `mcp_client_workspaces`
records that choice for the registered client. No tool accepts a workspace argument, so one
connection can never reach a second organization; connecting another workspace means connecting the
app again.

Consent is not optional and is not the client's decision. Better Auth only routes to a consent page
when the client asks for `prompt=consent`, so the API rewrites every `/auth/mcp/authorize` request
to carry it — dynamic registration is open, which makes the client exactly the party that must not
be trusted to ask. For the same reason the two plugin endpoints this product does not publish are
closed: `/auth/mcp/get-session` would trade a one-hour access token for the thirty-day refresh
token, and `/auth/oauth2/consent` would approve a grant without binding a workspace or checking that
the session owns the request. `POST /v1/mcp/consent` is the only approval path.

Resolution requires the mapping *and* the recorded consent, so a binding whose approval never landed
is inert; the consent route also unwinds its own binding when approval fails. The pre-tenant
resolver re-proves membership on every request, so a removed member's connection fails closed, and
revocation deletes the OAuth client — cascading its tokens, consent and workspace mapping away.

Better Auth stores MCP access and refresh tokens in plaintext, unlike every other bearer credential
in this schema. That is inherent to delegating the token lifecycle to the plugin, which looks tokens
up by equality; it is recorded here as a known deviation rather than an oversight.

Tools mirror the REST surface through the same `@skillpack/core` services, so authorization, audit
rows and tenancy behave identically on both. Skillpack has no hard delete, so `skill_archive` is
documented as the delete and `skill_restore` undoes it. Secret plaintext stays behind the same
three-step preflight, grant and redeem sequence.

The bundled management skill is named `skillpack` and served at `/v1/local-skills/skillpack`.
The former `companion` route remains an alias; both names use the existing per-member installation
key `companion` so rebranding does not reset installation history. Package manifests, credential
paths, and transport headers retain their compatibility names. New installs use a `skillpack` folder.

## Unauthenticated skill usage reporting

Publication embeds the instance URL, skill ID, version, and portable HTTP instructions before archive
checksums are computed. Publication responses include `usage_instance_url` so CLI normalization uses
the same public origin even when it connects through an internal API alias. The delimited instruction is replaced idempotently on republish. Publishing
never executes the instruction. The public endpoint `POST /v1/skill-usage` validates a bounded 4 KB
contract before calling an append-only SECURITY DEFINER function. It never resolves an incoming
session, accepts a tenant ID, or returns skill metadata. Known, unknown, duplicate, and per-skill
rate-limited reports receive the same empty 202 response. Process admission is capped at 600 requests
per minute; PostgreSQL serializes a 120 accepted reports/minute/skill cap across replicas.

`skill_usage_events` uses server receipt time, forced RLS, and a unique (org, skill, event) key. The
server resolves the organization and published version; reported user IDs are strings, not authority
or foreign keys to verified accounts. API runtime roles have SELECT plus the reporting function;
worker roles have only the bounded expiry function. Reads recheck membership and personal ownership,
and exclude rows older than 90 days. A worker sweep deletes up to 10,000 expired rows each minute.
The migration owner policy supports narrow definers without requiring a BYPASSRLS application role.
Request bodies and database failures carrying report values must not be logged.

`GET /v1/skills/:slug/usage` is a session-authenticated read, scoped to the selected organization. It
returns 90-day totals, daily UTC counts, agent/environment breakdowns, anonymous counts, and up to
500 declared identities with an explicit truncation flag. Identity source remains visible; identities
are not automatically linked to member profiles. Future events after Share follow the skill's new
organization scope, as do retained statistics for that skill.
