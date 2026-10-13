# Public catalog backend

The anonymous catalog is disabled unless `SKILLPACK_PUBLIC_CATALOG=true`. Existing releases remain
unlisted. Catalog publication is a separate explicit decision from public release promotion and
share-link access. Only organization skills can be submitted; personal skills must first be shared.

## Publication API

All listing routes require authentication in the selected workspace, recheck live membership, and
reject cross-tenant access. Personal skill status stays creator-private and personal publication is
rejected. Responses and audit metadata never include share tokens. Listing responses use `no-store`.

- `PUT /v1/skills/:slug/public-listing` requires `skills:write` and Owner/Admin.
  `{ "listed": true }` creates a `proposed` submission containing the current public version ID,
  exact ZIP checksum, byte size and file snapshot. It requires a complete, unarchived organization
  public release and verifies release bytes before recording the proposal. It does **not** enable
  discovery. If a Developer request is open, the PUT converts it to a submission, preserves its
  requester, records the submitting admin and freezes the release current at approval time.
- `POST /v1/skills/:slug/public-listing/request` with `{}` requires `skills:write` and Developer.
  It creates an inert `proposed` row of kind `publish_request`, awaiting Owner/Admin submission.
  The release is frozen in the request too; admin submission refreshes that snapshot to the then
  current release. Owner/Admin submit directly with PUT.
- `GET /v1/skills/:slug/public-listing` requires `skills:read` and organization membership.
  It returns `listed_publicly`, `listed_at`, `latest_submission` (nullable `{ id, status, kind }`),
  `rejection_reason` and `can_manage_listing`. Mutation responses add `changed`.
- `{ "listed": false }` on PUT immediately unpublishes and withdraws any open request/submission.
  The public release and share token stay intact. Archiving or withdrawing the public release also
  clears discovery and withdraws open submissions atomically. Restoration needs a fresh submission.

`catalog_submissions` uses tenant RLS, organization-bound skill/version foreign keys, and a partial
unique index allowing at most one `proposed` row per skill. Repeating a proposal for the same release
is idempotent; an open submission for different release bytes must first be withdrawn. The status
values are `proposed`, `validated`, `rejected`, `removed`, and `withdrawn`. Every implemented transition writes
an audit event in the same transaction. A rejected proposal can be followed by a fresh proposal;
rejection and removal are platform moderation decisions.

Only validation enables discovery. Developer requests cannot be validated. Production moderation
requires a passing automatic check report for the exact frozen version and package checksum.
The internal `applyValidatedSubmission` primitive remains for lifecycle tests; production decisions
use the moderator boundary below.

A listed skill continues serving the previously validated snapshot while a new public release is
promoted or proposed. Validation of a newer submission replaces that catalog version atomically.
The catalog reads the latest validated submission's frozen version, checksum, size and files, never
the mutable public release pin or a later private draft. There is no submission backfill.

## Anonymous catalog API

- `GET /v1/public/catalog/skills?limit=20&offset=0&label=engineering` is anonymous.
  `limit` is 1–50 and `offset` is 0–10000. The optional label is an exact organization label path;
  personal labels never participate. Results are ordered by organization slug and skill slug.
  `next_offset` is null for a short page or pagination bound; a full final page can be followed by
  an empty page.
- `GET /v1/public/catalog/skills/:orgSlug/:skillSlug` is anonymous and returns 404 when unlisted,
  unvalidated, personal, archived, missing, or disabled. Organization and skill slugs identify entries;
  existing public-release rename restrictions apply.

Each entry contains only `org_name`, `org_slug`, `skill_slug`, `name`, `description`, `version`,
`released_at`, `checksum`, `size_bytes`, `body`, and `files` (`path`, `size_bytes`). `released_at` is
when the selected submission was validated. Content comes from the frozen skill version and ZIP
snapshot. No member identity, share token, activity statistics, secret declarations or storage path
is serialized. Authored instructions and file names are intentionally public after validation.

Anonymous responses support ETag caching with mandatory revalidation. Every request checks current
visibility before a 304, so unlisting and disabling the flag take effect immediately. Errors use
`no-store`. A process-wide cap of 600 requests per minute follows the existing anonymous usage route
pattern and does not trust forwarding headers or retain IP addresses. The narrowly scoped
pre-tenant PostgreSQL functions are executable by the API role only.

## Platform moderation (PR 4/9)

All `/v1/platform/catalog/*` routes require a signed-in browser session and a live platform moderator
grant. Owner, Admin, Developer, PATs and delegated agents have no moderation authority. Responses
are `no-store`; non-moderators receive 403. With `SKILLPACK_PUBLIC_CATALOG` absent or false these
routes return 404 and automatic approval is disabled.

