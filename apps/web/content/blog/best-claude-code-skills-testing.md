---
title: "Best Claude Code Skills for Testing and TDD (2026)"
description: "Eight Claude Code skills for testing in 2026, ranked by skills.sh installs: agent-browser, TDD, Playwright, webapp-testing and Vitest, with install steps."
slug: best-claude-code-skills-testing
date: 2026-10-26
tags: ["Claude Code", "Agent Skills", "Testing", "TDD", "Playwright"]
author: "Stan Girard"
authorRole: "co-founder of The Vibe Company, which builds Skillpack"
layout: ranking
dataCollected: 2026-10-26
---

# Best Claude Code Skills for Testing in 2026

The most-installed Claude Code skill for testing is Vercel Labs' **agent-browser**, with 1.17M installs on skills.sh. It drives a real browser, and its own guide covers exploratory testing and QA. Matt Pocock's **tdd** skill is a close second, with 1.15M installs, and it's the most-installed skill for test-driven development. The other six cover strict test-first discipline, Playwright, local web app checks, regression tests for bug fixes and Vitest. Each entry has a one-line command to install it and share it with your team.

```cta
title: "Install any skill on this page with one command, and share it with your team."
text: "`skillpack install github:mattpocock/skills/skills/engineering/tdd` works without an account. Create a free Skillpack workspace to share skills across your organization."
primary: { label: "Create a free Skillpack workspace", href: /login }
```

```takeaways
title: Key Takeaways
items:
  - lead: "Testing skills do two different jobs."
    text: "Some teach the agent how to write tests (tdd, test-driven-development, vitest). Others let it check a running app in a browser (agent-browser, playwright-cli, webapp-testing)."
  - lead: "Pick one TDD skill, not three."
    text: "Matt Pocock's, obra's and Addy Osmani's TDD skills all enforce red before green. They differ in tone and in how much they ask of you."
  - lead: "Browser skills need a tool on your machine."
    text: "agent-browser and playwright-cli each need their own CLI installed globally. webapp-testing needs Python and Playwright."
  - lead: "Read the permissions."
    text: "agent-browser and playwright-cli pre-approve their own commands through `allowed-tools`, so the agent can run them without asking each time."
  - lead: "A shared test skill only helps if everyone runs the same version."
    text: "Pin the exact commit in a lockfile that lives in the repo, so every agent and CI run follows the same rules."
```

## What testing skills actually do

A Claude Code skill is a folder with a `SKILL.md` file. It holds instructions, and sometimes scripts or reference files, that the agent loads when a task matches the skill's description ([what is SKILL.md](/blog/what-is-skill-md)).

Agents can already write tests. The trouble is what they write by default. They often write the code first and the tests after, mock the very thing under test, or assert whatever the code happens to return. They also say "all tests pass" without running them. The skills below fix that in two ways.

**Test-writing skills** give the agent a method. They force a failing test before any production code, decide where tests belong, and list the anti-patterns to avoid. Some are framework references, like the Vitest skill.

**Browser testing skills** give the agent eyes on a running app. They open pages, click, fill forms, take snapshots and report what broke. Each one wraps a browser tool that runs on your machine.

None of them is an MCP server. A skill gives the agent know-how. An MCP server gives it access to a system ([Agent Skills vs MCP](/blog/agent-skills-vs-mcp)). Addy Osmani's TDD skill is the one entry here that points to an MCP server, Chrome DevTools MCP, for browser checks.

## How we ranked these skills

We looked at the most-installed skills on skills.sh whose main job is writing tests or testing an app. We kept one skill per repository and used four public criteria. All numbers were collected on October 26, 2026.

