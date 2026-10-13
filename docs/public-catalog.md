# Public catalog backend

The anonymous catalog is disabled unless `SKILLPACK_PUBLIC_CATALOG=true`. Existing skills remain
unlisted, including existing public releases. Listing is a separate explicit consent decision;
creating or promoting a public release does not opt a skill into discovery.
The creator can pin a personal release for catalog listing; existing token preview/install routes
retain their organization-skill boundary. Listing does not share the personal library with members.

## API

- `PUT /v1/skills/:slug/public-listing` with `{ "listed": true }` or `{ "listed": false }`
  uses the authenticated selected workspace and `skills:write` authority. Organization skills
  require Owner/Admin; personal skills require their creator, without an administrator override.
  Listing requires a complete public release. Changes write audit events.
- `GET /v1/public/catalog/skills?limit=20&offset=0&label=engineering` is anonymous.
  `limit` is 1–50 and `offset` is 0–10000. The optional label is an exact organization label path;
  personal labels are private and are never used for discovery. Results are ordered by organization
  slug and skill slug. `next_offset` is null for a short page or the pagination bound; a full final
  page may be followed by an empty page.
- `GET /v1/public/catalog/skills/:orgSlug/:skillSlug` is anonymous and returns 404 when unlisted,
  archived, missing, or disabled. Both paths use existing slugs; the organization slug is already
  unique, and organization name edits do not change it.

Each skill contains only `org_name`, `org_slug`, `skill_slug`, `name`, `description`, `version`,
`released_at`, `checksum`, `size_bytes`, `body`, and `files` (`path`, `size_bytes`). The instructions,
name, description and file list come from the pinned public version, never a later draft or current
private version. The checksum and size describe the existing public ZIP release. A nullable `public_package_files`
snapshot stores its file paths and sizes; it is populated from verified release bytes at promotion or
first listing, so older unlisted releases need no backfill. No member identity,
share token, activity statistics, secret declarations or storage path is serialized. Authored
instructions and file names are intentionally public when the creator consents to listing.

Responses support ETag caching with mandatory revalidation: every request checks current listing
consent before a 304, so unlisting and disabling the flag take effect immediately. Errors use
`no-store`. A process-wide cap of 600 requests per minute follows the existing anonymous usage
route pattern and does not trust forwarding headers or retain IP addresses.

Unlisting leaves the public release and share token intact. Withdrawing a release removes discovery
consent atomically. Archiving also withdraws listing consent; restoring requires a fresh opt-in. No
catalog install command or moderation workflow is provided in this phase. The backend flag defaults
off on every deployment, including self-hosted instances.

## Web

The web reads the same `SKILLPACK_PUBLIC_CATALOG` flag; set it on both the API and web services.
While it is off, catalog pages return 404 and the sitemap omits them.

- `/catalog` (paginated with `?page=`) and `/catalog/:orgSlug/:skillSlug` are server-rendered on
  every request, anonymous, and indexable. `/skills` remains the authenticated library. A skill page
  shows the pinned release's name, description, version, release date, checksum, size, file list and
  rendered `SKILL.md` (raw HTML is not rendered; authored links are `nofollow ugc`). Its install
  section shows `skillpack auth login` and `skillpack install <slug> --version <version>`, which
  resolve only for someone with access in the listing workspace; the share token is never shown.
- `sitemap.xml` adds `/catalog` and every listed skill when the flag is on. Share pages
  (`/s/:token`) keep their noindex meta tag, and `robots.txt` does not disallow any path.
- The "Manage public link" dialog shows a "List in the public catalog" toggle to the actors the
  backend allows (org Owner/Admin; the personal-skill creator), enabled only while a public release
  exists. No authenticated skill read returns `listed_publicly` yet, so the dialog reads the current
  state from the anonymous catalog skill endpoint and writes it with `PUT /v1/skills/:slug/public-listing`.

## Pending decisions

- Moderation ownership, report handling and SLA; listing-specific credential scanning and bans.
- Slug-based install support: the runtime still installs public packages using share tokens.
- Whether managed hosting should enable the catalog; self-hosted deployments default off.
- Redirect policy for future slug renames. Existing public-release rename restrictions apply.
