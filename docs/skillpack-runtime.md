# Automatic skill usage collection

Skillpack installs a small Go executable on macOS, Linux and Windows (AMD64 and ARM64).
The management skill owns setup and updates. Ordinary skills contain only identity metadata and a
short notice: they never ask the model to send a tracking request or repair hooks.

## Install and diagnose

Run the normal Skillpack bootstrap from the installed management skill:

```sh
python3 scripts/bootstrap.py --summary --auto-update-skillpack
python3 scripts/runtime_command.py doctor --json
```

On Windows use `python` if that is the Python launcher installed on the machine. Node.js and Python
are setup dependencies already used by the management skill; the installed Go collector is standalone.
No PATH or shell-profile changes are required. The helper invokes the active verified binary.

Setup detects the native target, downloads a pinned release, verifies its Ed25519 manifest and archive
SHA-256, executes a version self-test, then atomically selects the new version. Existing hooks and
unrelated settings survive. Windows updates leave an in-use executable intact in its version directory.
Failed downloads, invalid signatures and unavailable release assets leave the previous version active.
Before the first public release is published, setup explicitly reports `distribution_unavailable`.

Codex may require review of new definitions in `/hooks`. Setup never writes trust hashes or bypasses
workspace trust. Restart the agent after setup where it loads hook configuration only at startup.
A configuration file is not proof of collection: check doctor for an observed hook and last capture.
Use the same helper with `sync` to retry pending delivery or `watch` for an explicit continuous worker.
The default worker wakes on agent activity and exits after 120 seconds idle; no login daemon is installed.

## What counts

| Signal | Meaning |
| --- | --- |
| Invocation | Successful native skill tool call observed locally. Does not establish task success. |
| Request | A structured skill/command request, such as Claude's direct slash-command expansion. |
| Read | A successful structured read of a registered SKILL.md. Does not establish invocation. |
| Historical | Retained reports from the retired model instruction system, shown separately. |

Adapters accept known structured host records; they do not search prose, prompts or reasoning for
skill names. Codex transcript reconciliation can observe successful `CommandExecution` records whose
`parsed_cmd` identifies a read; generic command text and output are not evidence of skill invocation.
Unknown formats are skipped. Native hooks are the primary source; versioned transcript adapters
cover enrolled sessions incrementally and start at the current end of an existing log, without backfill.
OpenCode uses a local JavaScript plugin: a completed native `skill` call supplies its installed
directory in structured metadata. The plugin forwards only this reference and correlation IDs to
the local collector. It never reads OpenCode's historical database or tool output. New sessions
enroll through `chat.message`; failed calls and unknown metadata are ignored.
Coverage depends on host/version, hook trust and available structured signals. A cloud clone without
setup or a host that does not run these hooks is not automatically covered.

## Privacy and storage

Only package UUID/version, event UUID, observation kind/adapter, timestamp, agent/environment and
optional declared identity leave the machine. No code, prompt, path, session ID or transcript body is
uploaded. The collector never reads Skillpack Agent Auth credentials. Configured identity fields
`SKILLPACK_TELEMETRY_USER_ID` and `SKILLPACK_TELEMETRY_EMAIL` are optional and unverified.

State defaults to the OS user configuration directory: `~/Library/Application Support/skillpack`,
`${XDG_CONFIG_HOME:-~/.config}/skillpack`, or `%APPDATA%/skillpack`. `SKILLPACK_RUNTIME_HOME` overrides
that location. SQLite holds the bounded queue, verified inventory, session policy and cursors.
Multiple copies/versions of one skill are distinct installations; symlink aliases resolve locally.

```sh
python3 scripts/runtime_command.py telemetry disable
python3 scripts/runtime_command.py telemetry enable
```

Disable persists globally and purges queued events. `SKILLPACK_TELEMETRY=0` excludes the calling session
and persists that exclusion so a later worker cannot re-import its transcript. Updates do not enable
telemetry again. Unknown-policy sessions are not scanned.

The queue is bounded by 10,000 events / 50 MiB and expires unsent events after seven days. HTTP attempts
time out after three seconds; network, 429 and 5xx failures retry with backoff/jitter and Retry-After.
Only a matching `202 {"event_id":"..."}` confirms a durable receipt. Invalid 4xx events stop retrying.
The API never acknowledges a full inbox or database failure. It resolves skill ownership asynchronously,
clears processed payloads, retains opaque receipt IDs for eight days and authorized observations for
90 days. Personal skill usage remains creator-only; org reads recheck current membership.