1. **Adoption**: all-time installs reported by [skills.sh](https://skills.sh), the open leaderboard for Agent Skills, through its public search API. The leaderboard can show slightly different totals for the same skill.
2. **Maintainer**: who maintains the skill, and the GitHub stars of its repository. Stars count the whole repository, not the individual skill.
3. **License clarity**: whether the skill or its repository declares an open-source license.
4. **Scope fit**: whether the skill writes tests, runs them in a browser, or checks the agent's own claims.

Adoption sets the order. The other criteria are shown for every skill so you can weigh them yourself. We left out skills tied to a single paid testing product, and copies of the same skill republished under other accounts. Skillpack isn't ranked. The Vibe Company, the author's company, builds Skillpack, the open-source tool used here to install and share skills. It only appears in the install commands.

## The best Claude Code skills for testing in 2026

Install counts change every day, so treat this as a snapshot from October 26, 2026. Each command below points at the skill's real folder on GitHub. We ran every one through the Skillpack CLI in dry-run mode on that date. Add `--scope project` to install it in the current repo for Claude Code, Codex and OpenCode. Add `--share-org` to publish a copy to your Skillpack organization.

```skill-card
rank: 1
name: agent-browser
maintainer: "Vercel Labs"
bestFor: "exploratory testing and QA of a running web app"
source: { label: vercel-labs/agent-browser, url: "https://github.com/vercel-labs/agent-browser/tree/main/skills/agent-browser" }
repoStars: "44.6K"
installs:
  count: "1.17M"
  url: "https://skills.sh/vercel-labs/agent-browser/agent-browser"
license:
  name: "Apache 2.0"
  note: "repository LICENSE"
focus: "Browser automation CLI"
install: "skillpack install github:vercel-labs/agent-browser/skills/agent-browser --scope project"
description: |
  agent-browser is a browser automation CLI built for AI agents. The skill itself is short. It's a discovery stub. It tells the agent to install the CLI with `npm i -g agent-browser && agent-browser install`, then load the current instructions from it. Those instructions ship with each CLI version, so they stay in step with the tool.

  Testing is one of its named jobs. Its description lists "test this web app", exploratory testing, dogfooding, QA and bug hunts. The command `agent-browser skills get dogfood` loads a dedicated guide for that. Other guides cover Electron apps, Slack and cloud browsers.

  Two things to know before you install. Its `allowed-tools` line pre-approves the `agent-browser` commands, so the agent runs them without asking. Its description also tells the agent to prefer agent-browser over any built-in browser tool. Because the real instructions come from the CLI, your Skillpack lockfile pins the stub, not the guides.
suitedFor: |
  teams who want the agent to click through a web app, find bugs and report them, without writing a test suite first.
```

```skill-card
rank: 2
name: tdd
maintainer: "Matt Pocock"
bestFor: "test-driven development with tests worth keeping"
source: { label: mattpocock/skills, url: "https://github.com/mattpocock/skills/tree/main/skills/engineering/tdd" }
repoStars: "303.5K"
installs:
  count: "1.15M"
  url: "https://skills.sh/mattpocock/skills/tdd"
license:
  name: "MIT"
  note: "repository LICENSE"
focus: "Red-green loop and test quality"
install: "skillpack install github:mattpocock/skills/skills/engineering/tdd --scope project"
description: |
  Matt Pocock's tdd skill is short and opinionated. It treats TDD as a red to green loop and spends most of its words on what makes a test worth keeping. Tests check behavior through public interfaces, so they survive a refactor.

  Its key idea is the seam: the public boundary where a test observes behavior. Before writing any test, the agent writes down the seams it wants to test and confirms them with you. No test goes on an unconfirmed seam. It also names three anti-patterns. Implementation-coupled tests break on a refactor. Tautological tests recompute the expected value the way the code does. Horizontal slicing writes every test before any code.

  The loop is strict. One seam, one test and one minimal implementation per cycle. Refactoring is left out of the loop and handed to a review step, which the skill links to the repository's `code-review` skill. The folder adds two guides, on tests and on mocking.
suitedFor: |
  developers who want TDD with a human in the loop, and who care more about useful tests than about test count.
```

```skill-card
rank: 3
name: obra-test-driven-development
title: "test-driven-development (obra)"
maintainer: "Jesse Vincent (obra)"
bestFor: "strict test-first discipline the agent can't talk its way out of"
source: { label: obra/superpowers, url: "https://github.com/obra/superpowers/tree/main/skills/test-driven-development" }
repoStars: "305.2K"
installs:
  count: "260.6K"
  url: "https://skills.sh/obra/superpowers/test-driven-development"
license:
  name: "MIT"
  note: "repository LICENSE"
focus: "The Iron Law of TDD"
install: "skillpack install github:obra/superpowers/skills/test-driven-development --scope project"
description: |
  This skill comes from Superpowers, Jesse Vincent's collection of workflow skills. It's built around one "Iron Law": no production code without a failing test first. If the agent wrote code before the test, the skill tells it to delete that code and start over.

  It walks through red, green and refactor, and makes the agent watch each test fail before writing code. Most of its length goes to the excuses an agent uses to skip a step. A table of common rationalizations answers each one, and a list of red flags tells the agent when to stop. The folder adds a guide on writing good tests.

  Pair it with [verification-before-completion](https://skills.sh/obra/superpowers/verification-before-completion) from the same repository (253.2K installs). Its rule is "no completion claims without fresh verification evidence". The agent must run the command and read the output before it says anything passes.
suitedFor: |
  teams whose agent keeps skipping tests or claiming success too early, and who want hard rules rather than advice.
```

```skill-card
rank: 4
name: playwright-cli
maintainer: "Microsoft"
bestFor: "driving Playwright from the agent and generating tests"
source: { label: microsoft/playwright-cli, url: "https://github.com/microsoft/playwright-cli/tree/main/skills/playwright-cli" }
repoStars: "14.6K"
installs:
  count: "196.1K"
  url: "https://skills.sh/microsoft/playwright-cli/playwright-cli"
license:
  name: "Apache 2.0"
  note: "repository LICENSE"
focus: "Official Playwright CLI"
install: "skillpack install github:microsoft/playwright-cli/skills/playwright-cli --scope project"
description: |
  This is Microsoft's official skill for Playwright CLI, a command-line version of Playwright made for coding agents. The project's README says CLI commands are more token-efficient than the Playwright MCP server. They don't push large tool schemas or page trees into the agent's context.

  The agent takes a snapshot of the page and gets a short reference for each element. It then acts on them with commands like click, fill and type. The skill covers tabs, storage, network mocking, tracing and video. Its reference files include a guide to test generation (plan, generate, heal) and one on writing Playwright tests. Another covers attaching screenshots and videos to pull requests.

  It needs Node.js 18 or newer and `npm install -g @playwright/cli@latest`. Like agent-browser, its `allowed-tools` line pre-approves `playwright-cli` and `npx playwright` commands.
suitedFor: |
  teams already on Playwright who want the agent to explore a page and turn what it finds into real test files.
```

```skill-card
rank: 5
name: webapp-testing
maintainer: "Anthropic"
bestFor: "testing a local web app with Python Playwright scripts"
source: { label: anthropics/skills, url: "https://github.com/anthropics/skills/tree/main/skills/webapp-testing" }
repoStars: "183.8K"
installs:
  count: "188.4K"
  url: "https://skills.sh/anthropics/skills/webapp-testing"
license:
  name: "Apache 2.0"
  note: "LICENSE.txt in the skill folder; the repository declares no license"
focus: "Local app checks in Python"
install: "skillpack install github:anthropics/skills/skills/webapp-testing --scope project"
description: |
  webapp-testing is Anthropic's own skill for checking a web app that runs on your machine. The agent writes native Python Playwright scripts rather than calling a separate CLI. A short decision tree tells it what to do: read static HTML directly, or start the server and inspect the page first.

  For dynamic apps, it follows a "reconnaissance-then-action" pattern. It waits for the network to go idle, takes a screenshot or reads the DOM, finds the right selectors, and only then acts. The skill warns that skipping the wait is a common mistake.

  The folder ships a helper, `scripts/with_server.py`, that starts one or more dev servers, runs your script and shuts them down. The Skillpack CLI flags it as an executable before copying it. You need Python and Playwright installed.
suitedFor: |
  developers who want quick checks of a frontend and its backend together, and who are comfortable with Python scripts.
```

```skill-card
rank: 6
name: playwright-best-practices
maintainer: "Currents"
bestFor: "writing and maintaining a Playwright test suite in TypeScript"
source: { label: currents-dev/playwright-best-practices-skill, url: "https://github.com/currents-dev/playwright-best-practices-skill/tree/main/playwright-best-practices" }
repoStars: "411"
installs:
  count: "98.5K"
  url: "https://skills.sh/currents-dev/playwright-best-practices-skill/playwright-best-practices"
license:
  name: "MIT"
  note: "declared in SKILL.md and the repository"
focus: "Playwright reference library"
install: "skillpack install github:currents-dev/playwright-best-practices-skill/playwright-best-practices --scope project"
description: |
  Currents, which makes a dashboard for Playwright testing, publishes this skill as a free reference. It's the largest folder on this list, with more than 50 guides. They cover locators, assertions, fixtures, page objects, authentication, network mocking, flaky tests, CI providers and sharding. Framework guides cover React, Next.js, Vue and Angular.

  It's activity-based. The `SKILL.md` maps tasks to guides, so the agent opens only the file it needs. A task like fixing a flaky test pulls in the debugging guides, not the CI ones. Testing patterns go beyond end-to-end tests: component, API, visual regression, accessibility, Electron and browser extensions.

  Note the gap between its installs and its 411 repository stars. Most of its adoption seems to come from people installing it through skills.sh rather than starring the repo.
suitedFor: |
  teams with a growing Playwright suite who want the agent to follow consistent patterns across every test file.
```

```skill-card
rank: 7
name: addyosmani-test-driven-development
title: "test-driven-development (Addy Osmani)"
maintainer: "Addy Osmani"
bestFor: "bug fixes that start with a failing regression test"
source: { label: addyosmani/agent-skills, url: "https://github.com/addyosmani/agent-skills/tree/main/skills/test-driven-development" }
repoStars: "110.6K"
installs:
  count: "61.9K"
  url: "https://skills.sh/addyosmani/agent-skills/test-driven-development"
license:
  name: "MIT"
  note: "repository LICENSE"
focus: "TDD with a test strategy"
install: "skillpack install github:addyosmani/agent-skills/skills/test-driven-development --scope project"
description: |
  Addy Osmani's TDD skill covers the same red-green loop, then adds a test strategy around it. It starts by having the agent find the repository's own test commands, and never assume a default like `npm test`.

  Its "Prove-It Pattern" is the part to steal. When a bug is reported, the agent doesn't start with the fix. It writes a test that reproduces the bug, watches it fail, fixes the code, then runs the full suite. The skill also describes a test pyramid with about 80% unit tests, and prefers real implementations over mocks.

  For browser checks it points to Chrome DevTools MCP. The same repository has a separate [browser-testing-with-devtools](https://skills.sh/addyosmani/agent-skills/browser-testing-with-devtools) skill (58.4K installs) that requires that MCP server.
suitedFor: |
  teams who want one skill that covers both the TDD loop and how many tests of each kind to write.
```

```skill-card
rank: 8
name: vitest
maintainer: "Anthony Fu"
bestFor: "writing Vitest tests against the current Vitest API"
source: { label: antfu/skills, url: "https://github.com/antfu/skills/tree/main/skills/vitest" }
repoStars: "6.0K"
installs:
  count: "43.7K"
  url: "https://skills.sh/antfu/skills/vitest"
license:
  name: "MIT"
  note: "repository LICENSE"
focus: "Vitest reference"
install: "skillpack install github:antfu/skills/skills/vitest --scope project"
description: |
  Anthony Fu generates this skill from the vitest-dev/vitest repository. Its `GENERATION.md` file records the exact source commit. The current version is based on Vitest 5.1.0-beta.1 and was generated on October 23, 2026.

  It doesn't teach a method. It's a reference, so the agent writes tests with the real API rather than one it half remembers. The `SKILL.md` is a set of tables that point to about 20 reference files. They cover configuration, the test API, hooks, mocking, coverage, snapshots, filtering, concurrency, type testing and benchmarking.

  It pairs well with one of the TDD skills above. The TDD skill decides when to write a test, and this one makes sure the Vitest code is right.
suitedFor: |
  TypeScript and Vite projects that use Vitest and want fewer outdated API calls in agent-written tests.
```

A few skills just missed the list. Samber's [golang-testing](https://skills.sh/samber/cc-skills-golang/golang-testing) (43.4K installs) covers testing in Go. Seth Hobson's [python-testing-patterns](https://skills.sh/wshobson/agents/python-testing-patterns) (37.2K) covers pytest and fixtures, and his [e2e-testing-patterns](https://skills.sh/wshobson/agents/e2e-testing-patterns) (24.4K) covers end-to-end tests.

## Side-by-side comparison

Ranked by adoption, with maintainer, license and scope shown for each skill. Data from skills.sh and GitHub, collected October 26, 2026. Stars are for each skill's whole GitHub repository.

```skill-comparison
```

```cta
title: "Settled on a testing stack for the whole team?"
text: "Put your testing skills in one Skillpack workspace and pin them to an exact commit in `.companion/skills.lock.json`, so every developer, agent and CI run follows the same rules."
primary: { label: "Start free", href: /login }
secondary: { label: "How to share Claude Code skills with your team", href: /blog/how-to-share-claude-code-skills-with-your-team }
```

## Which testing skill fits your use case

```use-cases
rows:
  - useCase: "New features built test-first"
    start: "tdd (Matt Pocock)"
    add: "vitest"
    why: "Agreed seams and vertical slices, with the current Vitest API"
  - useCase: "An agent that skips tests or claims success too early"
    start: "test-driven-development (obra)"
    add: "verification-before-completion"
    why: "Hard rules before code, and proof before any success claim"
  - useCase: "Fixing a reported bug"
    start: "test-driven-development (Addy Osmani)"
    add: "tdd (Matt Pocock)"
    why: "A failing regression test first, then the fix"
  - useCase: "QA pass on a running web app"
    start: "agent-browser"
    add: "webapp-testing"
    why: "Exploratory testing in a real browser, plus scripted checks"
  - useCase: "Growing a Playwright test suite"
    start: "playwright-best-practices"
    add: "playwright-cli"
    why: "Consistent patterns, plus an agent that can explore and generate tests"
  - useCase: "Local frontend and backend checked together"
    start: "webapp-testing"
    add: "verification-before-completion"
    why: "Servers started for you, and results read before anything is called done"
```

## How to install and share these skills with your team

Each command above installs a public GitHub folder with the Skillpack CLI, without an account. The CLI resolves the branch or tag to an exact commit, shows you the source and any executable files, and asks before copying anything. It never runs package scripts. With `--scope project`, the skill lands in `.agents/skills/`, which OpenCode reads, with managed copies in `.claude/skills/` for Claude Code and `.codex/skills/` for Codex. The exact commit is recorded in `.companion/skills.lock.json`. Commit that lockfile, and `skillpack sync --frozen` gives every teammate and every CI run the same files ([full install guide](/blog/how-to-install-skills-in-claude-code)).

Version drift matters more for testing skills than most. Say one developer's agent follows last month's TDD rules and another follows today's. Your test suite ends up with two styles, and reviews get harder.

A skill can also be installed by hand: copy its folder into `.claude/skills/` in your repository, and Claude Code picks it up. Nothing records which commit you copied, though, so keeping teammates on the same version is up to you.

To share a skill with your organization, add `--share-org`. Once the CLI is signed in to your Skillpack workspace, it publishes a copy there and keeps the license and GitHub provenance. It refuses to overwrite an organization skill that already has the same name:

```bash
skillpack install github:mattpocock/skills/skills/engineering/tdd --scope project --share-org
```

Skillpack is open source (MIT) and can run on your own infrastructure. For other use cases, see our rankings for [code review](/blog/best-claude-code-skills-code-review), [frontend design](/blog/best-claude-code-skills-frontend-design), and [planning](/blog/best-claude-code-skills-planning), the [overall top Claude Code skills](/blog/best-claude-code-skills), or [write your own skill](/blog/how-to-create-a-claude-code-skill).

## FAQ

```faq
items:
  - question: "What is the best Claude Code skill for testing?"
    answer: "By installs on skills.sh, it's Vercel Labs' agent-browser, with 1.17M installs on October 26, 2026, for testing a running app in a browser. For writing tests, Matt Pocock's tdd skill leads with 1.15M installs."
  - question: "Is there a TDD skill for Claude Code?"
    answer: "Yes, several. Matt Pocock's tdd, obra's test-driven-development from Superpowers and Addy Osmani's test-driven-development all make the agent write a failing test before the code. Pick one, since they cover the same loop."
  - question: "How do I install a testing skill in Claude Code?"
    answer: "Run `skillpack install github:owner/repo/path`, for example `skillpack install github:mattpocock/skills/skills/engineering/tdd`. Add `--scope project` to install it in the current repository. You can also copy the skill's folder into `.claude/skills/` by hand."
  - question: "Should I use Playwright MCP or a Playwright skill?"
    answer: "Microsoft's playwright-cli README says the CLI with its skill is more token-efficient for coding agents. It keeps MCP for long, stateful sessions such as exploratory automation or self-healing tests. See [Agent Skills vs MCP](/blog/agent-skills-vs-mcp)."
  - question: "Do these testing skills work with Codex?"
    answer: "They're plain `SKILL.md` folders, so they work in any agent that reads Agent Skills. With `--scope project`, the Skillpack CLI also writes a copy to `.codex/skills/`. See [how to use skills in Codex](/blog/how-to-use-skills-in-codex)."
  - question: "What licenses do these skills use?"
    answer: "Five declare MIT and three use Apache 2.0. For webapp-testing, the Apache 2.0 license sits in the skill folder, while the anthropics/skills repository declares none."
  - question: "How do I keep the same testing skills across my team?"
    answer: "Pin them to an exact commit in a lockfile committed to the repo, and share them through one workspace. See [how to share Claude Code skills with your team](/blog/how-to-share-claude-code-skills-with-your-team)."
```

## Try Skillpack for free

Once you've picked your TDD rules and your browser tool, the next step is making sure everyone uses the same ones. Skillpack installs any public skill from GitHub with one command and pins the exact commit in a lockfile you can commit. It shares skills with your whole organization, with license and source kept. It's open source. [Create your free Skillpack workspace](/login) and share your first skill in a few minutes.

```cta
title: "Your team's skills, in one place."
primary: { label: "Sign up free for Skillpack", href: /login }
sticky: true
```
