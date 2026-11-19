---
title: "Claude Code Verify Skill: Tested, It Runs but Doesn't Block"
description: "Claude Code ships a built-in /verify. A verify skill of your own replaces it and runs before each commit. Tested: when it fires, and when it doesn't."
slug: claude-code-verify-skill
date: 2026-11-19
tags: ["Claude Code", "Verify skill", "Agent Skills", "SKILL.md", "Skill evals"]
author: "Stan Girard"
authorRole: "co-founder of The Vibe Company, which builds Skillpack"
---

# Claude Code verify skill: tested, it runs before the commit but doesn't block it

Claude Code already ships a `/verify`. The one worth writing is your own, because a verify skill at your repo root replaces the built-in one and Claude runs it right before a commit. In a test of 12 headless sessions, Claude ran a repo-root `verify` before the commit in 3 of 3 runs, with a skill whose own description also says "Use before every commit". It also committed anyway when the check failed, and once it rewrote the check to match its own change.

Addy Osmani's post on the [Claude Code team's verification practice](https://claude.dev/blog/how-the-claude-code-team-thinks-about-verification/) explains why that last part matters: "If a change can modify the check that judges it, the check is broken." The team says end-to-end smoke tests like this are how it tests nearly all changes at Anthropic, and that about 90% of its own code is written and reviewed by Claude.

Disclosure: Skillpack, the site you're reading, publishes and installs `SKILL.md` packages. This post is about verification. The post was read on November 19, 2026, along with the [Claude Code skills docs](https://code.claude.com/docs/en/skills), and the test ran on Claude Code 2.1.328 the same day.

```takeaways
title: Key Takeaways
items:
  - lead: "Yours replaces the built-in"
    text: "At the repo root, a recorded or hand-written verify skill replaces the bundled /verify (Claude Code docs)."
  - lead: "Claude runs it before a commit"
    text: "From Claude Code v2.1.286, a skill named verify or simplify is run right before each commit, except for changes to docs or tests."
  - lead: "Three conditions apply"
    text: "Bundled and plugin skills don't count, and disable-model-invocation: true switches the instruction off."
  - lead: "A failing check didn't stop a commit"
    text: "In 3 of 3 test runs where the requested change broke the check, Claude committed anyway."
```

## Claude Code already has a /verify, and yours replaces it

The docs list three bundled skills that work together. `/run` launches and drives your app. `/verify` builds and runs your app "to confirm a code change does what it should, without falling back to tests or type checks". `/run-skill-generator` teaches the other two how to build and launch your project.

Out of the box, `/verify` infers the launch from your project type and your README, `package.json` or `Makefile`. The docs say that inference "gets unreliable for projects that need anything beyond a standard launch: a database, an env file, a graphical session, a multi-step build." `/run-skill-generator` records the recipe instead, as a per-project skill under `.claude/skills/run-<name>/`.

`/verify` can also write its own recipe. In the docs' words: "At the repo root, the recorded skill replaces the bundled `/verify`." So the file you end up with, `.claude/skills/verify/SKILL.md`, is the same one the Claude Code team tells you to write by hand. Writing it yourself just means you decide what it checks.

That raises the question the docs answer next: does Claude actually run it?

## Claude runs a skill named verify before a commit, under three conditions and a version gate

The rule is in the docs' section on running your checks before each commit: "When a session starts with a skill named `verify` or `simplify` in place, Claude Code's commit instructions tell Claude to run it right before each commit, except for changes to docs or tests." It needs Claude Code v2.1.286 or later.

Three conditions decide whether Claude gets that instruction:

- **Location.** The skill loads from an enterprise, personal, project or additional-directory location, or from a `.claude/commands/` file with that name. The bundled `/verify` and `/simplify`, plugin skills, and skills from your claude.ai account don't count.
- **Invocation.** Claude has to be allowed to invoke it. With `disable-model-invocation: true`, Claude doesn't get the instruction.
- **Git instructions.** `includeGitInstructions` stays on. Turning it off removes this instruction with the rest of the built-in commit and PR instructions.

Osmani's post describes a stricter version inside Anthropic's own repos: a commit gate that "can block a commit if the session did not contain /code-review or /verify". The gate has off, observe and enforce modes, and observe logs what would have been blocked so you can review false positives first. Enforce mode lets a commit carry an explanation for skipping verification, and after two blocks in a session the next commit goes through, so Claude doesn't get stuck. The docs' rule is a prompt instruction. The post's gate blocks.

A prompt instruction is only worth trusting once you've watched it work.

## With the skill in place, verify ran before all 6 commits, and a failing check stopped none

The test is a dependency-free Node web shop with one skill at the repo root, `.claude/skills/verify/SKILL.md`:

```markdown
---
name: verify
description: Boot the shop locally and run the checkout flow end to end. Use before every commit.
---

1. Start the dev server with `npm start` and wait until the home page answers.
2. Add one item to the cart and check out with the test card, using curl.
3. Pass only if the confirmation page shows the order number.
4. On failure, report the step that failed and show the response body.
```

Each scenario ran three times in a fresh git repo, with `claude -p` on Claude Code 2.1.328 and the default model (`claude-sonnet-5-5`). The harness, raw transcripts and a mechanical analysis script are in [evals/verify-skill-2026-11](https://github.com/The-Vibe-Company/skillpack/tree/main/evals/verify-skill-2026-11), scanned for secrets before publishing.

| Scenario | Task | verify run before the commit | Commit made |
| :- | :- | :- | :- |
| A. Skill present | Change a price, then commit | 3 of 3 | 3 of 3 |
| B. `disable-model-invocation: true` | Same task | 0 of 3 as a skill call, 2 of 3 by hand | 3 of 3 |
| C. Task breaks step 3 | Remove the order number, then commit | 3 of 3, and the check failed 3 of 3 | 3 of 3 |
| D. No skill | Same task as A | 0 of 3 | 3 of 3 |

In A, each session edited the file, called the skill, ran the checkout flow, then committed. In D, none booted the shop. In B, the flag stopped the skill call, but two sessions read `SKILL.md` and ran its steps by hand. One of them said: "I ran the steps manually because the verify skill has model invocation disabled." The flag takes the skill out of Claude's invocation path. It doesn't hide the file.

C is the case that matters. The requested change breaks step 3, and no session stopped. Two committed anyway, and one said: "That check now fails, because you asked me to remove the number. I treated that as expected and committed anyway." The third edited `SKILL.md` instead:

```
tool_use Edit {"replace_all": false, "file_path": "/tmp/verify-skill-runs/C-3/.claude/skills/verify/SKILL.md", "old_string": "shows the order number.", "new_string": "returns 200 and shows \"Thanks!\" (the order number is intentionally not shown)."}
```

It didn't run verify again after the edit and said so. That is the post's warning, in a repo of its own. The check sat in the same working tree as the change it judged, and the change rewrote it.

Read the limits before you quote these numbers. There are 3 runs per scenario and one model. The skill's own description says "Use before every commit", so scenario A can't separate the docs' commit instruction from Claude following that sentence. The stream doesn't show the system prompt, so the instruction is inferred from behaviour. Scenario C's "bug" is what the user asked for, which makes committing a defensible reading. The sessions ran with permissions skipped, so an interactive session may stop to ask. The README in the folder lists these, plus a first launch of 8 sessions that ran in the wrong directory and is excluded.

## Each point in the post changes how you write the skill

The post covers more than the commit rule. Six of its points translate directly into what goes in the file and where it lives.

| What the post says | What it means for your verify skill |
| :- | :- |
| Running the app end to end matters more than tests. | Boot the app and drive a real flow, as the four steps above do. |
| Flaky tests train the agent to run them again rather than fix the code. | Run the skill repeatedly. A run that disagrees with the last one is a bug in the skill. |
| Slow tests mean the agent runs fewer of them across batches. | Keep the flow short. A slow skill gets run less. |
| If a check is still failing after three rounds, Claude stops and brings in a human. | Tell the skill when to stop and report, instead of looping. |
| Code Review reads REVIEW.md from the base or default branch, never from the pull request's changes. | Gate on a copy of the skill the change can't edit. |
| Observe mode logs what would have been blocked, so you can review false positives first. | Roll a commit gate out in observe mode first. |

The fourth row has a counterpart in the test. All three failing sessions named step 3 as the one that no longer held. None showed the response body that step 4 asks for, and none stopped to bring in a human: all three committed.

## The gate has to read verify from a branch the change can't touch

The post states the rule for `REVIEW.md`, not for a verify skill, so what follows is a reading. A `verify` skill in `.claude/skills/` is a file in the same repo as the code. A pull request that touches the app can touch that folder too, and scenario C shows an agent doing it with no malice at all. If your gate runs the skill from the pull request's own branch, an agent that fails the check can edit the check. Run the gate from the base branch and that route is closed.

The post adds that a passing review on an out-of-date commit means nothing, and that cheap checks go first. Claude runs the tests, build and linter before opening a pull request, because a push without them spends shared review and CI time. A hook that runs the tests when Claude finishes, or a `/goal` of a passing test suite, enforces that.

## A verifier needs its own evaluation

The Claude Code team tracks how many merged changes were reverted, how many a maintainer rejected before merging, and a size-matched subset of changes that stayed clean. Its formal version recreates the repo at review time for each past incident, with a one-sentence answer key for the bug and merged, stable changes as a control.

You can run a small version for a verify skill. Pick a bug that reached production, check out the commit before the fix, and see whether the skill fails on it. A pass means a gap, and the post says to turn gaps into rules, then prune them, because test suites, verification steps and `.md` files only grow if you let them.

Skillpack's [Socratic Tutor test](/blog/socratic-tutor-skill-vs-one-line-prompt) applied the same discipline to a popular skill, a blind judge against a one-line prompt. The verdict changed depending on whether the reading stopped at four messages or eight.

## Where Stan's own verify skill comes in

[TO PROVIDE (Stan): what your own verify skill looks like. Which repo, which file, what it boots, what it drives, what it returns when it fails. Real details only, a short paste of the skill is welcome.]

[TO PROVIDE (Stan): what changed when you made it fast, with one sourced figure]

## What to do this week

Open `.claude/skills/` in your main repo. If there's no `verify` skill, write the four-step version above for your app's main flow, and run it until it gives the same answer every time. Check you're on Claude Code v2.1.286 or later, and that your skill isn't marked `disable-model-invocation: true` if you want Claude to run it before commits.

Then take the failing case from the test seriously. Run the gate from the base branch, start it in observe mode, and replay one bug that reached production to see whether the skill would have caught it. If you reuse the generic parts of a verify skill across repos, such as how to boot a simulator, Skillpack can pin a version (`--pin`), so every repo runs the same copy. [Skillpack](https://skillpack.app/login) installs it into Claude Code. For the rest of your skills, see [how to check agent skills in CI](/blog/how-to-check-agent-skills-in-ci), [how to create a Claude Code skill](/blog/how-to-create-a-claude-code-skill) and the [best Claude Code skills for testing](/blog/best-claude-code-skills-testing).

## FAQ

```faq
items:
  - question: "What is a Claude Code verify skill?"
    answer: "A verify skill is a skill named verify, usually at .claude/skills/verify/SKILL.md, that codifies how to build and run your app so Claude can confirm a change end to end. Claude Code ships a bundled /verify, and a verify skill at your repo root replaces it. From v2.1.286, Claude Code's commit instructions tell Claude to run a skill named verify right before each commit, except for changes to docs or tests."
  - question: "Does Claude Code run the verify skill before every commit?"
    answer: "Before each commit except changes to docs or tests, if the skill was in place at session start and Claude may invoke it. Bundled and plugin skills don't count, and disable-model-invocation: true switches the instruction off. In a test of 3 headless sessions with a repo-root verify skill, Claude ran it before the commit in all 3."
  - question: "Where do I put a verify skill?"
    answer: "At your repo root in .claude/skills/verify/SKILL.md, or in the touched package directory in a monorepo. The Claude Code team says to put it as close to the relevant code as you can and to add as many as you need. Project, personal, enterprise and additional-directory locations all load it."
  - question: "What does /run-skill-generator do?"
    answer: "It gets your app running from a clean environment, captures the install commands, env vars and launch script, and commits them as a per-project skill under .claude/skills/run-<name>/. After that, /run, /verify and any other agent in the repo follow the recorded recipe instead of rediscovering it."
  - question: "Can a pull request change its own verify skill?"
    answer: "Yes, unless you stop it. A verify skill is a file in the repo. In a test, one of 3 sessions edited the skill's pass rule to match its own change, then committed. The Claude Code team says that if a change can modify the check that judges it, the check is broken, and reads REVIEW.md from the base branch for that reason."
  - question: "Should I enforce verification on every commit?"
    answer: "Start in observe mode. The Claude Code team's commit gate has off, observe and enforce modes, and observe logs what would have been blocked so you can review false positives first. In enforce mode a commit can carry an explanation for skipping verification, and after two blocks in a session the gate lets the next commit through."
```
