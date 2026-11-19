---
title: "Claude Code Verify Skill: The One Skill to Write First"
description: "A Claude Code verify skill boots your app and checks each change before it ships. What the Claude Code team says to put in it, and how to keep it honest."
slug: claude-code-verify-skill
date: 2026-11-19
tags: ["Claude Code", "Verify skill", "Agent Skills", "SKILL.md", "Skill evals"]
author: "Stan Girard"
authorRole: "co-founder of The Vibe Company, which builds Skillpack"
---

# Claude Code verify skill: the one skill to write first

A Claude Code verify skill is a skill called `verify` that tells the agent how to start your app and check its own change before it commits. The Claude Code team says to write that one and to make it fast and reliable. It also says this is how it tests nearly all changes at Anthropic, and that about 90% of the Claude Code team's own code is written and reviewed by Claude. A style guide tells an agent how to write code. A verify skill tells it whether the code works.

The same post carries a warning that matters more than the skill itself: if a change can modify the check that judges it, the check is broken. So the skill needs two things beyond a good first draft, a place the change can't reach and an evaluation of its own.

Disclosure: Skillpack, the site you're reading, publishes and installs `SKILL.md` packages. This post is about verification, and every claim about the Claude Code team comes from one post, [How the Claude Code team thinks about verification](https://claude.dev/blog/how-the-claude-code-team-thinks-about-verification/) by Addy Osmani, published on November 16, 2026 and read on November 19, 2026.

```takeaways
title: Key Takeaways
items:
  - lead: "One skill, named verify"
    text: "The post says to create a skill called verify in a .claude/skills/ folder, as close to the relevant code as you can, and that Claude knows to use it before committing changes."
  - lead: "Fast and reliable beats thorough"
    text: "Flaky tests teach the agent to rerun them instead of fixing the code. Slow tests mean fewer runs, which makes problems harder to pinpoint."
  - lead: "Keep the judge out of reach"
    text: "If a change can modify the check that judges it, the check is broken. Code Review reads REVIEW.md from the base or default branch, never from the pull request."
  - lead: "Evaluate the verifier too"
    text: "The team tracks reverts and rejected changes, and runs a formal evaluation built from past incidents with a one-sentence answer key per bug."
```

## A verify skill runs the change like a user would

The post puts running the app ahead of unit tests: "Running the app end to end matters more than tests." Its example is an iOS change. You wouldn't ship one without trying it in a simulator, and the same goes for Claude.

So the skill's job is to codify how to start the thing. For web changes the post suggests the Claude Chrome extension, for mobile an iOS or Android MCP, for desktop computer use, and for backend work running the service locally. It also says unit tests are faster and less flaky, but you can pass them and still break the feature, because both the agent and the test miss the full task.

Take the post's own example of an end-to-end flow: add an item to a cart, check out, land on a confirmation page. Say your app is a web shop, and you want the skill to cover exactly that. An example, not a tested file, could look like this:

```markdown
---
name: verify
description: Boot the shop locally and run the checkout flow end to end. Use before every commit.
---

1. Start the dev server and wait until the home page answers.
2. Drive the browser: add one item to the cart, check out with the test card.
3. Pass only if the confirmation page shows the order number.
4. On failure, report the step that failed and attach a screenshot.
```

The post gives a reason for step 4: a unit test may only say "Error: Timeout after 30 seconds", while an end-to-end test can show a screenshot with a description of what's broken.

The post says Claude knows to use `verify` before committing. For the cheaper checks that should run before a pull request opens, it names two ways to enforce them: a hook that runs the tests when Claude finishes, or a `/goal` of a passing test suite.

So the skill exists. What makes the agent keep using it?

## Speed and flakiness decide whether the agent trusts the skill

The post names two failure modes for any test type. If your tests are flaky, you train the agent to run them again rather than fix the failing code. If they're slow, the agent runs fewer tests across batches, which makes pinpointing issues harder. Heavier tests are best run before you commit.

That is why the post says to invest in the skill itself: "Ask Claude to iterate on it and stress test it. It's your smoke test harness, so you want it rock solid."

Flaky checks get a strict rule on the Claude Code team. Claude can't skip them, add sleeps, or retry until they pass. If it can't find the root cause, it deletes the test and writes down why. Failures also have an exit: if a check is still failing after three rounds, Claude stops and brings in a human.

Speed matters for a plain reason: a skill that takes long to run gets run less, and the post warns that fewer runs make problems harder to pinpoint.

## Your verify skill must sit where the change can't edit it

Here is the line from the post worth printing: "If a change can modify the check that judges it, the check is broken." The Claude Code team applies it to review rules. Code Review reads the `REVIEW.md` file from the base or default branch, never from the pull request's changes, so the rules that gate changes live on a branch the change can't modify.

The post says this about `REVIEW.md`. It doesn't say it about the verify skill, so what follows is a reading, not a quote. A `verify` skill committed to `.claude/skills/` is a file in the same repo as the code. A pull request that touches the app can also touch that folder. If your gate runs the skill from the pull request's own branch, an agent that fails the check can edit the check. Run the gate from the base branch and that route is closed.

The post adds two habits that follow the same logic. A passing review on an out-of-date commit means nothing, so reviews are reserved for commits and a push during a review makes the result stale. And cheap checks go first: Claude runs the tests, build and linter before opening a pull request, because pushing untested code spends shared review and CI time.