## Repository and sandbox setup

This repository commits packages under `.agents/skills`, relative Claude links, portable hook
configuration, `.opencode/plugins/skillpack-runtime.js` and `.agents/skillpack/usage`. Conductor's existing setup invokes:

```sh
python3 .agents/skillpack/usage/setup.py
```

Other cloud images run that command before starting the agent. It verifies the committed inventory,
installs the signed binary inside that machine, and registers the project paths. The hook is offline
and bounded; it never downloads a binary during a tool call. Re-run setup after a repository skill
update. No machine-specific paths or credentials belong in Git; neither AGENTS.md nor CLAUDE.md changes.
The Windows Codex handler uses a fixed PowerShell encoded command because its native hook runner
executes through `cmd.exe`; CI runs the committed handler from a repository subdirectory.
Maintain the copied helpers/inventory with `pnpm --filter @skillpack/api exec tsx ../../scripts/runtime-project.ts`.

## Catalogue rollout and installed copies

The release service can apply the migration automatically after schema/grants. Configure these
non-secret identifiers on that service together:

- `SKILLPACK_USAGE_MIGRATION_ORG_ID`: the explicitly selected organization.
- `SKILLPACK_USAGE_MIGRATION_ACTOR_ID`: a member authorized to publish its organization skills.
- `SKILLPACK_USAGE_MIGRATION_ORIGIN`: the public HTTPS origin, for example `https://skillpack.app`.

The release service uses its existing migration-owner database connection and archive storage. The
runtime publication job receives none of those credentials. Without the three variables, schema
migrations run but the catalogue phase does not mutate an organization implicitly.

Preview the rollout with the built release image before enabling automatic application:

```sh
node dist/migrate-skill-usage-runtime.js --org ORG_ID --actor MEMBER_ID --origin https://skillpack.app
```

The same command with `--apply` performs the entire organization operation. It selects every current
active organization skill, all authors; personal and archived skills are excluded. Each immutable new
patch records its parent version/checksum. Archives, authorship, dependencies, labels and public pins
are preserved. A source/storage mismatch aborts publication. A concurrent publish wins; retry rereads
latest rather than overwriting it. Completed migrations are skipped on rerun.

Skillpack bootstrap automatically applies these technical patches to clean user installs with matching
parents. Pinned public releases, customized copies and Git-tracked packages remain intact with explicit
statuses. Public installs record their exact pin for runtime registration. Arbitrary CLI `skills pull`
exports are not treated as agent installations. Repository packages are upgraded in a PR using
`runtime-project.ts --patch-skills`; local custom edits are never silently replaced by bootstrap.

## Automatic binary releases

CI runs Go tests/vet, builds the executable, exercises native capture/opt-out and verifies a signed
installation on all six native runners. PR and merge-group jobs have no signing key and cannot publish.
When a new `runtime/VERSION` lands on canonical `main`, Runtime Publish waits for CI Gate and all six
targets, then signs and publishes the archives from that same run. `runtime-release.json` pins the
compatible version and public key. A runtime source change without a version bump fails the guard.

The publication job creates `runtime-vX.Y.Z` at the validated SHA and first uploads into a draft.
It verifies all six archives, manifest/signature and SHA256SUMS before making the release public,
then checks every anonymous download. Interrupted drafts resume; published assets never get replaced.
Publication is serialized and running main builds are not cancelled by newer pushes. An unchanged
runtime version does not produce another release. No manual tag or upload is needed.

Provision `SKILLPACK_RUNTIME_SIGNING_KEY` once as an Ed25519 PEM GitHub Actions secret; only Runtime
Publish receives it. Never commit the private key. Rotate by updating the pinned public key and
release version through a reviewed change. Manifest signing is not Apple notarization or Windows
Authenticode; platform support is backed by native installer checks, not a signing badge.

Primary contracts: [Codex hooks](https://learn.chatgpt.com/docs/hooks),
[Claude hooks](https://code.claude.com/docs/en/hooks),
[OpenCode plugins](https://opencode.ai/docs/plugins/),
[GitHub hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
