---
title: "Best Codex Skills in 2026: Ranked by Real Installs"
description: "The best Codex skills on November 12, 2026, ranked by skills.sh installs: 8 picks, what each one needs, and how to pin them so your team runs one version."
slug: best-codex-skills
date: 2026-11-12
tags: ["Codex", "Agent Skills", "OpenAI", "Superpowers", "Skillpack CLI"]
author: "Stan Girard"
authorRole: "co-founder of The Vibe Company, which builds Skillpack"
layout: ranking
dataCollected: 2026-11-12
---

# Best Codex Skills in 2026

The best Codex skills on November 12, 2026 start with two from a community repository, Jesse Vincent's obra/superpowers: brainstorming (425.9K installs on skills.sh) and systematic-debugging (329.9K). The next six come from OpenAI's own catalog, openai/skills, led by security-best-practices (12.4K) and gh-fix-ci (11.9K). That catalog's [README](https://github.com/openai/skills#readme) now begins with a warning: "This repository is deprecated." So six of the eight skills on this page live in a repository whose own README sends you elsewhere. And the install counts beside them cover every agent, Codex or otherwise.

```takeaways
title: Key Takeaways
items:
  - lead: "The top two are process skills."
    text: "brainstorming holds the build until you approve a design doc. systematic-debugging refuses a fix before the root cause. Both are MIT-licensed and come from obra/superpowers."
  - lead: "A deprecated catalog supplies ranks 3 to 8."
    text: "The openai/skills README points you to openai/plugins, yet the same README still shows how to install its curated skills by name."
  - lead: "Look at what Codex bundles first."
    text: "skill-creator and skill-installer arrive with Codex, enabled by default, so this ranking skips them."
  - lead: "Install counts span agents."
    text: "skills.sh counts installs made through its own skills CLI and shows one total per skill, with no Codex figure."
  - lead: "Lock what you install."
    text: "A lockfile committed to the repo records the exact commit, and one command restores it on a teammate's machine."
```

## A Codex skill is a folder that Codex finds in `.agents/skills`

The Codex docs define a skill as "a directory with a `SKILL.md` file plus optional scripts and references", and that file must include a `name` and a `description`. Codex starts with each skill's name, description and file path, then loads the full instructions when it decides to use the skill. You can also call one yourself. In the Codex CLI or the IDE extension, type `$` to mention it.

