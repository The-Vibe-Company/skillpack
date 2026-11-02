# IndexNow

The public ownership key is `498a19c36795d0a81cb9c7d2a398d449`, not a secret.
`apps/web/public/498a19c36795d0a81cb9c7d2a398d449.txt` contains exactly that key,
without a newline. `apps/web/next.config.ts` sets `text/plain; charset=utf-8`.
Middleware passes this path through; no rewrite matches it. The canonical host is
`skillpack.app`; `www.skillpack.app` redirects there.

## Automatic notifications

This follows [website PR #301](https://github.com/The-Vibe-Company/website/pull/301),
adapted to pnpm, Node.js and Skillpack's monorepo and blog paths.
`.github/workflows/indexnow.yml` listens only to `deployment_status`, requiring
`success`, environment `Production`, and creator `vercel[bot]`. It checks out the
deployed SHA and proves it is contained in `origin/main` before running code.
Vercel uses a SHA for `deployment.ref`; ancestry establishes the equivalent main
guard. Only then are `VERCEL_ENV=production` and `VERCEL_GIT_COMMIT_REF=main` set.
The script rechecks the event, creator, environment, ancestry and checkout SHA.
Preview/local environments cannot submit.

The script diffs the previous successful Vercel Production deployment against the
new deployed SHA, including previously successful deployments now marked inactive.
This covers multiple commits shipped together. A missing baseline (or one unavailable
in Git) selects all live canonical URLs; API/history errors skip the notification.

`https://skillpack.app/sitemap.xml`, including nested sitemap indexes, is the URL
authority. Only existing HTTPS URLs on `skillpack.app` are submitted:

- `apps/web/content/blog/<slug>.md` selects `/blog/<slug>` and `/blog`.
  Blog validation already requires frontmatter slugs to match filenames.
  Renames/deletions select only URLs still present in the live sitemap.
- Shared web source, public assets, fonts, other web content, Next configuration,
  or workspace package source select the entire sitemap, including public catalog URLs.
- Docs, tests and notification tooling alone select nothing.

The first deployment of this integration therefore selects the sitemap because
it adds public assets and Next configuration. Subsequent documentation-only changes
select nothing. URLs are deduplicated, sorted and batched at most 10,000 per POST to
`https://api.indexnow.org/indexnow` with `{ host, key, keyLocation, urlList }`.
Before any POST, the production proof must return a successful `text/plain` response
whose body equals the key exactly. Redirects are rejected; each request times out
after 8 seconds. Errors are logged and resolve with exit 0. The separate workflow
is best effort (`continue-on-error`) and cannot block a deployment/build.
Only GitHub's built-in read-only token is used; no custom secret is needed.
Repeated notifications are safe.

## Manual inspection

With Node.js 22.18+ (or 24), inspect the live sitemap and all payloads without POST:

```sh
pnpm indexnow:submit-all --dry-run
# npm equivalent:
npm run indexnow:submit-all -- --dry-run
```

This reads the production sitemap and prints the selected URL count and JSON batches.
Agents must use `--dry-run` only. A production operator can deliberately submit all
by omitting `--dry-run` with both production/main environment variables set; never
set those variables to submit from a preview/local environment.

## Verification and key rotation

`pnpm --filter @skillpack/web test` includes mocked network tests for selection,
proof checks, production guards, sitemap indexes, batching and ignored failures.
Check the running app's key path for HTTP 200, `text/plain`, exact bytes, and no
redirect, including with `Accept: text/markdown`. No test sends real notifications.

To rotate the public key, update `INDEXNOW_KEY` in `apps/web/src/lib/indexnow.ts`,
the matching file in `apps/web/public`, the exact public-value exception in
`.gitleaks.toml`, tests and this document. The Next header
uses the exported `INDEXNOW_KEY_PATH` automatically.
Deploy the proof before expecting notifications; missing proof skips POSTs.
