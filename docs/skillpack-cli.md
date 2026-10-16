# Native Skillpack CLI

The release archive provides `skillpack` and the backwards-compatible `skillpack-runtime` collector for macOS, Linux and Windows, on amd64 and arm64. Management commands need neither Python nor Node. The OpenCode bridge runs in its host's JavaScript runtime.

## Install and connect

Download `install.sh` or `install.ps1` from the latest official `runtime-v*` GitHub release and run it with the platform shell. Release generation injects the expected digest for every target into the installer. The checked-in template intentionally refuses to install before that generation step. Installers download only over HTTPS and validate the archive before executing its binaries.

The stable command is `~/.local/bin/skillpack` on POSIX or `%LOCALAPPDATA%\Skillpack\bin\skillpack.exe` on Windows. Add that directory to your shell PATH if needed. Version slots and the installation receipt live under the private OS configuration directory's `skillpack/cli` subdirectory. `SKILLPACK_HOME` overrides the management state root; `SKILLPACK_RUNTIME_HOME` independently overrides usage state. Defaults match Go's user configuration directory: Application Support on macOS, APPDATA on Windows, XDG_CONFIG_HOME on Linux.

Approve the CLI in your browser. The CLI prints the URL even if it cannot open a browser:

```sh
skillpack auth login
skillpack auth status --json
skillpack setup --tools codex,claude-code,opencode
```

For a self-hosted instance, pass `--api-url <base>`. The browser approval shows the selected workspace and full key access before consent. The approval URL carries only a request ID; a separate private verifier lets the CLI redeem the key once within five minutes. No key is shown on the page or printed by the CLI. For automation, inject `SKILLPACK_API_KEY` through the runner's secret environment. `SKILLPACK_API_URL` is needed for a non-default instance. The CLI never accepts a key argument. `--token-stdin` supports a trusted private pipe, and `--manual` uses a hidden terminal prompt. New human keys have all current capabilities; existing keys retain their original scope set, expiry and revocation rules. All organization membership, secret audience and personal database access checks still apply.

`--profile NAME` selects a saved connection. An API override cannot send its saved key to another instance. Environment keys remain ephemeral. Logout only removes local credentials; refresh explicitly rotates a saved key and does not widen capabilities.

Cobra provides per-command help, typo suggestions and shell completion. The default output is readable in a terminal; `--json` preserves structured output for scripts and agents. Run `skillpack completion zsh` (or `bash`, `fish`, `powershell`) to generate the appropriate completion script.

## Packages and repository installs

```sh
skillpack install plan-pr --scope project --project ./repository
skillpack update --all --dry-run --json
skillpack update --all --json
skillpack sync --frozen --project ./repository --json
```

Project installs use `.agents/skills` plus managed host discovery copies and relative paths in `.companion/skills.lock.json`. Commit packages and that lock to make them discoverable after a cloud clone. Runtime lock files and `.skillpack-stage-*` / `.skillpack-backup-*` files are temporary coordination artifacts; do not commit them. No AGENTS.md or CLAUDE.md edit is needed.

An exact `--version` pins a skill; `--pin` pins the current version. Updates preserve pins and local edits, and report each root independently. Each root's dependency closure, secret projections and lock change are staged before activation. Recovery rolls back an interrupted transaction before starting another. Never interpret an overall nonzero exit as success merely because another root updated.

Frozen sync verifies committed copies offline and can restore a missing copy from another verified target. For authenticated registry skills, if every copy is missing, it needs credentials matching the locked API and organization to download the exact checksum and version. Catalog and GitHub sources restore anonymously when still publicly available. It never changes the lock. Secret and database readiness is separate from package availability.

`import-lock ./companion.lock --project .` imports an old v1 export after checking its existing files. It preserves the source and refuses to overwrite an already-populated destination lock.

Public installs use `install --public TOKEN --version VERSION`. The CLI checks the exact public ZIP size and checksum, then installs only its root package. It reports declared prerequisites rather than fetching private dependencies or secrets. It requires a key with public installation capability and never reports a private workspace installation for that release.

## Public GitHub folders

Install a public folder containing a valid `SKILL.md`; `companion.json` is optional. No Skillpack login or catalog listing is required.

```sh
skillpack install github:acme/skills/review
skillpack install github:acme/skills/review@v1.2 --scope project --tools claude-code,codex,opencode
skillpack install https://github.com/acme/skills/tree/main/review --scope user
skillpack install github:acme/skills/review --ref feature/review --yes --json
skillpack update github:acme/skills/review --scope project --yes
skillpack sync --frozen --project . --json
```

`--scope` defaults to `user`; tools use the configured selection (otherwise Claude Code, Codex and OpenCode). Project installs use `.agents/skills` for shared/OpenCode discovery and managed `.claude/skills` / `.codex/skills` copies. User installs use `~/.claude/skills`, `~/.codex/skills` and `~/.agents/skills`. Repository roots use `github:owner/repo`; monorepo paths select just that subtree. Omitted refs follow the default branch; branches, tags and full commit SHAs are accepted. Use `--ref` for ambiguous `/tree/` URLs, especially branches containing `/`. Conflicting suffix/flag refs fail. Use refs instead of `--version`.