In a repository, Codex [scans `.agents/skills`](https://developers.openai.com/codex/skills#where-codex-loads-local-skills) in every directory from where you launched it up to the repository root. The guide on [how to use skills in Codex](/blog/how-to-use-skills-in-codex) covers the personal, admin and system locations. For this ranking, one folder matters: `.agents/skills` at the root of your repo, which the docs describe as the place for skills "relevant to everyone using the repository". Before you add anything to it, check what Codex already gave you.

## Codex already ships skill-creator and skill-installer

The Codex docs list a system location, "Bundled with Codex by OpenAI", which "Includes `skill-creator` and `skill-installer`" and is "Enabled by default." The openai/skills README adds that skills in its `.system` folder "are automatically installed in the latest version of Codex". On November 12, 2026 that folder held five: imagegen, openai-docs, plugin-creator, skill-creator and skill-installer.

This list ranks none of the five, because you already have them. For reference, skills.sh shows 6.9K installs for openai-docs, 6.2K for imagegen, 5.2K for skill-creator, 3.9K for skill-installer and 2.7K for plugin-creator.

Three of them have one specific job each. openai-docs answers from the official OpenAI developer docs, with citations. imagegen generates or edits raster images. plugin-creator scaffolds a plugin directory with its `.codex-plugin/plugin.json`. The other two shape everything else on this page.

skill-installer fetches OpenAI's curated skills by name. The README's example is `$skill-installer gh-address-comments`. Its `SKILL.md` says it installs into `$CODEX_HOME/skills/<skill-name>`, which defaults to `~/.codex/skills`. That's a folder in your home directory, outside the repository your teammates clone. It's the reason the commands on this page write into the repo instead.

skill-creator is where your own skill starts. Type `$skill-creator` and, in the words of [the docs](https://developers.openai.com/codex/skills#create-a-skill), "The creator asks what the skill does, when it should trigger, and whether it should stay instruction-only or include scripts." Instruction-only is the default. Its `SKILL.md` lays out six steps, from concrete examples to a validation script that checks the frontmatter format, the required fields and the naming rules. For a longer walkthrough of writing a `SKILL.md`, see [how to create a skill](/blog/how-to-create-a-claude-code-skill).

So Codex hands you the tools to fetch and to write skills. Which ones to fetch is the open question, and it needs a rule.

## Installs set the order, and they count every agent

The pool is what OpenAI itself distributes for Codex, which means two catalogs. The older one is openai/skills, deprecated in its README but not archived. The current one is openai/plugins, with 536 `SKILL.md` files. It includes a superpowers plugin whose manifest names Jesse Vincent as author and github.com/obra/superpowers as its homepage. That's how a community repository ends up at the top of a list drawn from OpenAI's catalogs.

From that pool, this list keeps skills for general software work. It drops anything that needs an account with a third-party product such as Linear, Figma or Sentry. It drops anything tied to one framework or platform, and domain packs such as life sciences or investing. Each job gets one skill. No repository gets more than two, because without that cap four more superpowers skills would sit above every openai/skills entry on this page.

What remains is ordered by the install count on each skill's skills.sh page, read on November 12, 2026. Know what that number measures. The [skills.sh FAQ](https://skills.sh/docs/faq) says the leaderboard "is powered by anonymous telemetry data from the skills CLI". So a count means installs made with that CLI, for any agent. No Codex-only split exists on the page. Stars are coarser still. skills.sh shows the star count of the whole repository, which is why the six openai/skills entries share the same 28.7K.

The author ran every install command on this page through a Skillpack CLI 0.3.5 dry run that same day, and each one exited with code 0. The research did not include running Codex itself, so each card describes what the skill's `SKILL.md` says today. Disclosure: Skillpack is built by The Vibe Company, the author's company. Skillpack is not ranked and only appears as the install command.

## The best Codex skills, ranked by skills.sh installs

Each card carries one install command, and its flags look odd on a Codex page: `--scope project --tools opencode`. The reason is the target folder. With the `opencode` target, the Skillpack CLI writes only `.agents/skills/<name>`, the folder Codex reads in a repository. The command works without an account.

```skill-card
rank: 1
name: brainstorming
maintainer: "Jesse Vincent (obra)"
bestFor: "Settling the design before Codex writes any code"
source: { label: obra/superpowers, url: "https://github.com/obra/superpowers/tree/main/skills/brainstorming" }
repoStars: "316.3K"
installs:
  count: "425.9K"
  url: "https://skills.sh/obra/superpowers/brainstorming"
license:
  name: "MIT"
  note: "repository LICENSE"
focus: "Design before code"
install: "skillpack install github:obra/superpowers/skills/brainstorming --scope project --tools opencode"
description: |
  brainstorming exists to find out what you want, and why, before anything gets built. When a request leaves something important open, the agent asks its questions one at a time, lays out the approaches for you to pick from, writes a design doc and waits. The gate in its SKILL.md reads: "Nothing gets built until your human partner approves the design doc."

  A quick, clear task skips all of that. The SKILL.md example is "make the icon cornflower blue". You can also opt out of the questions, and the gate goes with them. In a software repo, the design doc goes to `docs/superpowers/specs/` and gets committed.
suitedFor: |
  New features, new components and behavior changes, the cases its description names. Limit: once you approve the design, its next step is to invoke `superpowers:writing-plans`, a separate skill that the two-per-repository cap keeps off this list.
```

```skill-card
rank: 2
name: systematic-debugging
maintainer: "Jesse Vincent (obra)"
bestFor: "Finding the root cause before any fix"
source: { label: obra/superpowers, url: "https://github.com/obra/superpowers/tree/main/skills/systematic-debugging" }
repoStars: "316.3K"
installs:
  count: "329.9K"
  url: "https://skills.sh/obra/superpowers/systematic-debugging"
license:
  name: "MIT"
  note: "repository LICENSE"
focus: "Debugging"
install: "skillpack install github:obra/superpowers/skills/systematic-debugging --scope project --tools opencode"
description: |
  systematic-debugging opens with what it calls the Iron Law: "NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST". It then walks four phases in order: root cause investigation, pattern analysis, hypothesis and testing, implementation. The agent forms a single hypothesis, makes the smallest possible change to test it, and changes one variable at a time.

  Its stop rule is the part to remember. After three or more failed fixes, the skill tells the agent to stop and question the architecture with you before it tries another patch.
suitedFor: |
  Any bug, test failure or unexpected behavior, per its description. Limit: the implementation phase calls on two other superpowers skills, `test-driven-development` and `verification-before-completion`, and this command installs neither.
```

After rank 2 the counts fall from 329.9K to 12.4K, and the source changes with them. skills.sh doesn't split installs by agent, so the gap shows how widely superpowers is installed across agents, not how often Codex users pick it. Ranks 3 to 8 are OpenAI's own skills from openai/skills, each with an Apache 2.0 `LICENSE.txt` in its folder.

```skill-card
rank: 3
name: security-best-practices
maintainer: "OpenAI"
bestFor: "Security reviews in Python, JavaScript/TypeScript and Go"
source: { label: openai/skills, url: "https://github.com/openai/skills/tree/main/skills/.curated/security-best-practices" }
repoStars: "28.7K"
installs:
  count: "12.4K"
  url: "https://skills.sh/openai/skills/security-best-practices"
license:
  name: "Apache 2.0"
  note: "skill LICENSE.txt"
focus: "Security review"
install: "skillpack install github:openai/skills/skills/.curated/security-best-practices --scope project --tools opencode"
description: |
  security-best-practices identifies the languages and frameworks in your project, then loads the matching guidance from its `references/` folder. It works in three ways: writing secure-by-default code, flagging critical issues it meets while working, and producing a full report when you ask for one.

  The report goes to `security_best_practices_report.md`, with sections by severity, a numeric ID per finding and line numbers for the code it cites. Fixes come after you have read the report, one finding at a time. The Skillpack dry run listed no executable files for this skill.
suitedFor: |
  Projects in Python, JavaScript/TypeScript or Go that need a written security report. Limit: its description says to trigger only on an explicit security request, and not for general code review or debugging, so say that a security review is what you want.
```

```skill-card
rank: 4
name: gh-fix-ci
maintainer: "OpenAI"
bestFor: "Failing GitHub Actions checks on a pull request"
source: { label: openai/skills, url: "https://github.com/openai/skills/tree/main/skills/.curated/gh-fix-ci" }
repoStars: "28.7K"
installs:
  count: "11.9K"
  url: "https://skills.sh/openai/skills/gh-fix-ci"
license:
  name: "Apache 2.0"
  note: "skill LICENSE.txt"
focus: "CI repair"
install: "skillpack install github:openai/skills/skills/.curated/gh-fix-ci --scope project --tools opencode"
description: |
  gh-fix-ci uses the GitHub CLI to find the failing checks on your pull request, fetch the GitHub Actions logs and summarize the failure snippet. Its bundled Python script, `scripts/inspect_pr_checks.py`, does the fetching and exits non-zero while failures remain.

  The agent then drafts a fix plan and, in the words of the description, implements "only after explicit approval". By default it works on the pull request of your current branch. Authenticate `gh` first: the SKILL.md has the agent run `gh auth status` and says repo and workflow scopes are typically required.
suitedFor: |
  Repositories whose pull request checks run in GitHub Actions. Limit: other CI providers are out of scope. For a check that runs elsewhere (the description names Buildkite), the skill reports the details URL and stops there.
```

```skill-card
rank: 5
name: playwright
maintainer: "OpenAI"
bestFor: "Driving a real browser from the terminal"
source: { label: openai/skills, url: "https://github.com/openai/skills/tree/main/skills/.curated/playwright" }
repoStars: "28.7K"
installs:
  count: "9.4K"
  url: "https://skills.sh/openai/skills/playwright"
license:
  name: "Apache 2.0"
  note: "skill LICENSE.txt"
focus: "Browser automation"
install: "skillpack install github:openai/skills/skills/.curated/playwright --scope project --tools opencode"
description: |
  playwright teaches the agent to drive a real browser with `playwright-cli`: navigation, form filling, snapshots, screenshots, data extraction and UI-flow debugging. The loop is to open the page, snapshot it to get element refs, interact through those refs, and snapshot again after the page changes.

  A bundled wrapper, `scripts/playwright_cli.sh`, lets the CLI run without a global install. The wrapper depends on `npx`, so the skill checks for it first and asks you to install Node.js/npm if it's missing. The skill is CLI-first: it tells the agent not to pivot to `@playwright/test` unless you explicitly ask for test files.
suitedFor: |
  Walking through a UI flow or pulling data from a page, straight from the terminal. Limit: its setup snippet sets the wrapper path under `$CODEX_HOME/skills/playwright` (default `~/.codex/skills`), which is not where a project install puts the script.
```

```skill-card
rank: 6
name: screenshot
maintainer: "OpenAI"
bestFor: "Desktop and window screenshots at the OS level"
source: { label: openai/skills, url: "https://github.com/openai/skills/tree/main/skills/.curated/screenshot" }
repoStars: "28.7K"
installs:
  count: "6.4K"
  url: "https://skills.sh/openai/skills/screenshot"
license:
  name: "Apache 2.0"
  note: "skill LICENSE.txt"
focus: "OS-level screenshots"
install: "skillpack install github:openai/skills/skills/.curated/screenshot --scope project --tools opencode"
description: |
  screenshot captures the full screen, a specific app or window, or a pixel region. A Python helper covers macOS and Linux, and a PowerShell helper covers Windows. On macOS, a preflight script checks the Screen Recording permission and requests it in one place.

  The skill defers to better tools. It tells the agent to prefer tool-specific capture when available, such as Playwright for browsers, and to use OS-level capture when you ask for it or when the other tool can't get what you need. Three rules decide where the file goes: your path if you give one, the OS default screenshot location if you don't, and the temp directory when Codex needs the image for its own inspection.
suitedFor: |
  Desktop apps that have no better-integrated capture tool. Limit: `--app`, `--window-name` and `--list-windows` are macOS-only, and on Linux the helper needs `scrot`, `gnome-screenshot` or ImageMagick's `import` installed.
```

```skill-card
rank: 7
name: jupyter-notebook
maintainer: "OpenAI"
bestFor: "Scaffolding experiment and tutorial notebooks"
source: { label: openai/skills, url: "https://github.com/openai/skills/tree/main/skills/.curated/jupyter-notebook" }
repoStars: "28.7K"
installs:
  count: "5.9K"
  url: "https://skills.sh/openai/skills/jupyter-notebook"
license:
  name: "Apache 2.0"
  note: "skill LICENSE.txt"
focus: "Jupyter notebooks"
install: "skillpack install github:openai/skills/skills/.curated/jupyter-notebook --scope project --tools opencode"
description: |
  jupyter-notebook creates, scaffolds and edits `.ipynb` files in two kinds: `experiment` for exploratory work and `tutorial` for step-by-step teaching. To avoid hand-authoring raw notebook JSON, the agent runs the bundled `new_notebook.py`, which loads a template from the skill's `assets/` folder, updates the title cell and writes the notebook.

  The script uses only the Python standard library, and the SKILL.md examples launch it with `uv run --python 3.12`. The last step is validation: run the notebook top to bottom when the environment allows, then go through the skill's quality checklist.
suitedFor: |
  Experiments and tutorials that other people will read or re-run. Limit: as with playwright, the setup snippet points at `$CODEX_HOME/skills/jupyter-notebook` (default `~/.codex/skills`), which is not where a project install puts the script.
```

```skill-card
rank: 8
name: gh-address-comments
maintainer: "OpenAI"
bestFor: "Working through pull request review comments"
source: { label: openai/skills, url: "https://github.com/openai/skills/tree/main/skills/.curated/gh-address-comments" }
repoStars: "28.7K"
installs:
  count: "5.1K"
  url: "https://skills.sh/openai/skills/gh-address-comments"
license:
  name: "Apache 2.0"
  note: "skill LICENSE.txt"
focus: "PR review comments"
install: "skillpack install github:openai/skills/skills/.curated/gh-address-comments --scope project --tools opencode"
description: |
  gh-address-comments finds the open pull request for your current branch and runs its bundled `scripts/fetch_comments.py` to print the comments and review threads. The agent numbers them, summarizes what each fix would require, and asks which numbers you want addressed. Then it applies fixes for the ones you chose.

  Like gh-fix-ci, it needs an authenticated GitHub CLI, and its SKILL.md says to run all `gh` commands with elevated network access.
suitedFor: |
  A pull request with many review comments to sort. Limit: the SKILL.md stops at applying the selected fixes. It has no step for replying to reviewers or resolving threads.
```

```cta
title: "Found the skills your repo needs?"
text: "`skillpack install` works without an account. Create a free Skillpack workspace when you want to publish a skill to your organization with `--share-org`."
primary: { label: "Create a free Skillpack workspace", href: /login }
```

## Eight skills side by side

The table repeats four fields from the cards: installs, repo stars, license and focus. The installs column separates the skills. The stars column can't. The site shows one star count per repository, so both superpowers skills read 316.3K and the other six read 28.7K.

```skill-comparison
```

## The job in front of you picks the first skill

A ranking by installs answers "what do other people install". Your question is narrower. Start from the problem you hit this week, install one skill for it, and add a second once the first has earned its place.

Check the prerequisites before you commit to one. gh-fix-ci and gh-address-comments both need `gh` authenticated. playwright needs `npx`. The jupyter-notebook examples call `uv`. On Linux, screenshot needs one of three capture tools. The skills say so themselves: playwright, for one, is written to pause and ask you to install Node.js/npm when `npx` is missing.

```use-cases
rows:
  - useCase: "Codex builds before it understands the request"
    start: "brainstorming"
    add: "security-best-practices"
    why: "An approved design doc first, then new code written secure by default"
  - useCase: "A red check on your pull request"
    start: "gh-fix-ci"
    add: "systematic-debugging"
    why: "The failing GitHub Actions logs and a fix plan, then the root cause before the fix"
  - useCase: "A review with many comments"
    start: "gh-address-comments"
    add: "gh-fix-ci"
    why: "Choose the comments to fix by number, then handle any check that fails afterward"
  - useCase: "A UI bug you need to see"
    start: "playwright"
    add: "screenshot"
    why: "A real browser driven from the terminal, plus OS-level capture for desktop apps"
  - useCase: "An analysis or tutorial to hand to someone"
    start: "jupyter-notebook"
    add: "brainstorming"
    why: "A notebook scaffolded from a template, after the questions about what it should show"
  - useCase: "A workflow your team keeps repeating"
    start: "skill-creator (bundled)"
    add: "skill-installer (bundled)"
    why: "Draft your own skill with `$skill-creator`, and fetch OpenAI's curated ones by name"
```

The table stays inside this page's pool. For skills from other publishers, the [best Claude Code skills](/blog/best-claude-code-skills) hub ranks a wider field.

## The filters cut five skills with more installs than rank 3

Install counts did not decide everything. OpenAI's pdf skill shows 13.8K installs, above security-best-practices, but it handles documents and this list covers software work. Four more superpowers skills dwarf the OpenAI entries: writing-plans (301.0K), requesting-code-review (278.7K), test-driven-development (277.3K) and subagent-driven-development (254.0K). The two-per-repository cap keeps them out, and the superpowers plugin in openai/plugins includes all four.

Three other skills from openai/skills fell to a filter. The linear skill (10.8K) needs a Linear account. The one-skill-per-job filter cut the other two: security-threat-model (9.0K) duplicates security-best-practices, and playwright-interactive (5.7K) duplicates playwright.

The top two cards point at obra/superpowers, the upstream repository. OpenAI's copies inside openai/plugins have their own skills.sh pages, at 40 installs for brainstorming and 44 for systematic-debugging. The brainstorming copy differs from upstream today in its description and its body. The 425.9K figure belongs to the upstream skill, so that's the one each command installs.

If the superpowers plugin appears in your plugin browser, it's a fair route to the whole set. In the Codex CLI, enter `/plugins` to [open that browser](https://developers.openai.com/codex/plugins#plugin-browser-in-codex-cli), and start a new session before you use a plugin's bundled skills. That route has one limit. The Codex docs say the IDE extension [doesn't support plugins](https://developers.openai.com/codex/plugins#use-plugins-from-a-supported-surface), while standalone skills are available there.

A count tells you a skill is popular. It says nothing about which version lands in your repo, and for a deprecated catalog that's the part to settle before you install.

## Lock gh-fix-ci to a commit, because its repository can still change

Take gh-fix-ci, rank 4, and install it the way a team would. From the root of your repository, preview the install:

```bash
skillpack install github:openai/skills/skills/.curated/gh-fix-ci --scope project --tools opencode --dry-run
```

On November 12, 2026, the Skillpack CLI 0.3.5 dry run printed this before its JSON summary:

```text
Requested ref: (default branch)
Previous commit: 49f948faa9258a0c61caceaf225e179651397431
Target (shared, project): .agents/skills/gh-fix-ci
WARNING: This third-party skill has not been verified by Skillpack.
Source: https://github.com/openai/skills/tree/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/gh-fix-ci
Commit: 49f948faa9258a0c61caceaf225e179651397431
Executable files: scripts/inspect_pr_checks.py
Its instructions may cause your agent to run commands or access your files and credentials.
Skillpack will only copy files; it will never run package scripts.
```

Read it from the top. There is one target, `.agents/skills/gh-fix-ci`, inside the folder Codex scans. The CLI warns that Skillpack has not verified this third-party skill and names the one executable file inside it. Then it states its own limit: it copies files and never runs package scripts. `Previous commit` shows a hash because the test directory already held the skill from an earlier install. On that first install, the line was empty.

That executable line deserves a second look, because gh-fix-ci is no exception. The dry runs listed executable files for seven of the eight skills. The brainstorming folder carries five, including the scripts that start and stop its local server. The screenshot folder carries six. security-best-practices was the one that printed `Executable files: none`. Skillpack won't run any of them. Your agent might. The same output warns that a skill's instructions "may cause your agent to run commands or access your files and credentials." Open the scripts first.

That first install used `--tools codex`, and it shows why the cards don't. The CLI printed a second target, `Target (codex, project): .codex/skills/gh-fix-ci`, and wrote the same six files into both folders. The Codex docs name `.agents/skills` as the repository location. They also say that when two skills share a `name`, Codex doesn't merge them and "both can appear in skill selectors." One copy in the documented folder is simpler. If your repo already holds both, [Codex skills not loading](/blog/codex-skills-not-working) shows how to find the extra one.

That install also left `.companion/skills.lock.json` in the repo. The lockfile [records the repository, the path and the commit](https://github.com/The-Vibe-Company/skillpack/blob/main/docs/skillpack-cli.md). Here those are openai/skills, `skills/.curated/gh-fix-ci` and the `49f948f` hash from the output above. The commit is what protects you. The README calls openai/skills deprecated, yet the repository is not archived and its last push dates from October 28, 2026, so its default branch can still change.

Commit the lockfile with the skill folder. A teammate then runs `skillpack sync --frozen`, which restores from the lockfile. In the test directory, that command reported `status: "verified"` and `lockChanged: false`. That install pins nothing. In the test lockfile, gh-fix-ci has `ref: null` and `pinned: null`, and a null ref tracks the default branch. To choose a ref yourself, the CLI accepts `@<ref>` on the source ([CLI docs](https://github.com/The-Vibe-Company/skillpack/blob/main/docs/skillpack-cli.md)).

Sharing has two routes. The first is the repo itself. With `.agents/skills/gh-fix-ci` and the lockfile committed, everyone who clones the repo gets the same files. The guide on [how to share skills with your team](/blog/how-to-share-claude-code-skills-with-your-team) covers that workflow. The second is [`--share-org`](https://github.com/The-Vibe-Company/skillpack/blob/main/docs/skillpack-cli.md), which publishes a copy to your Skillpack organization and needs an account.

One more command is worth knowing once you write skills of your own. In the test directory, `skillpack skills validate .agents/skills/gh-fix-ci` returned `valid: true` and `files: 6`. Point it at your own folder before you share it.

The catalog can stay deprecated. `skillpack sync --frozen` restores the commit in your lockfile, whatever the README says later. `skillpack update` follows the default branch unless you install with `--pin`. Open Codex in that repo on a branch with a failing check and type `$gh-fix-ci`. If the skill isn't offered, restart Codex, as its docs suggest. Then read the plan before you approve it, because the skill is written to wait for you.

## FAQ

```faq
items:
  - question: "What are the best Codex skills?"
    answer: "The best Codex skills by skills.sh installs on November 12, 2026, among the skills OpenAI distributes for Codex, are brainstorming (425.9K) and systematic-debugging (329.9K) from obra/superpowers. Six from OpenAI's openai/skills catalog follow: security-best-practices (12.4K), gh-fix-ci (11.9K), playwright (9.4K), screenshot (6.4K), jupyter-notebook (5.9K) and gh-address-comments (5.1K). Those counts cover installs through the skills CLI for any agent."
  - question: "Where does Codex look for skills?"
    answer: "Codex reads skills from repository, user, admin and system locations, according to the Codex docs. In a repository, Codex scans `.agents/skills` in every directory from your current working directory up to the repository root. User skills live in `$HOME/.agents/skills` and admin skills in `/etc/codex/skills`. System skills are bundled with Codex by OpenAI and include skill-creator and skill-installer."
  - question: "Is the openai/skills repository deprecated?"
    answer: "Yes. The openai/skills README states \"This repository is deprecated.\" and points to the OpenAI Plugins repository for current Codex skill and plugin examples. On November 12, 2026 the repository was not archived, its last push dated from October 28, 2026, and the README still explained how to install curated skills by name with `$skill-installer`. If you install from openai/skills, record the commit you installed."
  - question: "Do Claude Code skills work in Codex?"
    answer: "A Claude Code skill can work in Codex if it follows the open agent skills standard, because the Codex docs say Codex skills build on that standard: a directory with a `SKILL.md` file that includes `name` and `description`. The Codex docs don't mention Claude Code, and `.claude/skills` is not among the locations they list, so place the folder in `.agents/skills`. This article did not test a Claude Code skill in Codex."
  - question: "How do I create my own Codex skill?"
    answer: "To create your own Codex skill, invoke `$skill-creator` in Codex. The Codex docs say the creator asks what the skill does, when it should trigger, and whether it should stay instruction-only or include scripts. You can also create a folder by hand with a `SKILL.md` file that includes `name` and `description`. A third route in the docs is Record & Replay, which drafts a skill from a recorded workflow."
  - question: "Are skills.sh install counts specific to Codex?"
    answer: "No, skills.sh install counts are not specific to Codex. The skills.sh FAQ says its leaderboard is powered by anonymous telemetry data from the skills CLI, so a count reflects installs made with that CLI for any agent. The skill pages read on November 12, 2026 show one total per skill, with no split by agent. The GitHub Stars figure on those pages counts the whole repository."
  - question: "How do I share a Codex skill with my team?"
    answer: "To share a Codex skill with your team, commit the skill folder to `.agents/skills` in the repository. The Codex docs describe skills at the repository root as available to any subfolder. To keep one version, a Skillpack project install with `--tools opencode` writes `.agents/skills/<name>` and the lockfile `.companion/skills.lock.json`, and `skillpack sync --frozen` restores from it. For reusable distribution of your own skills, the Codex docs say to prefer plugins."
```
