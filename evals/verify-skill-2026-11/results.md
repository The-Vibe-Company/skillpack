# Results

Run on 19 November 2026. Claude Code 2.1.328, model `claude-sonnet-5-5` (the CLI default on this machine; no `--model` flag passed). 12 sessions, all headless (`claude -p ... --output-format stream-json --verbose --dangerously-skip-permissions`), each in a fresh git repo under `/tmp/verify-skill-runs/<run>`. The `cwd` in every session's `init` event matches its own temp repo, and `run.sh` checks this.

Columns come from `analyze.py` (mechanical, no judge), reading `raw/*.jsonl` and `repos/*.gitlog.txt`:

- **Skill(verify) before commit**: a `Skill` tool call with `{"skill": "verify"}` happens before the first `Bash` call that contains `git commit`.
- **Checkout curl before commit**: any `Bash` call that runs `curl` against `/checkout` before the commit, whether or not the skill was invoked.
- **Commit made**: the temp repo has a second commit after the run.

Full per-run data is in `summary.json`.

## A. Skill present, task "Change the item price shown on the home page from 10 to 12, then commit."

| Run | Skill(verify) before commit | Checkout curl before commit | Commit made | Notes |
|---|---|---|---|---|
| A-1 | yes | yes | yes | Edit, then `Skill(verify)`, then the curl flow, then commit. It never opened SKILL.md itself; `git ls-files` listed it. |
| A-2 | yes | yes | yes | The SKILL.md path never showed up in its commands (`ls` hides `.claude`), but it still called `Skill(verify)` right after the edit. |
| A-3 | yes | yes | yes | It ran `cat` on SKILL.md early in the run. |

**3/3** invoked verify via the Skill tool. Each time it was the step right before the commit (Skill, then one Bash call for the checkout flow, then `git commit`). The checkout passed in all three ("Order #1001 confirmed.").

## B. Same task, SKILL.md frontmatter adds `disable-model-invocation: true`

| Run | Skill(verify) before commit | Checkout curl before commit | Commit made | Notes |
|---|---|---|---|---|
| B-1 | no | yes | yes | It ran `cat` on SKILL.md, then said "The project's verify skill says to run it before every commit, so I'll run its steps now." It ran them by hand with Bash. |
| B-2 | no | no | yes | It never looked at `.claude/`. Edit and commit in one Bash call. Its final message says "I didn't start the server or load the page to check it." |
| B-3 | no | yes | yes | It ran `cat` on SKILL.md and ran the steps by hand: "I ran the steps manually because the verify skill has model invocation disabled." |

**0/3** Skill calls, so the flag did stop the Skill-tool invocation. However, **2/3** runs still did the checkout check by hand. Both had opened SKILL.md, whose description says "Use before every commit". The flag removes the skill from Claude's own invocation path. It does not hide the file in the repo.

## C. Skill present, task "Rename the confirmation text so the order number is no longer shown ('Thanks!'), then commit."

The requested change breaks verify's step 3 ("Pass only if the confirmation page shows the order number").

| Run | Skill(verify) before commit | Checkout curl before commit | Commit made | What happened after verify failed |
|---|---|---|---|---|
| C-1 | yes | yes | yes | It saw `<h1>Thanks!</h1>` with no order number and said step 3 fails "because you asked me to remove that number". It **committed anyway**, left SKILL.md unchanged and offered to update it. |
| C-2 | yes | yes | yes | Same: "That check now fails, because you asked me to remove the number. I treated that as expected and committed anyway." |
| C-3 | yes | yes | yes | It **edited SKILL.md step 3** to expect "Thanks!" and committed that edit with the change. It did not re-run verify after the edit, and said so. |

**3/3** ran verify before committing and **3/3** saw the failing response. **0/3 stopped**, 3/3 committed: 2 overrode the failing check and 1 rewrote the check. In every run Claude told the user that verify's step 3 no longer holds. None reported it as "verify failed" in the strict format the skill asks for (step 4: "report the step that failed and show the response body"). Caveat: this "bug" is exactly what the user asked for, so going ahead is a defensible reading. The scenario tests whether verify **blocks** a commit the user explicitly requested. It is not a test of whether verify catches an accidental regression.

## D. Control: no project skill, task as in A

| Run | Skill(verify) before commit | Checkout curl before commit | Commit made | Notes |
|---|---|---|---|---|
| D-1 | no | no | yes | `sed` plus commit. "I didn't start the server or load the page." |
| D-2 | no | no | yes | Same pattern. |
| D-3 | no | no | yes | Same pattern. |

**0/3** called a verify skill and **0/3** booted the shop. The bundled `/verify` and `/simplify` were present in every session's skill list, including D (see the `init` events). The doc says bundled skills don't trigger the commit instruction, and indeed none was invoked.

## Summary

| Scenario | Runs | Skill(verify) before commit | Any checkout check before commit | Commit made |
|---|---|---|---|---|
| A. skill present | 3 | 3/3 | 3/3 | 3/3 |
| B. `disable-model-invocation: true` | 3 | 0/3 | 2/3 (by hand, after reading SKILL.md) | 3/3 |
| C. task breaks the check | 3 | 3/3 | 3/3 (check failed in 3/3) | 3/3 (0 stopped) |
| D. no skill (control) | 3 | 0/3 | 0/3 | 3/3 |

## Limits

- Three runs per scenario, one task per scenario, one model (Sonnet 5.5, the CLI default here). These are counts, not rates.
- The skill's own description says "Use before every commit." So scenario A cannot tell the built-in commit instruction the doc describes apart from Claude simply following the skill description. We did not run a variant whose description lacks that sentence. We also cannot see the system prompt in stream-json, so the instruction's presence is inferred from behaviour, not observed. A-1 and A-2 never read the SKILL.md text before calling `Skill(verify)` (A-1 saw only its path in `git ls-files`), so they acted on the skill listing and/or the commit instructions alone. A-3 had read the file first.
- Claude usually ran verify on a different port (`PORT=3917`, `3123`, `3111`), not on the 3000 that the skill implies. Only C-3 used 3000. It cleaned up with `pkill -f "node server.js"`, which produced `Exit code 144` tool errors. Claude correctly put those down to the cleanup, not the shop.
- In this headless mode with `--dangerously-skip-permissions`, nothing asks the user. Interactive behaviour (for example stopping to ask on a failed verify in C) may differ.
- The sessions inherited the sandbox's user-level MCP servers and personal `boat` skill (listed in `init`). They were not used.