Git must be installed to resolve branches and tags. The CLI runs unauthenticated `git ls-remote` once (zero GitHub API calls) with bounded output and without inherited Git configuration or credentials. Default-branch installs resolve `HEAD`; annotated tags use their peeled commit. Full commit SHAs and frozen restoration skip ref resolution.

Each download uses two `api.github.com` calls: repository visibility and one recursive Git tree listing. The tree detects submodules even without `.gitmodules`, validates paths/modes, and supplies Git blob checksums. File bytes come from one streamed `https://codeload.github.com/<owner>/<repo>/tar.gz/<sha>` response; only the selected folder is retained. Truncated/oversized tree listings fail closed, without per-file API fallback. Retries may add a bounded number of requests when rate limited.

The CLI displays the full commit SHA, inspects the files and asks:

```text
WARNING: This third-party skill has not been verified by Skillpack.
Source: https://github.com/<owner>/<repo>/tree/<commit>/<path>
Commit: <commit>
Executable files: <list-or-none>
Its instructions may cause your agent to run commands or access your files and credentials.
Skillpack will only copy files; it will never run package scripts.
Install this skill? [y/N]
```

`--yes` accepts without prompting and retains the warning; CI, redirected input and `--json` require it for install/update, including an unchanged reinstall. `--dry-run` only prints the plan. Frozen sync prints the warning without asking. Trust a committed lock only after reviewing its source: pinning ensures reproducibility, not safety. Scripts (Git executable mode or `scripts/` paths) are flagged and copied; Skillpack never runs them or automatically installs their dependencies, hooks, tools or secrets.

GitHub entries upgrade `.companion/skills.lock.json` to v3 (user scope: `~/.companion/skills.lock.json`). v2 remains readable; older CLIs reject v3. Existing registry entries and extension metadata survive. Each virtual workspace `github:owner/repo` contains the usual skill and target checksums plus:

```json
{
  "source": {
    "type": "github",
    "repository": "acme/skills",
    "path": "review",
    "ref": "main",
    "commit": "0123456789abcdef0123456789abcdef01234567"
  },
  "version": "0123456789abcdef0123456789abcdef01234567",
  "pinned": false
}
```

`ref: null` tracks the default branch. `--pin` or an exact SHA ref prevents updates; frozen sync always uses each target's recorded SHA and checksum, leaves the lock unchanged and never resolves the branch again. It verifies offline copies first, restores from another verified target when possible, then streams the tarball for that exact public commit and verifies its files against the Git tree and lock checksums. Missing commits, private/deleted repositories, mismatched bytes or incomplete locks fail without activation. `update` / `update --all` follow saved refs without Skillpack login for GitHub sources; changed content requires confirmation. Partial tool updates retain each other target's old SHA. Pins and local edits are preserved.

Unsafe or encoded traversal paths, symbolic links (including path ancestors), submodules, special files and portable filename collisions are rejected. Only files under the selected skill folder are retained in memory and installed; the repository archive is streamed without buffering it in memory or writing it to disk. The selected skill defaults to 25 MiB total extracted bytes and 2,000 files. Raise these limits for `install`, `update` or `sync --frozen` with `--max-skill-size BYTES` / `SKILLPACK_MAX_SKILL_BYTES` and `--max-skill-files COUNT` / `SKILLPACK_MAX_SKILL_FILES`; flags override environment variables. Values are positive decimal integers (bytes, not MiB). For example, `--max-skill-size 52428800 --max-skill-files 4000` allows 50 MiB and 4,000 files. Supply the same limits when updating or restoring a larger skill. Each file shares the total byte budget; `SKILL.md` retains its fixed 1 MiB cap. Other package sources retain their existing limits.

The whole repository stream has fixed safety caps of 2 GiB compressed and 8 GiB decompressed, including skipped files, headers, padding and trailing data. These are separate from the selected skill limits; raising `--max-skill-size` cannot bypass them. Exceeding a repository cap requires a smaller repository or publishing the skill separately. Selected limits cannot exceed 8 GiB or 100,000 files. Tree metadata is capped at 8 MiB and 100,000 entries; time and retry counts are also bounded, with up to two minutes for a download. Invalid/missing `SKILL.md` and unknown refs fail before writing. A skill name already owned by another source or an untracked folder cannot be replaced with `--force`; choose another scope or remove the existing installation explicitly.

GitHub rate limits may require `GITHUB_TOKEN` supplied through a private environment. It is sent only to `api.github.com`, never sent to codeload or Git, saved in the lock, or forwarded across redirects. API and codeload redirects are refused. Rate-limit errors report retry timing; waits and retries are bounded. Private repositories remain unsupported even with a token; an anonymous 404 can mean missing or private.

### GitHub download call-count measurement

