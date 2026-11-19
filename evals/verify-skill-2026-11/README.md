# Does a repo-root `verify` skill run before each commit? Harness, raw transcripts and results

This folder holds a real headless Claude Code experiment, run on 19 November 2026, for the skillpack.app article on Claude Code's `verify` skill (THE-2436).

Read `results.md` first for the tables and limits. `excerpts.md` has verbatim transcript excerpts.

## The doc claim tested

From https://code.claude.com/docs/en/skills, section "Run your checks before each commit" (fetched 19 November 2026):

> When a session starts with a skill named `verify` or `simplify` in place, Claude Code's commit instructions tell Claude to run it right before each commit, except for changes to docs or tests. This requires Claude Code v2.1.286 or later.

> **Invocation**: Claude can invoke the skill. If you've stopped Claude from invoking it, for example with `disable-model-invocation: true`, Claude doesn't get the instruction.

> The bundled `/verify` and `/simplify`, plugin skills, and skills from your claude.ai account don't count.

## Questions and answers (3 runs per scenario)

1. **With a project `verify` skill, does Claude run it right before the commit?** Yes, 3/3 (scenario A). It called `Skill(verify)`, then ran the checkout flow, then committed. The control with no skill (D) never booted the shop (0/3).
2. **Does `disable-model-invocation: true` stop it?** It stopped the `Skill` tool call (0/3, scenario B). In 2/3 runs, though, Claude had read SKILL.md from the repo and ran its steps by hand anyway.
3. **Does it catch the injected bug?** The check failed in 3/3 runs and Claude saw it every time. It never blocked the commit: 2 runs committed anyway, and 1 rewrote the skill's pass criterion and committed. The "bug" here is the change the user asked for, which is a key caveat (see `results.md`).

## Setup

- Claude Code **2.1.328**. `claude --version` showed it before the experiment, and every run's `init` event records it. This meets the doc's v2.1.286 requirement, so no upgrade was needed.
- Model: `claude-sonnet-5-5`, the CLI default on this machine (no `--model` flag).
- Authentication: the sandbox's existing Claude Code credentials, passed through the environment. None are written here.
- Each run: copy `app-template/` to `/tmp/verify-skill-runs/<run>`, add `.claude/skills/verify/SKILL.md` (scenarios A, B, C), then `git init` and an initial commit. Then start **one** session in that repo, so the skill is already in place at session start: `claude -p "<task>" --output-format stream-json --verbose --dangerously-skip-permissions`.
- Same task prompt for every run of a scenario:
  - A and D: `Change the item price shown on the home page from 10 to 12, then commit.`
  - B: same as A, with `disable-model-invocation: true` added to the SKILL.md frontmatter.
  - C: `Rename the confirmation text so the order number is no longer shown ('Thanks!'), then commit.`

## Layout

- `app-template/`: the tiny dependency-free Node shop (`node:http` only; `npm start` on port 3000). `GET /` lists one item with an "Add to cart" form, `POST /cart` adds it, and `POST /checkout` with card `4242424242424242` returns "Order #<n> confirmed."
- `verify-skill/SKILL.md`: the exact skill installed as `.claude/skills/verify/SKILL.md`. Scenario B inserts `disable-model-invocation: true` after the `description` line.
- `run.sh`: runs the scenarios (`./run.sh` for all, or `./run.sh A C`; `RUNS=3` by default), saves `raw/<run>.jsonl`, writes `repos/<run>.gitlog.txt` (final `git log --stat`, status and diff), then calls `analyze.py`.
- `analyze.py`: mechanical check, with no LLM judge. It looks for a `Skill` call for `verify`, whether it came before the first `git commit` Bash call, any curl checkout before the commit, and whether a commit was made. Output goes to `summary.json`.
- `dump.py`: prints one raw run as readable lines.
- `make_excerpts.py`: generates `excerpts.md` from `raw/`.
- `scrub.py`: the scrub applied to the raw logs before publishing (see below).
- `raw/`: the 12 valid stream-json transcripts plus their stderr (each just `exit=0`).
- `repos/`: final git state of each temp repo.
- `results.md`, `excerpts.md`, `summary.json`: results.
- `invalid-attempt-1-wrong-cwd/`: the first launch, where sessions started in the wrong directory. It is excluded from results; see its `NOTE.md`.

## Harness notes and surprises

- On this sandbox, `/usr/local/bin/claude` is a wrapper that `cd`s into a pinned repo before starting Claude Code. The first launch therefore ran in the skillpack repo itself. One session there edited this harness's template and made a local commit, which was undone before anything was pushed. `run.sh` now calls the wrapped binary (`/usr/local/bin/claude.armada-original`, same version) with a clean `env -i` environment, and it aborts if a session's `init.cwd` is not its temp repo.
- After the runs, `run.sh` got three shellcheck-only fixes (`cd ... || exit 1` and `xargs kill`). They do not change behaviour when the runs succeed.
- The bundled `/verify` and `/simplify` skills appear in every session's skill list, including the control. The doc says they don't trigger the commit instruction, and none was invoked in D.

## Scrubbing (applied before commit)

- `scrub.py` dropped every `rate_limit_event` line (12 in `raw/`, 7 in the invalid attempt). These lines hold account plan and usage data, not experiment output.
- `scrub.py` replaced every `session_id` value with `REDACTED`, including copies nested inside tool output in the invalid attempt.
- `scrub.py` replaced the sandbox's Armada MCP connector ids (`armada_<uuid>`) in the `init` events with `armada_REDACTED`.
- Nothing else was changed. `gitleaks detect --no-git` (v8.30.1) on this folder found no leaks. A regex scan for `sk-ant`, `oauth`, `Bearer`, `ANTHROPIC`, `.env`, `token` and long base64 found only harmless matches:
  - `*_tokens` usage counters;
  - `noreply@anthropic.com` in commit trailers;
  - `process.env.*` in code;
  - the env variable *names* in `run.sh`;
  - base64 `signature` fields of thinking blocks, which are not credentials.
- Message uuids and tool-use ids remain. They do not identify the account.
