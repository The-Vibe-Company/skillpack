---
title: "Best Claude Code Skills for Code Review in 2026: 7 Skills Compared | Skillpack"
description: "The 7 most-installed Claude Code skills for code review in 2026, ranked on public install counts, with maintainer, license, scope and a one-line install command for each."
slug: best-claude-code-skills-code-review
date: 2026-10-16
tags: ["Claude Code", "Agent Skills", "Code Review"]
author: "Stan Girard"
authorRole: "co-founder of The Vibe Company, which builds Skillpack"
layout: ranking
dataCollected: 2026-10-16
---

# Best Claude Code Skills for Code Review in 2026: 7 Skills Compared

The most-installed Claude Code skill for code review in 2026 is Matt Pocock's **code-review**, with 743.1K installs on skills.sh. It reviews a branch twice, once against your repo's coding standards and once against the issue it was meant to solve. The six others on this list do different jobs: terse PR comments, a review subagent, a method for handling feedback, a written review standard, CI output and a wrapper for the CodeRabbit CLI. Each one comes with the exact command to install it and share it with your team.

```cta
title: "Install any skill on this page with one command, and share it with your team."
text: "`skillpack install github:mattpocock/skills/skills/engineering/code-review` works without an account. Create a free Skillpack workspace to share skills across your organization."
primary: { label: "Create a free Skillpack workspace", href: /login }
```

```takeaways
title: Key Takeaways
items:
  - lead: "Matt Pocock's code-review is the most installed."
    text: "It runs two review subagents in parallel, one for your coding standards and one for the spec, and keeps their findings apart."
  - lead: "Reviewing and responding are separate skills."
    text: "obra's Superpowers splits them: requesting-code-review sends the diff to a fresh reviewer, receiving-code-review tells the agent how to handle what comes back."
  - lead: "Pick one style of output."
    text: "caveman-review writes one-line comments. Warp's review-pr writes a review.json for CI. CodeRabbit's skill runs the CodeRabbit CLI and needs an account."
  - lead: "Two of these skills share a name."
    text: "Matt Pocock's and CodeRabbit's are both called `code-review`. Install one of them, or install them in different scopes."
  - lead: "A shared review skill only helps if everyone runs the same version."
    text: "Pin the exact commit in a lockfile that lives in the repo."
```

## What code review skills actually do (and what they don't)

A Claude Code skill is a folder with a `SKILL.md` file. It holds instructions, and sometimes scripts or reference files, that the agent loads when a task matches the skill's description ([what is SKILL.md](/blog/what-is-skill-md)). A code review skill tells the agent how to review a change: which diff to read, what to look for, how to rank what it finds and how to write it up.

Most review skills don't add a new tool. They change the method. Matt Pocock's skill decides which diff to compare and what the two reviewers check. caveman-review only changes how comments are written. The exception here is CodeRabbit's skill, which drives an external CLI that sends your diff to the CodeRabbit API.

They aren't MCP servers either. An MCP server gives the agent access to a system, such as GitHub. A skill gives it the know-how to use that access well ([Agent Skills vs MCP](/blog/agent-skills-vs-mcp)). A review skill can tell the agent to read a pull request through the GitHub CLI, but the skill itself is just instructions.

They also overlap. Five of the seven skills below trigger on requests like "review this PR". Install three of them and the agent has to guess which method you meant, and you may get three review formats in one week. Pick one skill that writes the review, and add one that handles the feedback if you want.

## How we ranked these skills

We used four public, checkable criteria. All numbers were collected on October 16, 2026.

