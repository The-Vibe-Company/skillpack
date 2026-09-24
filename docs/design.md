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
