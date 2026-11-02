# Preview performance guardrails

THE-2182 adds `.github/workflows/perf-guardrails.yml`. Stan explicitly authorized this
workflow and its triggers in the ticket request. It never submits IndexNow notifications.

The `pull_request` job runs unit tests and checks changed blobs, with read-only permissions
and no secrets. It also runs on title/body/label edits. The trusted `pull_request_target`
path refreshes the sticky comment and the head-SHA check for those metadata changes.
Successful Vercel `deployment_status` events outside Production trigger mobile Lighthouse.
The deployment SHA must match exactly one current open PR's head; stale or ambiguous
deployments are neutral. Resolution and publication use paginated, bounded GitHub calls.

Privileged jobs check out the default branch, install with `--ignore-scripts`, and fetch
PR commits only into Git's object database. PR blobs are parsed as data; PR code and package
scripts are never executed there. Forks use this same boundary. Bypass headers go only to
the verified HTTPS `*.vercel.app` preview origin, including its same-origin assets, and
never to production, redirect destinations, or third parties. Each Lighthouse child has
no GitHub token. Full Lighthouse reports, headers, provider error bodies and secrets are
never printed or uploaded. Only numeric metrics leave the child.

## Budgets

| Check | Policy |
| --- | --- |
| Preview median CLS >0.05 | Blocking, independently of production availability |
| Preview LCP >production by **both** 20% and 300 ms | Warning by default |
| Preview TBT >production by 100 ms | Warning by default |
| Changed raster >200 KiB (204,800 bytes) | Blocking; PNG, JPG/JPEG, WebP, AVIF, GIF, BMP, ICO, TIFF |
| Changed SVG >50 KiB (51,200 bytes) | Blocking |
| Changed PNG/JPG/JPEG >100 KiB | Warning recommending WebP/AVIF, including files also above the blocking cap |
| Definite image priority/preload/high fetch priority inside inline `.map()` or JSX arrays | Blocking: repeated hints compete for early mobile bandwidth |
| Definite priority image on or under literal mobile-hidden classes | Blocking: includes `hidden sm:block`, `hidden md:flex`, `max-sm:hidden` |
| More than two definite image hints in one changed JSX source file | Blocking conservative source budget |
| More than two explicit image hints on a rendered mobile page | Warning: composed imports and responsive srcsets can make deduplication approximate |
| Dynamic flags, spreads or visibility | Warning: static analysis cannot prove the active mobile state |
| Added/modified file under a `screenshots/` segment | Blocking, including `screenshots/pr-XXX`; deleted files are ignored |
| PR title, body or label containing `DO NOT MERGE` (case insensitive) | Blocking; ordinary draft state is allowed |

Limits use strict `>` comparisons. The byte units above define “Ko” for this check.
Asset sizes come from `git cat-file -s`, without decoding images. The merge-base diff
includes added/modified/type-changed files and rename destinations (renames become delete
plus add); removed files and unchanged historical assets are excluded. A 519 KiB logo
is represented by metadata in a unit fixture, not a committed large binary.

Set the repository Actions **variable** `PERF_REGRESSION_BLOCKING=true` to make the LCP
and TBT regressions blocking too. The script accepts the environment variable of the same
name, so no code changes are needed. CLS always blocks when at least three valid preview
samples exist. No branch-protection setting is changed by this PR; an owner can select
`Performance guardrails` and `Asset, preload and leftovers guardrails` as required checks
when the rollout is approved.

## Measurements and reporting

Pages are `/` and the checked-in, stable `/blog/what-is-skill-md`. Production is the real
HTTPS site, `https://skillpack.app`. For each page, one runner measures
`prod, preview, prod, preview, prod, preview`, with a fresh Chrome instance per run and
the same pinned Lighthouse/mobile simulated throttling settings. Incomplete pairs are
retried in the same alternating order, up to five pairs. At least three valid samples
per side are required for its median. Medians are calculated separately for score,
LCP, TBT and CLS; no missing result becomes a zero. A regression comparison requires
both sides, while valid preview CLS can still be evaluated without production.

GitHub check `Performance guardrails` is explicitly attached to the PR head SHA; the
deployment workflow's own check otherwise belongs to the default branch. A single
bot-owned comment marked `<!-- skillpack:perf-guardrails -->` is created or updated,
with median/delta tables and static-check results. Metadata edits preserve measurements
for the same head only. Duplicate marked bot comments are reconciled after retries.
The job summary also contains the results. Report jobs serialize by PR and recheck the
head immediately before publication; obsolete deployments cannot overwrite a new head.
Incomplete reruns retain prior measurements and proven violations for the same head and
page until a complete valid comparison replaces them; a network failure cannot erase a
previous CLS failure. An unavailable changed blob does not suppress checks on other
files or on PR metadata.

Network failures, quota, unavailable dependencies, missing/unsupported previews, HTTP
errors, unexpected redirects, protected previews and fewer than three valid samples
produce warnings/neutral conclusions, never a synthetic performance failure. An already
proven static or CLS violation still blocks even if another measurement is unavailable.
Git/fetch, API/probes, each audit process, Chrome cleanup and jobs all have timeouts;
external operations have bounded retries. Runner cancellation or a platform outage can
still interrupt a job; those are not budget violations.

## Setup and validation

For protected previews add the GitHub Actions **secret**
`VERCEL_AUTOMATION_BYPASS_SECRET`, containing the project's Vercel Protection Bypass for
Automation token. Missing or rejected bypass credentials leave protected previews neutral;
public previews need no secret. `GITHUB_TOKEN` is supplied automatically by Actions for
SHA resolution, comments and checks. No Lighthouse CI server token is required.

New `deployment_status` and `pull_request_target` workflows become active only after
the workflow and trusted scripts exist on the default branch. This draft's ordinary
PR job exercises the scripts and blocking fixtures immediately; an existing preview
alone cannot activate a workflow absent from the default branch. After rollout,
redeploy a PR preview to exercise measurements and sticky publication. GitHub must
allow this trusted `pull_request_target` workflow under its workflow execution policies.

```bash
pnpm install --frozen-lockfile
node --test scripts/perf-*.test.mjs
pnpm exec oxlint scripts/perf-*.mjs
pnpm verify:change
```

Tests cover blocking fixtures, byte/metric boundaries, alternating runs, outliers,
protection, failed/missing audits, exact SHA association, bounded retries, pagination,
sticky updates, metadata changes and stale heads. JSX analysis uses TypeScript's parser,
ignoring comments and string literals. It recognizes native `img`, `Image`, Next Image
default aliases and image-preload links; `false` flags and low/auto fetch priority do not
count. It does not resolve imported component graphs, named callbacks, runtime branches,
CSS files, or computed classes. Review warnings in those cases. The rendered mobile-page
hint warning complements this deliberate static limitation.

PostHog is outside this change. `apps/web/src/app/PostHogProvider.tsx` already waits
for the first pointer/keyboard/scroll/wheel/touch interaction or eight seconds after
window load; `apps/web/src/lib/analytics.ts` dynamically imports `posthog-js` only when
initialized in production with a project token. Signup reporting and authenticated
identity components can initialize earlier. Neither file is modified here.

References: [Lighthouse Node usage](https://github.com/GoogleChrome/lighthouse/blob/main/docs/readme.md),
[Vercel automation bypass](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation),
[GitHub trusted PR workflow security](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target).
