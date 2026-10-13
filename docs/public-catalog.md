# Public catalog backend

The anonymous catalog is disabled unless `SKILLPACK_PUBLIC_CATALOG=true`. Existing releases remain
unlisted. Catalog publication is a separate explicit decision from public release promotion and
share-link access. Only organization skills can be submitted; personal skills must first be shared.

## Publication API

All listing routes require authentication in the selected workspace, recheck live membership, and
reject cross-tenant access. Personal skill status stays creator-private and personal publication is
rejected. Responses and audit metadata never include share tokens. Listing responses use `no-store`.

- `PUT /v1/skills/:slug/public-listing` requires `skills:write` and Owner/Admin.
  `{ "listed": true }` creates a submission containing the current public version ID,
  exact ZIP checksum, byte size and file snapshot. It requires a complete, unarchived organization
  public release and verifies release bytes before recording the proposal. It does **not** enable
  discovery. Automated blocking checks must pass for it to remain `proposed`; failures are `rejected`.
  If a Developer request is open, the PUT converts it to a submission, preserves its
  requester, records the submitting admin and freezes the release current at approval time.
- `POST /v1/skills/:slug/public-listing/request` with `{}` requires `skills:write` and Developer.
  It creates an inert row of kind `publish_request`, awaiting Owner/Admin submission if checks pass.
  The release is frozen in the request too; admin submission refreshes that snapshot to the then
  current release. Owner/Admin submit directly with PUT.
- `GET /v1/skills/:slug/public-listing` requires `skills:read` and organization membership.
  It returns `listed_publicly`, `listed_at`, `latest_submission` (nullable `{ id, status, kind }`),
  `rejection_reason`, `check_report` and `can_manage_listing`. Mutation responses add `changed`.
- `{ "listed": false }` on PUT immediately unpublishes and withdraws any open request/submission.
  The public release and share token stay intact. Archiving or withdrawing the public release also
  clears discovery and withdraws open submissions atomically. Restoration needs a fresh submission.

`catalog_submissions` uses tenant RLS, organization-bound skill/version foreign keys, and a partial
unique index allowing at most one `proposed` row per skill. Repeating a proposal for the same release
is idempotent; an open submission for different release bytes must first be withdrawn. The status
values are `proposed`, `validated`, `rejected`, and `withdrawn`. Every implemented transition writes
an audit event in the same transaction. A rejected proposal can be followed by a fresh proposal;
automated rejection records the initiating member as `decided_by`, a decision timestamp, and a
`catalog_submission.rejected` audit event. `rejection_reason` is a comma-separated list of blocking
rule IDs. Neither reports nor audits contain matched values, snippets, or parser error text.

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

Only validation enables discovery. The internal core seam `applyValidatedSubmission` is called by
tests in this phase and has no HTTP or MCP endpoint. It accepts only an active proposed `submission`,
records the decision and sets listing visibility atomically. Developer requests cannot be validated.
Stan owns moderation; the moderator API arrives in PR 4.

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

## Later publishing PRs

PR 3/9 adds automated submission checks, stacked on PR #32's frozen submissions, which is stacked
on PR #26's org-only catalog API. Later PRs add the moderator API and anonymous installs by slug.
This backend phase contains no catalog install command or frontend. Share tokens
remain separate and excluded from every listing and catalog response. Self-hosted deployments
remain disabled by default; enabling the catalog on managed hosting remains a deployment decision.
