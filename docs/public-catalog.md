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

## Automated submission checks (PR 3/9)

Core checks the exact frozen public ZIP bytes against the stored SHA-256 and byte size **before**
unpacking. Missing bytes, checksum/size substitution and malformed or unsafe archives fail closed.
The report is persisted in `catalog_submissions.check_report` (migration `0194_catalog_checks`) in
the submission transaction. Admin conversion rechecks the then-current release; repeated open
proposals remain idempotent. These checks never execute package scripts or enable listing visibility.
Historical proposals have no backfilled report and cannot be validated until freshly submitted.

The authenticated listing response exposes `{ version: 1, passed, findings }`, or `null` for an
unchecked historical proposal. Findings contain only `rule_id`, `severity` (`blocking` or `warning`),
and optional file `path` and one-based `line`. Secret-shaped paths are redacted. Reports are never
included in anonymous catalog responses.

- `SKILL.md` must have valid frontmatter using the existing parser: a name and nonempty description,
  kebab-case name matching the skill slug, and exactly `MIT` or `Apache-2.0` as the license.
  Wrapper directories are supported; multiple equally shallow `SKILL.md` roots are rejected.
  Missing/empty licenses, expressions, noncanonical case, free text and file references are rejected.
  LICENSE contradictions are checked only when recognizable without inferring legal meaning.
- Every file is scanned, including nested paths and paths excluded by ordinary packing rules.
  In-process regex rules cover AWS keys, GitHub tokens, private-key PEM, Slack, Stripe, JWTs and
  high-entropy `api_key`/`secret` assignments, plus share-link and `install --public` tokens.
  `.gitleaks.toml` extends an external default ruleset rather than defining usable in-process rules;
  the catalog uses its own tested rule set without the repository's fixture allowlists.
- Blocking heuristics cover ELF/Mach-O/PE magic, available executable mode bits, downloaded shell
  pipelines, base64 decoding followed by execution, and URL shorteners. Size limits reuse
  [package upload constants](../packages/skills/src/constants.ts): 25 MiB aggregate expanded bytes,
  10 MiB per file, 1 MiB for the selected `SKILL.md`, and 2,000 entries. Compressed packages are
  also capped at 25 MiB.
- A trimmed `SKILL.md` body shorter than 100 characters produces a nonblocking warning.

Heuristics detect known patterns, not every possible secret or malicious instruction. Passing checks
leaves the submission `proposed` for moderation; it is not a security certification.

Only validation enables discovery. Developer requests cannot be validated. Production moderation
requires a passing automatic check report for the exact frozen version and package checksum.
The internal `applyValidatedSubmission` primitive remains for lifecycle tests; production decisions
use the moderator boundary below.

A listed skill continues serving the previously validated snapshot while a new public release is
promoted or proposed. Validation of a newer submission replaces that catalog version atomically.
The catalog reads the latest validated submission's frozen version, checksum, size and files, never
the mutable public release pin or a later private draft. There is no submission backfill.

## Publishing UI

When the web also has `SKILLPACK_PUBLIC_CATALOG=true`, the public release dialog adds a Public
catalog section; otherwise it renders nothing and makes no catalog request. It reads
`GET /v1/skills/:slug/public-listing` and shows one phase: not published, requested, proposed,
published, rejected (with the reason), or removed (unpublished or withdrawn). Owner/Admin see
Publish to catalog (`PUT` true, also converting an open Developer request) and Unpublish, Withdraw
submission or Decline request (`PUT` false). Developers see Request publication (`POST .../request`)
and no withdrawal. Personal skills get an explanation instead of controls. A public release is
required, and the section states that only MIT or Apache-2.0 licensed skills are accepted.

The status names no version, so a published skill's frozen version is read from the anonymous
catalog entry with credentials omitted. A proposal shows its version only when it was submitted from
the open dialog. Publish is offered again only when the public release differs from the frozen one.

## Catalog pages

The web serves `/catalog` (paginated with `?page=`, 20 skills per page) and
`/catalog/:orgSlug/:skillSlug` only when its own `SKILLPACK_PUBLIC_CATALOG=true`; otherwise both
return 404 without calling the API. Pages render on every request from the anonymous API, so
unlisting, withdrawal and archiving take effect immediately; an API 404 is a page 404.

A skill page shows only API fields: name, description, workspace name, frozen version, validation
date, checksum, size, file list and the rendered `SKILL.md`. Raw HTML in the body is dropped and
authored links carry `rel="nofollow ugc"`. The install section shows `skillpack auth login` and
`skillpack install <slug> --version <version>`, which resolve only for members of the listing
workspace; share tokens are never shown. JSON-LD states only API fields (`SoftwareSourceCode` plus
breadcrumbs on skill pages, a `CollectionPage` item list on the index).

`sitemap.xml` lists `/catalog` and every skill the anonymous API returns, which means validated and
listed only. A disabled or failing API leaves the rest of the sitemap intact.

The earlier build-time catalog served official skills at `/catalog/:slug`. Those URLs redirect with
301 to `/catalog/the-vibe-company/:slug`; official skills are published through the same submission
flow as any other organization skill.

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
