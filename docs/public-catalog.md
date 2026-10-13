# Public catalog backend

The anonymous catalog is disabled unless `SKILLPACK_PUBLIC_CATALOG=true`. Existing skills remain
unlisted, including existing public releases. Listing is a separate explicit consent decision;
creating or promoting a public release does not opt a skill into discovery.
The catalog includes organization skills only. Personal skills must first be shared with the
organization before public release promotion or listing.

## API

- `PUT /v1/skills/:slug/public-listing` with `{ "listed": true }` or `{ "listed": false }`
  uses the authenticated selected workspace and `skills:write` authority. Only organization skills
  can be listed, and listing requires Owner/Admin. Developers cannot list directly.
  Listing requires a complete public release. Changes write audit events.
- `GET /v1/public/catalog/skills?limit=20&offset=0&label=engineering` is anonymous.
  `limit` is 1–50 and `offset` is 0–10000. The optional label is an exact organization label path;
  personal labels are private and are never used for discovery. Results are ordered by organization
  slug and skill slug. `next_offset` is null for a short page or the pagination bound; a full final
  page may be followed by an empty page.
- `GET /v1/public/catalog/skills/:orgSlug/:skillSlug` is anonymous and returns 404 when unlisted,
  personal, archived, missing, or disabled. Both paths use existing slugs; the organization slug is already
  unique, and organization name edits do not change it.

Each skill contains only `org_name`, `org_slug`, `skill_slug`, `name`, `description`, `version`,
`released_at`, `checksum`, `size_bytes`, `body`, and `files` (`path`, `size_bytes`). The instructions,
name, description and file list come from the pinned public version, never a later draft or current
private version. The checksum and size describe the existing public ZIP release. A nullable `public_package_files`
snapshot stores its file paths and sizes; it is populated from verified release bytes at promotion or
first listing, so older unlisted releases need no backfill. No member identity,
share token, activity statistics, secret declarations or storage path is serialized. Authored
instructions and file names are intentionally public when an organization Owner/Admin consents to listing.

Responses support ETag caching with mandatory revalidation: every request checks current listing
consent before a 304, so unlisting and disabling the flag take effect immediately. Errors use
`no-store`. A process-wide cap of 600 requests per minute follows the existing anonymous usage
route pattern and does not trust forwarding headers or retain IP addresses.

Unlisting leaves the public release and share token intact. Withdrawing a release removes discovery
consent atomically. Archiving also withdraws listing consent; restoring requires a fresh opt-in. No web pages, robots/sitemap changes, catalog install command or moderation
workflow are provided in this phase. The backend flag defaults off on every deployment, including
self-hosted instances.

## Later publishing PRs

The approved plan will add Developer publication requests, MIT/Apache-2.0 license enforcement,
and anonymous installs by slug for published skills. This backend keeps the PUT listing consent
semantics; submissions and catalog installs are not implemented in this PR. Share tokens remain
excluded from catalog responses.

## Pending decisions

- Moderation ownership, report handling and SLA; listing-specific credential scanning and bans.
- Whether managed hosting should enable the catalog; self-hosted deployments default off.
- Redirect policy for future slug renames. Existing public-release rename restrictions apply.
