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

## Moderation screen (PR 8/9)

`/platform/catalog` is the internal web screen for platform moderators. The web server returns
404 unless `SKILLPACK_PUBLIC_CATALOG=true`, sends signed-out visitors to login, and asks the queue
API with the browser session before rendering anything. A 403 or 404 from the API renders the same
404, so non-moderators, revoked grants and disabled deployments cannot tell that the screen exists.
There is no navigation entry; moderators open the URL directly.

Tabs list `proposed`, `validated`, `rejected` and `removed` submissions 20 per page. Each card shows
the frozen organization, skill, version, checksum and submission IDs, dates, any decision reason,
and the check summary (`passed`, `failed` with its reason, or `pending`). Validate is enabled only
for proposals whose checks passed; the API still enforces this. Reject, remove (validated rows) and
ban organization require a nonblank reason of at most 2000 characters. API conflicts stay in the
confirmation dialog; success refreshes the queue.

The Reports tab is the slot for incoming skill reports from PR 7/9. Until that API exists the page
loader returns `{ status: "unavailable" }` and the tab says reporting is not connected. PR 7 plugs in
by returning `{ status: "ready", reports }` from `loadCatalogSkillReports` in
`apps/web/src/lib/catalogModerationData.ts`, using `CatalogSkillReport` from
`apps/web/src/lib/catalogModeration.ts` (`id`, `org_id`, `skill_id`, nullable `submission_id`,
`reason`, nullable `details`, `created_at`). The queue response carries IDs only, not skill or
organization names, so the screen shows IDs.

## Later publishing PRs

PR 2/9 adds submissions and frozen validated versions, stacked on PR #26's org-only catalog API.
PR 4/9 adds the moderator API and report-consumer boundary independently of PR 3's checks engine.
PR 8/9 adds the moderator web screen. Later PRs add anonymous installs by slug and frontend workflows. Share tokens remain separate and
excluded from every listing and catalog response. Self-hosted deployments remain disabled by default;
enabling the catalog on managed hosting remains a deployment decision.

## Anonymous reporting (PR 7/9)

`POST /v1/public/catalog/skills/:orgSlug/:skillSlug/reports` accepts anonymous JSON:
`{ "reason": "secret_exposure" | "malicious" | "license" | "spam", "details"?: "…" }`.
The public skill page offers a **Signaler** disclosure with the four motifs **Secret exposé**,
**Malveillant**, **Licence**, and **Spam**, plus optional text. Text is limited to 2000 characters;
unknown fields, missing/invalid reasons and malformed JSON return 400. The request limit is 16 KiB
(413). Accepted reports return 201 `{ "ok": true }`, without exposing a report ID or text.
Only currently validated, listed, active organization skills can be reported; all other targets
and a disabled catalog return 404. Reports never change publication state automatically.

PostgreSQL serializes admission by anonymous source across API processes, allowing five accepted
reports in a rolling hour across all skills/organizations (429 with `Retry-After: 3600`). A separate
process admission cap of 60 attempts per minute includes malformed requests (429, retry after 60s).
Only an HMAC-SHA256 of the connection IP is persisted, keyed by the existing `BETTER_AUTH_SECRET`
with a reporting-specific prefix. IPv4-mapped IPv6 is normalized. Raw IPs and submitted text are
never logged by this handler. Forwarding headers are not trusted: a reverse proxy's clients share
its conservative quota. A missing connection IP or auth secret shorter than 32 characters, or a
storage failure, returns 503 and does not acknowledge a report. Key rotation resets source quotas.

`GET /v1/platform/catalog/reports?limit=20&offset=0` is part of the platform moderation queue from
PR #34. It uses the same live moderator grant, browser-session-only authority, pagination bounds,
default-off flag and `no-store` responses. Rows include report/skill/org IDs, snapshotted slugs,
the validated submission ID, reason, optional text and timestamp, oldest first. Abuse hashes are
omitted. Reports remain visible after unlisting/removal so moderators can use the existing
submission removal or organization ban actions. Organization members, including Owner/Admin,
PATs, agents, anonymous callers and worker credentials cannot read reports. No tenant write can
create or modify them; the API receives only narrow reporting/queue security-definer grants.

**Stan responds to reports within 48 hours.** This is an operational moderation commitment, not
an automated notification or resolution timer. This PR sends no email and collects no reporter
contact information. Moderators review optional text as untrusted confidential content; reporters
should describe exposure without pasting secret values.

Apply additive migration `0197_catalog_reporting` and runtime grants before the API. It creates
no reports for existing listings and changes no listing state. The detail page is ported from
PR #35 with the minimal helpers needed for the form; index pages, sitemap and publishing UI remain
owned by their respective PRs. Both web and API keep `SKILLPACK_PUBLIC_CATALOG` default off.