- `GET /v1/platform/catalog/submissions?status=proposed&limit=20&offset=0` lists submissions across
  organizations. Status is `proposed`, `validated`, `rejected` or `removed`; limit is 1–50, offset
  0–10000. Developer requests are excluded. Rows expose frozen IDs/checksum, status, dates, decision
  reason, `check_status` (`pending`, `passed`, `failed`) and `check_reason`. No package content,
  tokens, storage paths or member contact details are returned.
- `POST /v1/platform/catalog/organizations/:orgId/submissions/:submissionId/validate` takes `{}`.
  Only active proposed organization submissions with matching passing checks can be validated.
- `POST .../:submissionId/reject` takes `{ "reason": "Unsupported license" }` and rejects a proposal.
  An older validated release can remain listed while a newer submission is rejected.
- `POST .../:submissionId/remove` takes a reason, unlists the entire skill, marks its validated
  snapshots removed and rejects its pending candidates. A fresh submission is required to relist.
- `POST /v1/platform/catalog/organizations/:orgId/ban` takes a reason, unlists that organization's
  catalog skills and closes all pending candidates. Future proposals and validation fail while banned.

Reasons are nonblank and at most 2000 characters. Invalid input returns 400, missing targets 404,
and invalid transitions or missing/pending/failing checks 409. Actions, affected submission decisions
and listing changes write audit rows in the same transaction. Public releases and share links remain
available after removal or a publishing ban. The organization policy lock precedes skill locks so a
ban cannot race a new submission into discovery.

### Operator configuration

Initially grant Stan's **immutable user ID** using `SKILLPACK_CATALOG_MODERATOR_USER_IDS` (comma
separated), or insert that ID into `platform_moderators(user_id)` using the migration/operator
connection. Removing both the DB grant and environment entry revokes the authority on the next
request. No display name, organization role or unverified email grants this platform role.

Allowlist The Vibe Company's **immutable org ID** with `SKILLPACK_CATALOG_AUTO_APPROVE_ORG_IDS`
(comma separated), or set `catalog_publishing_policies.auto_approve=true` for that `org_id`.
The allowlist defaults empty; absent policy rows default to unbanned with no auto-approval.
Both tables use forced RLS and are operator-managed. Neither API nor worker credentials can
write their rows directly; the API can ban through the audited moderation function. Lifting a ban
requires an operator DB change and never restores prior listings automatically.

Do not infer Stan or The Vibe Company's identity from names in a self-hosted database. Deployments
must supply verified IDs. Apply additive migration `0195_catalog_moderation` and runtime grants
before deploying the API. It has no catalog backfill and does not affect organization memberships.

### Check-report interface shared with PR 3

This PR consumes checks and does not execute or store them. At API startup, PR 3 registers its
persisted-report reader with `configureCatalogCheckReader(reader)` from `@skillpack/core`.
The reader receives `{ orgId, submissionId, skillVersionId, packageChecksum, database }` and returns
`CatalogCheckReport | null` from `@skillpack/contracts`. A report repeats those four identity fields
and adds `status: 'pending' | 'passed' | 'failed'` and `reason: string | null` (max 2000 characters).
`passed` must mean all PR 3 checks passed, including **organization scope and MIT or Apache-2.0
license only**. Unsupported licenses must produce `failed` with a reason; this consumer exposes that
failure and prevents validation. No report reader is installed by default: null or mismatched
identity is treated as pending, never as a pass. Decisions also compare the frozen identity under
the SQL lock to prevent stale approval.

After persisting a report, PR 3 calls `autoApproveCatalogSubmission({ orgId, submissionId, database })`.
This is an internal callback, with no HTTP/MCP authority to manufacture reports. It returns false
for missing/failing reports, non-allowlisted orgs, bans or closed submissions. Proposal creation and
admin conversion also invoke it for an already persisted matching report. Repeated callbacks are
inert after validation. Automatic audit rows use the submission actor and `automatic: true`.

## Later publishing PRs

PR 2/9 adds submissions and frozen validated versions, stacked on PR #26's org-only catalog API.
PR 4/9 adds the moderator API and report-consumer boundary independently of PR 3's checks engine.
Later PRs add anonymous installs by slug and frontend workflows. Share tokens remain separate and
excluded from every listing and catalog response. Self-hosted deployments remain disabled by default;
enabling the catalog on managed hosting remains a deployment decision.