The post says to start a new gate in observe mode. The team's commit gate has three modes: off, observe and enforce. Observe logs what would have been blocked, so you can review false positives before anyone is affected. Enforce blocks the commit, and any commit can carry an explanation of why it wasn't verified. After two blocks in a session, the next commit goes through so Claude doesn't get stuck. The team also stamps each commit with how it was verified, including "none", so it can query for commits that skipped verification.

A judge the change can't touch is still only as good as what it catches. How do you know yours catches anything?

## A verifier needs its own evaluation

The Claude Code team reviews its reviewers. It tracks how many merged changes were reverted, how many a maintainer rejected before merging, and a size-matched subset of changes that stayed clean.

The formal version is an evaluation built from past incidents and reverts. For each example, the team recreates the repo as it was at review time and writes a one-sentence answer key for the bug. Only findings that correctly describe that bug get points. Merged, stable changes serve as a control so the reviewer isn't rewarded for flagging everything, and the tuning set is separate from the fixed test set. The team also scores recall for raw findings, post-verification findings and the final review separately, because one end-to-end score hides where bugs get lost.

You can run a small version for a verify skill. Pick a bug that reached production, check out the commit before the fix, and see whether the skill fails on it. If it passes, you've found a gap, and the post says what to do with a gap: turn it into a rule. The team's route is to extract patterns from human review comments and reverts, keep only those that appear in at least two PRs and can be spotted from a diff, have three agents try to disprove each one, and have a human approve it in a PR. Then prune. The post notes that test suites, verification steps and `.md` files only grow if you let them, so the team tidies them on a routine.

The same discipline applies to the skill's own instructions. Skillpack's [Socratic Tutor test](/blog/socratic-tutor-skill-vs-one-line-prompt) measured a popular skill against a one-line prompt with a blind judge, and the verdict changed depending on where the reading stopped, four messages or eight. A skill you haven't measured is a guess about what helps. For a verify skill the measurement is cheaper, because a bug either fails the check or it doesn't.

## Where Stan's own verify skill comes in

[TO PROVIDE (Stan): what your own verify skill looks like. Which repo, which file, what it boots, what it drives, what it returns when it fails. Real details only, a short paste of the skill is welcome.]

[TO PROVIDE (Stan): what changed when you made it fast. Software Factory figures to confirm before they go in: CI from 4h27 to 4 min 30, and what that did to the way agents worked (fast local feedback). The client stays anonymous: "a software publisher". Monka may be named. Do not name any other client.]

## What to do this week

Open `.claude/skills/` in your main repo. If there's no `verify` skill, write the four-line version above for your own app's main flow, and run it until it gives the same answer every time. If a run disagrees with the last one, you have a flaky check, and the post's rule applies: find the root cause, don't add a retry.

Then make sure the change can't edit it: run the gate from the base branch, and start it in observe mode. Finally, take one bug that reached production and see whether the skill would have caught it. If you reuse the generic parts of a verify skill across repos, such as how to boot a simulator, publishing them as a versioned package keeps copies from drifting. [Skillpack](https://skillpack.app/login) installs a pinned version into Claude Code. For the rest of your skills, see [how to check agent skills in CI](/blog/how-to-check-agent-skills-in-ci), [how to create a Claude Code skill](/blog/how-to-create-a-claude-code-skill) and the [best Claude Code skills for testing](/blog/best-claude-code-skills-testing).

## FAQ

```faq
items:
  - question: "What is a Claude Code verify skill?"
    answer: "A verify skill is a skill named verify that codifies how to start your simulator or run your app so Claude can test its own changes end to end. The Claude Code team says to put it in a .claude/skills/ folder in your repo, as close to the relevant code as you can, and that Claude knows to use it before committing changes."
  - question: "Where do I put a verify skill?"
    answer: "Put it in a .claude/skills/ folder in your repo, as close to the relevant code as you can. The Claude Code team says you can add as many verify skills as you need, so a repo with several apps can have one next to each."
  - question: "How do I make a verify skill reliable?"
    answer: "Ask Claude to iterate on the skill and stress test it, since it is your smoke test harness. The Claude Code team also says flaky tests teach the agent to rerun them rather than fix the code, and that slow tests lead to fewer runs. Claude can't skip a flaky check, add sleeps or retry until it passes."
  - question: "Can a pull request change its own checks?"
    answer: "It shouldn't. The Claude Code team says that if a change can modify the check that judges it, the check is broken. Code Review reads REVIEW.md from the base or default branch, never from the pull request's changes. The post states this for REVIEW.md, not for a verify skill."
  - question: "How do I know my verify skill works?"
    answer: "Test it on bugs that mattered. The Claude Code team tracks reverted changes and changes a maintainer rejected before merging, and runs an evaluation built from past incidents, with a one-sentence answer key per bug and merged, stable changes as a control. A verify skill that passes on a known bad commit has a gap to turn into a rule."
  - question: "Should I enforce verification on every commit?"
    answer: "Start in observe mode. The Claude Code team's commit gate has off, observe and enforce modes, and observe logs what would have been blocked so you can review false positives first. In enforce mode a commit can carry an explanation for skipping verification, and after two blocks in a session the next commit is allowed through."
```