Measured against the pre-change resolver at `22a89394d05e23b75fe3f564cd1eb3f10fa93f54` using successful installs with an instrumented fake HTTP transport (flat valid packages, no rate-limit retries):

| Skill size | Before: API calls | After: API calls | After: codeload downloads |
| --- | ---: | ---: | ---: |
| Small: 2 files | 5 | 2 | 1 |
| Large: 1,000 files | 1,003 | 2 | 1 |

Before: repository + commit + tree + one blob request per file; nested folders added more tree requests. After: Git ref resolution + repository + recursive tree + one streamed tarball. Run `cd runtime && go test ./internal/cli -run TestGitHubInstallAPICallCount -v` for the regression measurement. Frozen network restoration uses the same two API calls and one pinned tarball, with zero ref lookups; verified offline copies need no network.


Organization sharing is strictly opt-in:

```sh
skillpack install github:acme/skills/review --share-org --profile equipe
```

This publishes a copy to the connected profile's organization through the existing authenticated package API, preserving license and GitHub repo/path/ref/SHA provenance in frontmatter metadata. It creates no public release or catalog listing. Existing organization or personal slugs are refused. Server normalization does not alter the local GitHub snapshot or its lock. A sharing failure returns a partial result and a nonzero exit while retaining the successful local installation. `--yes` alone never shares; `--dry-run` never publishes.

## API, secrets and databases

Use `skills validate FOLDER`, `skills publish FOLDER --scope org|personal`, `skills list`, `skills info SLUG` and `skills versions SLUG`. Packages use the shared v2 manifest schema; canonical archive checksums have an independent TypeScript oracle. Server validation remains authoritative for business rules.

The shared operation registry powers `api METHOD /v1/path --input FILE|-`. JSON output and exit codes support agents. Generic API access excludes credential issuance and plaintext secret grant redemption; dedicated secret commands keep values out of output.

Use `secrets create`, `bind`, `configuration` and `sync` with JSON stdin/private files. Secret values are projected into private `~/.companion/secrets/<workspace>/<skill>/.env` files, with value-free state metadata. A one-use retrieval grant is never saved or replayed. Missing required bindings prevent package activation.

`db query SLUG --input FILE` and `db execute SLUG --input FILE` take `sql`, `params`, `audience` and an authorized personal `realm_id` when needed. Writes are not automatically retried after an ambiguous network failure. A full key cannot bypass database feature flags or another member's private realm.

Exit codes: 0 success, 1 local I/O/internal failure, 2 usage, 3 authentication, 4 missing resource, 5 validation, 6 conflict/partial update, 7 authorization, 8 network/server failure, 9 local drift. Errors omit response bodies and credentials.

## Runtime and self-update

`doctor --json` checks both user and project installs and shows credentials, package state and usage diagnostics separately. It reports missing required local secrets by name, without revealing their values. Locally present packages and secrets do not prove remote database access: that readiness remains `not_verified` until a functional check succeeds. `setup` preserves unrelated hooks and requires the official runtime companion beside the CLI for OpenCode. Codex approval remains in `/hooks`; configured hooks are not proof of observation. `usage telemetry disable` keeps the existing persistent opt-out behavior.

`self update` selects a newer stable runtime release, verifies its pinned Ed25519 signature and six-target manifest, checks the archive digest, and self-tests the new binary before activation. It preserves old version slots. An occupied or conflicting slot is reported for inspection, never overwritten blindly. On Windows, activation is delegated to the verified new executable after the foreground process exits, and the command reports `activation_pending`. The launcher replacement is atomic; a sharing lock leaves the old launcher intact. Check `doctor` and `--version` afterward; close other Skillpack processes and retry if activation remains locked.

Legacy Python/MJS files stay in the management package so an already-running 1.118.2 bootstrap can finish after replacing its folder. New prompts and native commands do not execute that payload. Migration requires a first API-key login; Agent Auth references and private keys are not copied or silently converted.

## Verification

`go test ./...` under `runtime/` covers native contracts, archive checksums, traversal rejection, private projection, offline clone restoration and interrupted transaction recovery. Existing native CI jobs build/test both executables for all six targets. The build-time contract generator supports `--check` to detect registry/schema drift.

For the full-process API acceptance test, start the isolated `scripts/dev-conductor.sh` stack, build the CLI, and run `apps/api/test/integration/nativeCli.integration.test.ts` with explicit disposable `DATABASE_URL`, `COMPANION_INTEGRATION_TESTS=1`, loopback `SKILLPACK_NATIVE_API_URL` and absolute `SKILLPACK_NATIVE_BINARY`. It publishes a synthetic skill, projects a secret, writes and reads real SQLite through remote storage, then checks restricted and revoked keys with no interpreters in PATH. This opt-in test is separate from the default database suite.

## API-key interface

New keys use the full capability set without a scope picker. Existing limited keys remain labelled separately. These local validation captures use synthetic data.

![Create a named API key](images/skillpack-cli-key-create.png)

![Full and limited keys on a narrow screen](images/skillpack-cli-keys-mobile.png)
