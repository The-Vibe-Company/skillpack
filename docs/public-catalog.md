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
values are `proposed`, `validated`, `rejected`, and `withdrawn`. Every implemented transition writes
an audit event in the same transaction. A rejected proposal can be followed by a fresh proposal;
rejection is a fixture-only transition in this PR, pending the moderation API.

Only validation enables discovery. The internal core seam `applyValidatedSubmission` is called by
tests in this phase and has no HTTP or MCP endpoint. It accepts only an active proposed `submission`,
records the decision and sets listing visibility atomically. Developer requests cannot be validated.
Stan owns moderation; automated checks and the moderator API arrive in PRs 3 and 4 respectively.

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

## Later publishing PRs

PR 2/9 adds submissions and frozen validated versions, stacked on PR #26's org-only catalog API.
It contains no checks engine, moderator API, catalog install command, or frontend; PR 5/9 adds the
publishing UI above and PR 6/9 the catalog pages. Later PRs add
MIT/Apache-2.0 enforcement, validation and moderation, and anonymous installs by slug. Share tokens
remain separate and excluded from every listing and catalog response. Self-hosted deployments
remain disabled by default; enabling the catalog on managed hosting remains a deployment decision.
