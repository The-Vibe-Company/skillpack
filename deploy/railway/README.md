# Railway deployment

Deploy `api`, `worker`, `web`, and the one-shot `release` service with the supplied configs.
The backend Dockerfile accepts only api, worker, or release. Release runs the migration-owner
entrypoint; API and worker boot directly from the same build after migration succeeds.

API receives its restricted DATABASE_URL, auth, email, object storage, and skill secret encryption
configuration. Worker receives its own restricted DATABASE_URL and only configured GitHub, billing,
and Skill Database cleanup credentials. Web receives the API origin and public client settings.
No service needs Box, Pi, APNs, provider MCP, or desktop-HMAC credentials.

## Authentication client IPs

The API defaults Better Auth's `advanced.ipAddress.ipAddressHeaders` to `["x-real-ip"]`.
[Railway's public edge](https://docs.railway.com/networking/public-networking/specs-and-limits#technical-specifications)
sets `X-Real-IP` to the remote client's address, including for the custom API domain
`api.thecompanion.sh`. Send public auth traffic through that edge; private-network or direct
container callers bypass its header sanitization and must be trusted separately.

Better Auth 1.7.14 defaults to `x-forwarded-for` and accepts only single IP values unless
`trustedProxies` is configured. A comma-separated forwarded chain therefore causes its
shared per-path rate-limit bucket and warning. Hono's Node adapter preserves incoming headers
in `c.req.raw`, which the API passes to the auth handler; it does not supply the socket peer
to Better Auth. We leave `trustedProxies` unset: it only parses a header chain and does not
authenticate the sender, and we have no verified stable Railway/Vercel proxy CIDRs.

`skillpack.app` uses Vercel external rewrites for `/auth/*` and `/mcp` to the public API.
[Vercel documents](https://vercel.com/docs/headers/request-headers) the visitor's address in
`x-vercel-forwarded-for`, `x-forwarded-for`, and `x-real-ip` at its ingress. At Railway's
ingress, `x-real-ip` identifies the peer reaching Railway, which can be Vercel's egress
instead of the visitor. Such visitors can share a proxy-IP bucket; this fix does not
guarantee per-visitor limits through Vercel. Do not prefer `x-vercel-forwarded-for` on the
public API: a caller can bypass Vercel and forge it. Host, Origin, and `x-vercel-id` do not
authenticate that hop. Preserving visitor IPs safely requires an authenticated proxy path
that overwrites the selected header and prevents direct callers from supplying it.

For another trusted ingress, set **API-only** `BETTER_AUTH_IP_HEADERS` to an ordered,
comma-separated list of header names. It replaces the default; names are trimmed,
lowercased and deduplicated. Unset/blank uses `x-real-ip`; invalid names fail startup.
Only select headers the ingress overwrites and only when callers cannot bypass it.
No `x-forwarded-for` or vendor-header fallback is enabled by default. Invalid, missing,
or multi-value `x-real-ip` still fails closed to Better Auth's shared bucket and warning
in production. Development/test retains Better Auth's localhost fallback; rate limiting
and durable secondary-storage counters remain enabled in every environment.

For historical migration replay, release receives DATABASE_MIGRATION_URL, DATABASE_API_ROLE,
DATABASE_WORKER_ROLE, and DATABASE_COMPANION_RUNTIME_ROLE. The last variable identifies only a
legacy compatibility role; no hosted runtime service is deployed. A retired union role may additionally
require DATABASE_RETIRED_RUNTIME_ROLE during historical cutover. See `.env.example`.

An existing hosted installation must complete [external resource retirement](../../docs/companions-runtime.md)
with its previous release before upgrading. Migration 0186 refuses to erase live ownership inventory.

## Historical skill reporting rollout

The release command automatically retrofits every existing published version after migrations 0189
and 0190. Supply release with the same `BETTER_AUTH_URL` (public origin; `COMPANION_API_URL` fallback)
and S3 archive configuration as the API. The migration-owner connection must own `skill_versions`.
An empty instance needs no storage access. Schema-only tests may call exported `run()`; the deployed
`node dist/migrate.js` always includes the retrofit. Missing origin, storage or corrupt packages fail
the release; fix the cause and rerun it to resume from the last committed version.

Version numbers, library scope and release selection remain unchanged. Content checksums change,
so installed copies receive an update indication and must be downloaded again. Old pinned checksums
intentionally no longer describe the refreshed version. Previously issued transfer tickets are revoked.
The same stable public link serves a newly checksummed ZIP. No scripts in a package are executed.

Rollback: stop new deployments, use `skill.usage_reporting_rewrite` audit metadata to locate original
objects and checksums, verify their canonical tar hashes, and restore each version's storage path,
size, checksum and SKILL.md body in one transaction with its old public checksum/size tuple (only if
that version is still selected publicly). Original tar/ZIP objects are retained. Keep revision 1 to
prevent an immediate reapplication; restore the prior application build if abandoning the rollout.
Preserve installed checksums and queue affected GitHub mirrors after an operational rollback.