1. **Adoption**: all-time installs reported on [skills.sh](https://skills.sh), the open leaderboard for Agent Skills.
2. **Maintainer**: who maintains the skill (a named developer or a company), and the GitHub stars of its repository. Stars count the whole repository, not the individual skill.
3. **License clarity**: whether the skill or its repository declares an open-source license.
4. **Scope fit**: whether the skill performs the review, organizes it, or handles the feedback afterwards.

Adoption sets the order. The other three criteria are shown for every skill, so you can weigh them yourself. Skillpack isn't ranked. The Vibe Company, the author's company, builds Skillpack, the open-source tool used here to install and share skills, and it only appears in the install commands.

## The best Claude Code skills for code review in 2026

Install counts change every day, so treat this as a snapshot from October 16, 2026. Each entry gives the source, what the skill does, the numbers we could verify, and a Skillpack install command that points at the skill's real folder on GitHub. Add `--scope project` to install it in the current repo for Claude Code, Codex and OpenCode (the default tools), and `--share-org` to publish a copy to your Skillpack organization.

```skill-card
rank: 1
name: code-review
title: "code-review (Matt Pocock)"
maintainer: "Matt Pocock"
bestFor: "reviewing a branch against standards and spec"
source: { label: mattpocock/skills, url: "https://github.com/mattpocock/skills/tree/main/skills/engineering/code-review" }
repoStars: "293.2K"
installs:
  count: "743.1K"
  url: "https://skills.sh/mattpocock/skills/code-review"
license:
  name: "MIT"
  note: "repository LICENSE"
focus: "Two-axis review"
install: "skillpack install github:mattpocock/skills/skills/engineering/code-review --scope project"
description: |
  code-review reviews everything that changed since a fixed point you give it: a commit, a branch, a tag or `main`. It compares against the merge-base (`git diff <fixed-point>...HEAD`) and checks that the ref resolves and the diff isn't empty before doing anything else.

  The review runs on two axes, each in its own subagent so they don't pollute each other's context. **Standards** checks the diff against every file in the repo that documents how code should be written, with `CODING_STANDARDS.md` or `CONTRIBUTING.md` always included, plus a fixed baseline of twelve code smells from Fowler's *Refactoring* (Feature Envy, Shotgun Surgery, Speculative Generality and others). The repo's own rules always win over the baseline, and smells are reported as judgement calls, never hard violations. **Spec** looks for the originating issue in commit messages, a path you pass, or a spec file under `docs/`, `specs/` or `.scratch/`, then reports what's missing, what wasn't asked for and what looks wrong.

  The two reports come back side by side, deliberately not merged or reranked. The skill's reasoning: code can follow every standard and still build the wrong thing, or build the right thing and break every convention. One caveat: it expects an issue tracker to be configured and tells you to run `/setup-matt-pocock-skills` if it isn't, so it works best alongside the rest of the repository.
suitedFor: |
  teams with written coding standards and issues or specs for their work, who want a review that checks both. Less useful on a repo with no documented conventions and no spec, where only the smell baseline is left.
```

```skill-card
rank: 2
name: caveman-review
maintainer: "Julius Brussee"
bestFor: "short, paste-ready PR comments"
source: { label: juliusbrussee/caveman, url: "https://github.com/juliusbrussee/caveman/tree/main/skills/caveman-review" }
repoStars: "112.8K"
installs:
  count: "400.7K"
  url: "https://skills.sh/juliusbrussee/caveman/caveman-review"
license:
  name: "Apache 2.0"
  note: "repository LICENSE"
focus: "Comment format"
install: "skillpack install github:juliusbrussee/caveman/skills/caveman-review --scope project"
description: |
  caveman-review comes from Caveman, a project built around making agents say less. The skill applies that to code review: one line per finding, in the format `L<line>: <problem>. <fix>.`, with an optional severity prefix (🔴 bug, 🟡 risk, 🔵 nit, ❓ q).

  Most of the skill is a list of what to drop: "I noticed that…", hedging, compliments on every comment, and restating what the line already does. What it keeps is exact line numbers, symbol names in backticks and a concrete fix. Its own example turns a four-sentence comment about a missing null check into `L42: 🔴 bug: user can be null after .find(). Add guard before .email.`

  It knows when not to be terse. Security findings, architectural disagreements and reviews for someone new to the codebase get a normal paragraph. It's also strict about its scope: it writes comments ready to paste into a PR, and doesn't fix code, approve, request changes or run linters. That makes it a format, not a review method. It doesn't tell the agent what to look for.
suitedFor: |
  teams whose reviews get skipped because they're too long. Pair it with a skill that defines what to check, since caveman-review only defines how to say it.
```

```skill-card
rank: 3
name: requesting-code-review
maintainer: "Jesse Vincent (obra)"
bestFor: "a fresh reviewer for agent-written code"
source: { label: obra/superpowers, url: "https://github.com/obra/superpowers/tree/main/skills/requesting-code-review" }
repoStars: "300.2K"
installs:
  count: "254.2K"
  url: "https://skills.sh/obra/superpowers/requesting-code-review"
license:
  name: "MIT"
  note: "repository LICENSE"
focus: "Review subagent"
install: "skillpack install github:obra/superpowers/skills/requesting-code-review --scope project"
description: |
  requesting-code-review is part of Superpowers, Jesse Vincent's development methodology for coding agents. Its idea is simple: the agent that wrote the code shouldn't review it. Instead, it dispatches a reviewer subagent with precisely written context and "never your session's history".

  The skill takes a base and a head commit, a short description of what was built and the plan or requirements, and fills them into a prompt template in `code-reviewer.md`. That template is where most of the substance is. The reviewer treats the spec as a vision document, so a reasonable user's expectation counts as a requirement even when the spec is silent. It has to list every behavior it set aside as out of scope instead of dropping it quietly, and its review is read-only: no touching the working tree, the index or HEAD.

  Superpowers makes review mandatory after each task in subagent-driven development, after a major feature and before merging to main. Findings come back as Critical, Important or Minor, and the skill says to fix the first two before moving on. It's built for an agent reviewing its own output, not for reviewing a teammate's pull request.
suitedFor: |
  developers who let Claude Code implement multi-step plans and want a second pair of eyes after each step. It pairs naturally with receiving-code-review, from the same repository.
```

```skill-card
rank: 4
name: receiving-code-review
maintainer: "Jesse Vincent (obra)"
bestFor: "acting on review feedback without blind agreement"
source: { label: obra/superpowers, url: "https://github.com/obra/superpowers/tree/main/skills/receiving-code-review" }
repoStars: "300.2K"
installs:
  count: "214.4K"
  url: "https://skills.sh/obra/superpowers/receiving-code-review"
license:
  name: "MIT"
  note: "repository LICENSE"
focus: "Handling feedback"
install: "skillpack install github:obra/superpowers/skills/receiving-code-review --scope project"
description: |
  receiving-code-review covers the other half of the job: what the agent does once feedback arrives. Its core rule is "verify before implementing", and it bans "You're absolutely right!", "Great point!" and, more strictly, any thank-you at all. The fix itself shows that the feedback was heard.

  It gives the agent a six-step pattern: read the whole review, restate each item, check it against the codebase, decide whether it's right for this codebase, respond, then implement one item at a time and test each. If any item is unclear, the agent stops and asks before implementing anything, because the items may be related. For feedback from external reviewers, it adds a checklist (does this break existing behavior, is there a reason for the current code, does the reviewer have the full context?) and a YAGNI check: if a reviewer asks to implement something "properly", grep for real usage first.

  It also handles the social part honestly. It tells the agent when to push back, how to do it with technical reasoning, and how to admit it was wrong in one line. It doesn't review anything itself.
suitedFor: |
  anyone who has watched an agent accept every review comment, including the wrong ones. Install it next to whichever skill writes your reviews, including human ones.
```

```skill-card
rank: 5
name: code-review-and-quality
maintainer: "Addy Osmani"
bestFor: "a complete written review standard"
source: { label: addyosmani/agent-skills, url: "https://github.com/addyosmani/agent-skills/tree/main/skills/code-review-and-quality" }
repoStars: "107.1K"
installs:
  count: "64.6K"
  url: "https://skills.sh/addyosmani/agent-skills/code-review-and-quality"
license:
  name: "MIT"
  note: "repository LICENSE"
focus: "Five-axis checklist"
install: "skillpack install github:addyosmani/agent-skills/skills/code-review-and-quality --scope project"
description: |
  code-review-and-quality is the most thorough document on this list, at about 400 lines. It reviews every change on five axes: correctness, readability and simplicity, architecture, security and performance. Its approval standard is borrowed from good human review: approve a change when it clearly improves code health, even if it isn't how you'd have written it.

  Beyond the checklist, it covers things the other skills leave out. Change sizing: about 100 changed lines is good, about 300 is acceptable for one logical change, about 1,000 should be split, with four ways to split it. Severity labels so authors know what's required (no prefix), blocking (Critical), optional (Nit, Consider) or informational (FYI). A "review the tests first" step, and a multi-model pattern where one model writes, another reviews and a human makes the final call.

  The trade-off is length. It's written as much for people as for agents, and its description triggers before merging "any change". On a small repo, that's more process than you may want for every diff.
suitedFor: |
  teams that want their agents to follow a written review standard, or that don't have one yet and want a solid starting point to adapt.
```

```skill-card
rank: 6
name: review-pr
maintainer: "Warp"
bestFor: "machine-readable reviews in CI"
source: { label: warpdotdev/common-skills, url: "https://github.com/warpdotdev/common-skills/tree/main/.agents/skills/review-pr" }
repoStars: "613"
installs:
  count: "28.4K"
  url: "https://skills.sh/warpdotdev/common-skills/review-pr"
license:
  name: "MIT"
  note: "repository LICENSE"
focus: "CI review output"
install: "skillpack install github:warpdotdev/common-skills/.agents/skills/review-pr --scope project"
description: |
  review-pr is built for automated pipelines, not chat. It expects a checked-out PR branch, an annotated diff in `pr_diff.txt` and the description in `pr_description.txt`, and writes its whole output to `review.json` for a workflow to publish. It's explicitly forbidden from posting to GitHub itself.

  The output is strict. Each comment starts with 🚨 CRITICAL, ⚠️ IMPORTANT, 💡 SUGGESTION or 🧹 NIT, and nits are only allowed with a concrete suggestion block. Inline comments must point at a line that appears in the annotated diff. The skill spends a whole section on getting GitHub suggestion blocks right, down to matching bracket depth. Before the verdict, it audits every comment and test the diff adds against the repository's own guidelines. A bundled script, `scripts/validate_review_json.py`, checks the result before anything is returned.

  It's also designed to be extended. It looks for a companion `review-pr-local` skill in your repo for house conventions, and uses `security-review-pr` or `check-impl-against-spec` skills when they exist. Outside a pipeline that produces those input files, it's awkward to use by hand. Because it ships Python scripts, the Skillpack CLI lists them as executables when you install it.
suitedFor: |
  teams wiring an agent into CI to review every pull request, who want structured output they can validate and publish themselves.
```

```skill-card
rank: 7
name: coderabbit-code-review
title: "code-review (CodeRabbit)"
maintainer: "CodeRabbit"
bestFor: "teams already using CodeRabbit"
source: { label: coderabbitai/skills, url: "https://github.com/coderabbitai/skills/tree/main/skills/code-review" }
repoStars: "191"
installs:
  count: "14.1K"
  url: "https://skills.sh/coderabbitai/skills/code-review"
license:
  name: "MIT"
  note: "repository LICENSE"
focus: "CodeRabbit CLI"
install: "skillpack install github:coderabbitai/skills/skills/code-review --scope project"
description: |
  This skill is named `code-review` in its SKILL.md, the same as Matt Pocock's. We list it as coderabbit-code-review here only to tell the two apart. It's the official way to run CodeRabbit's review from inside your agent: the agent calls the CodeRabbit CLI with `--agent` for machine-readable output, reads the findings and their severities (critical, major, minor, trivial, info), and turns them into a task list.

  It supports the review scopes you'd expect: committed or uncommitted changes, untracked files, a base branch or commit, or a single directory. For "implement and review" requests, it describes a loop: build the feature, run the review, fix critical and major findings, re-run to verify, then stop rather than loop forever.

  It's the only skill here that depends on an outside service. The CLI must be installed and signed in, and the skill says plainly that it sends code diffs to the CodeRabbit API, so it tells the agent to check the scope for secrets before running. It's also careful with credentials: the agent never starts a login or touches tokens itself.
suitedFor: |
  teams that already use CodeRabbit on their pull requests and want the same review locally before pushing. If you don't use CodeRabbit, one of the self-contained skills above is the simpler choice.
```

## Side-by-side comparison

Ranked by adoption, with maintainer, license and scope shown for each skill. Data from skills.sh and GitHub, collected October 16, 2026. Stars are for each skill's whole GitHub repository.

```skill-comparison
```

```cta
title: "Settled on a review skill for the whole team?"
text: "Put it in one Skillpack workspace and pin it to an exact commit in `.companion/skills.lock.json`, so every developer and every agent reviews with the same rules."
primary: { label: "Start free", href: /login }
secondary: { label: "How to share Claude Code skills with your team", href: /blog/how-to-share-claude-code-skills-with-your-team }
```

## Which code review skill fits your use case

```use-cases
rows:
  - useCase: "Reviewing a branch against an issue or spec"
    start: "code-review"
    add: "receiving-code-review"
    why: "Two separate verdicts, then disciplined fixes"
  - useCase: "Agent-written code, step by step"
    start: "requesting-code-review"
    add: "receiving-code-review"
    why: "A fresh reviewer after each task, and no blind agreement"
  - useCase: "Review comments nobody reads"
    start: "caveman-review"
    add: "code-review-and-quality"
    why: "A clear checklist, written up in one line per finding"
  - useCase: "No written review standard yet"
    start: "code-review-and-quality"
    add: "caveman-review"
    why: "A full standard to adapt, with short output"
  - useCase: "Automated review on every pull request"
    start: "review-pr"
    add: "code-review-and-quality"
    why: "Validated JSON for CI, guided by a written standard"
  - useCase: "Team already on CodeRabbit"
    start: "coderabbit-code-review"
    add: "receiving-code-review"
    why: "The same findings locally, and careful handling of each one"
```

## How to install and share these skills with your team

Each command above installs a public GitHub folder with the Skillpack CLI, without an account. The CLI resolves the branch or tag to an exact commit, shows you the source and any executable files, and asks before copying anything. It never runs package scripts. With `--scope project`, the skill lands in `.agents/skills/`, which OpenCode reads, with managed copies in `.claude/skills/` for Claude Code and `.codex/skills/` for Codex. The exact commit is recorded in `.companion/skills.lock.json`. Commit that lockfile, and `skillpack sync --frozen` gives every teammate and every CI run the same files ([full install guide](/blog/how-to-install-skills-in-claude-code)).

That matters more for review than for most skills. If half the team reviews with last month's version of a skill and the other half with today's, you get two review standards without anyone deciding it.

Name clashes are handled too. Matt Pocock's and CodeRabbit's skills are both called `code-review`. If one is already installed in a project, the CLI refuses to install the other one over it and tells you to remove the first installation or pick another scope.

A skill can also be installed by hand: copy its folder into `.claude/skills/` in your repository, and Claude Code picks it up. Nothing records which commit you copied, though, so keeping teammates on the same version is up to you.

To share a skill with your organization, add `--share-org`. Once the CLI is signed in to your Skillpack workspace, it publishes a copy there and keeps the license and GitHub provenance. It refuses to overwrite an organization skill that already has the same name:

```bash
skillpack install github:mattpocock/skills/skills/engineering/code-review --scope project --share-org
```

Skillpack is open source (MIT) and self-hostable. The Free plan includes up to 20 organization skills, and Pro costs $10 per seat per month.

## FAQ

```faq
items:
  - question: "What is the best Claude Code skill for code review?"
    answer: "By installs on skills.sh, it's Matt Pocock's code-review, with 743.1K installs on October 16, 2026. It's MIT-licensed and maintained in mattpocock/skills. The best fit depends on the job, though: see the use case table above."
  - question: "How do I install a code review skill in Claude Code?"
    answer: "Run `skillpack install github:owner/repo/path`, for example `skillpack install github:mattpocock/skills/skills/engineering/code-review`. Add `--scope project` to install it in the current repository. You can also copy the skill's folder into `.claude/skills/` by hand."
  - question: "Can an agent review its own code?"
    answer: "It works better with a separate reviewer. Both requesting-code-review and Matt Pocock's code-review hand the diff to subagents with fresh context instead of reviewing in the session that wrote the code."
  - question: "How many review skills should I install?"
    answer: "Usually one that writes the review and, optionally, one that handles feedback, such as receiving-code-review. Several review skills that trigger on the same request can produce inconsistent reviews."
  - question: "Do these skills send my code anywhere?"
    answer: "Six of the seven don't call any outside service: they give your agent instructions, and Warp's review-pr also ships two local Python scripts. CodeRabbit's skill runs the CodeRabbit CLI, which sends code diffs to the CodeRabbit API."
  - question: "What licenses do these skills use?"
    answer: "Six are MIT. caveman-review is Apache 2.0. All seven declare their license at the repository level."
  - question: "How do I keep the same review skill across my team?"
    answer: "Pin it to an exact commit in a lockfile committed to the repo, and share it through one workspace. See [how to share Claude Code skills with your team](/blog/how-to-share-claude-code-skills-with-your-team)."
```

## Try Skillpack for free

Once you've picked a review skill, the next step is making sure everyone reviews with the same one. Skillpack installs any public skill from GitHub with one command. It pins the exact commit in a lockfile you can commit. It shares skills with your whole organization, with license and source kept. It's open source and free for up to 20 organization skills. [Create your free Skillpack workspace](/login) and share your first skill in a few minutes.

```cta
title: "Your team's skills, in one place."
primary: { label: "Sign up free for Skillpack", href: /login }
sticky: true
```
