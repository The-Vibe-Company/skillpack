---
title: "Best Claude Code Skills for Frontend Design in 2026: the Buyer's Shortlist | Skillpack"
description: "The 7 widely installed Claude Code skills for frontend design in 2026, ranked on public install counts, maintainer, license and scope, with one-line install commands."
slug: best-claude-code-skills-frontend-design
date: 2026-10-15
tags: ["Claude Code", "Agent Skills", "Frontend"]
author: "Stan Girard"
---

# Best Claude Code Skills for Frontend Design in 2026: the Buyer's Shortlist

*By Stan Girard, co-founder of The Vibe Company, which builds Skillpack · Published October 15, 2026 · Data collected October 15, 2026*

The best Claude Code skill for frontend design in 2026 is **frontend-design** from Anthropic. It's the most-installed design skill on skills.sh, with 988.5K installs, and it ships under Apache 2.0. Below are seven Claude Code skills for frontend design, ranked on public install counts, maintainer, license and scope. Each comes with the exact command to install it and share it with your team.

> [!TIP]
> **Install any skill on this page with one command, and share it with your team.** `skillpack install github:anthropics/skills/skills/frontend-design` works without an account. [Create a free Skillpack workspace](/login) to share skills across your organization.

## Key Takeaways

- **frontend-design (Anthropic) is the default pick.** It's the most-installed frontend skill on skills.sh. It pushes Claude toward deliberate palette, typography and layout choices instead of templated defaults.
- **Pair a taste skill with a review skill.** frontend-design, Impeccable or emil-design-eng shape how the UI looks and feels. Vercel's web-design-guidelines checks the result against a published rule set.
- **React teams should add react-best-practices.** Vercel's MIT-licensed skill packs 70 performance rules for React and Next.js, ordered by impact.
- **Check the license before shipping.** Most skills here are Apache 2.0 or MIT, but web-design-guidelines declares no license at all.
- **Copies drift on a team.** Pin the exact commit each developer installs, in a lockfile that lives in the repo.

## What frontend design skills actually are (and what they are not)

A Claude Code skill is a folder with a `SKILL.md` file. It holds instructions, and sometimes scripts or reference files, that the agent loads when a task matches the skill's description ([what is SKILL.md](/blog/what-is-skill-md)). A frontend design skill teaches the agent how to make interface decisions: which typography and spacing to pick, which visual clichés to avoid, how to audit a page for accessibility, how to keep React components fast.

They aren't component libraries. A skill doesn't add buttons, tokens or a design system to your code. It changes how the agent writes and critiques interface code. Some skills do ship helper scripts. Anthropic's webapp-testing, for example, includes a script that starts your dev server so the agent can drive a browser with Playwright. The skill is still the method. The script is just a tool it tells the agent to use.

They aren't MCP servers either. An MCP server gives the agent access to a system, such as a browser or Figma. A skill gives it the know-how to use that access well ([Agent Skills vs MCP](/blog/agent-skills-vs-mcp)). The two combine: a review skill can tell the agent to fetch rules from the web before checking your files.

They also come with trade-offs. A skill only loads when its description matches your request. Two overlapping design skills can give the agent contradictory instructions, one asking for bold choices and the other for restraint. Third-party skills can also tell the agent to run commands, so read the source before installing. That's why this shortlist says what each skill is best for. Pick two or three that complement each other. Don't install all seven.

## How We Ranked These Skills

We used four public, checkable criteria. All numbers were collected on October 15, 2026.

1. **Adoption**: all-time installs reported on [skills.sh](https://skills.sh), the open leaderboard for Agent Skills.
2. **Maintainer**: whether a vendor (Anthropic, Vercel) or a named individual maintains the skill, and the GitHub stars of its repository. Stars count the whole repository, not the individual skill.
3. **License clarity**: whether the skill or its repository declares an open-source license.
4. **Scope fit**: whether the skill is dedicated to frontend design, or touches it as part of a wider job (testing, artifacts).

Adoption sets the order. The other three criteria are shown for every skill, so you can weigh them yourself. Skillpack isn't ranked. The Vibe Company, the author's company, builds Skillpack, the open-source tool used here to install and share skills, and it only appears in the install commands.

## The Best Claude Code Skills for Frontend Design in 2026

Install counts change every day, so treat this as a snapshot from October 15, 2026. Each entry gives the source, what the skill does, the numbers we could verify, and a Skillpack install command that points at the skill's real folder on GitHub. Add `--scope project` to install it in the current repo for Claude Code, Codex and OpenCode (the default tools), and `--share-org` to publish a copy to your Skillpack organization.

### 1. frontend-design (Anthropic), best for distinctive new UI

- **Maintainer:** Anthropic, in [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/frontend-design) (repository: 181.1K GitHub stars)
- **Installs:** 988.5K on [skills.sh](https://skills.sh/anthropics/skills/frontend-design)
- **License:** Apache 2.0 (LICENSE.txt in the skill folder)

```bash
skillpack install github:anthropics/skills/skills/frontend-design --scope project
```

frontend-design is Anthropic's answer to UI that looks AI-generated. The skill casts Claude as the design lead of a studio whose client "has already rejected proposals that felt cliché or templated". It asks for deliberate, opinionated choices about palette, typography and layout, specific to the brief, and allows aesthetic risk when it's justified.

Its most useful habit is grounding the design in the subject. If the brief doesn't say what the product is, the skill has Claude name a concrete subject, audience and primary job before drawing anything, and confirm them with you. The skill's own example: a toy for girls aged 8 to 11 shouldn't look anything like a dashboard for financial analysts. It also treats the hero as a decision, not a default: Claude picks the most characteristic thing in the subject's world, whether that's a headline, an image, a live demo or a big number.

The skill is a single `SKILL.md` plus its license file, with no scripts, so it adds no executables to your repo. It's also the most adopted design skill in the ecosystem. For a team, that means new hires have often seen its output before.

**Best suited for:** teams starting a new landing page, marketing site or product UI who want Claude to commit to a visual direction. Less useful if you must follow a strict existing design system, since it pushes toward distinctiveness.

### 2. react-best-practices (Vercel), best for React and Next.js performance

- **Maintainer:** Vercel, in [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices) (repository: 32.4K GitHub stars)
- **Installs:** 802.6K on [skills.sh](https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices), listed under its SKILL.md name
- **License:** MIT (declared in SKILL.md)

```bash
skillpack install github:vercel-labs/agent-skills/skills/react-best-practices --scope project
```

react-best-practices (named `vercel-react-best-practices` in its SKILL.md, which is also the folder name it installs under) is Vercel Engineering's performance guide for React and Next.js. It's meant for writing, reviewing or refactoring components, pages, data fetching and bundles.

It contains 70 rules in 8 categories, ordered by impact. Two are marked critical: eliminating waterfalls and bundle size optimization. Next come server-side performance, client-side data fetching, re-render optimization, rendering performance, JavaScript performance and advanced patterns. Each rule has a short prefixed name, such as `async-parallel` (use `Promise.all()` for independent operations) or `async-defer-await` (move an await into the branch that needs it). That makes findings easy to reference in code review. The detailed rules live in a `rules/` folder next to the SKILL.md.

On scope, it's about how fast your UI is, not how it looks.

**Best suited for:** teams shipping React or Next.js apps who want Claude to avoid common performance mistakes by default. Pair it with a design skill so speed and appearance both get attention.

### 3. web-design-guidelines (Vercel), best for reviewing UI against a rule set

- **Maintainer:** Vercel, in [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines) (repository: 32.4K GitHub stars)
- **Installs:** 737.8K on [skills.sh](https://skills.sh/vercel-labs/agent-skills/web-design-guidelines)
- **License:** none declared, either in the skill or at the repository level

```bash
skillpack install github:vercel-labs/agent-skills/skills/web-design-guidelines --scope project
```

web-design-guidelines is a reviewer, not a designer. It triggers on requests like "review my UI", "check accessibility", "audit design" or "check my site against best practices". It then checks the files you name, or asks which ones to review.

The skill is short on purpose. It doesn't embed the rules. Instead, it tells Claude to fetch the latest version of Vercel's Web Interface Guidelines from the [web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines) repository before every review, then apply every rule to your code. Findings come back in a terse `file:line` format that's easy to act on, or to paste into a pull request.

The upside: the rules stay current without reinstalling the skill. There are two trade-offs. The agent needs web access at review time, and the output depends on a file that can change between two reviews. Keep that in mind if you need reproducible reviews in CI. The other caveat is legal: neither the skill nor its repository declares a license, so check with your legal team before redistributing it inside a company.

**Best suited for:** teams that want a consistent UI and accessibility pass before merging frontend changes. It works best as the second half of a pair, after a design skill has produced the interface.

### 4. emil-design-eng (Emil Kowalski), best for motion and interaction polish

- **Maintainer:** Emil Kowalski, in [emilkowalski/skills](https://github.com/emilkowalski/skills/tree/main/skills/emil-design-eng) (repository: 46.3K GitHub stars)
- **Installs:** 353.7K on [skills.sh](https://skills.sh/emilkowalski/skills/emil-design-eng)
- **License:** MIT (repository LICENSE)

```bash
skillpack install github:emilkowalski/skills/skills/emil-design-eng --scope project
```

emil-design-eng encodes Emil Kowalski's design-engineering philosophy: "UI polish, component design, animation decisions, and the invisible details that make software feel great." Kowalski is the author of the Sonner toast library, and his repository holds 15 skills in total, including this one and animate, review-animations, improve-animations and pick-ui-library.

The skill reads more like a point of view than a checklist. It argues that taste is trained, not innate, that unseen details compound, and that "beauty is leverage" in a world where most software is good enough. In practice, it steers Claude toward the details users never consciously notice but always feel: timing, easing, focus states, interactions that behave exactly as expected.

One quirk: when you invoke it without a specific question, it answers with a single fixed sentence and waits for you to ask. That's intended, but it surprises people the first time. Since the other skills in the repository cover narrower jobs, you can install emil-design-eng for the philosophy and add a focused one, such as review-animations, for a specific task.

**Best suited for:** product teams whose UI already works but doesn't feel premium, especially around animation and micro-interactions. Pair it with frontend-design if you're also starting the visual direction from scratch.

### 5. Impeccable (Paul Bakaus), best for auditing and polishing an existing interface

- **Maintainer:** Paul Bakaus, in [pbakaus/impeccable](https://github.com/pbakaus/impeccable/tree/main/.claude/skills/impeccable) (repository: 81.3K GitHub stars)
- **Installs:** 333.5K on [skills.sh](https://skills.sh/pbakaus/impeccable/impeccable)
- **License:** Apache 2.0 (declared in SKILL.md and in the repository); version 4.5.2 at time of writing

```bash
skillpack install github:pbakaus/impeccable/.claude/skills/impeccable --scope project
```

Impeccable is the broadest skill on this list. Its description covers designing, redesigning, critiquing, auditing, polishing, hardening, optimizing, animating and theming frontend interfaces. That spans websites, dashboards, app shells, forms, onboarding and empty states, plus accessibility, performance, responsive behavior, typography, color, motion and UX copy.

It works as a set of commands. You call it with a verb and a target: `audit`, `critique`, `polish`, `harden`, `bolder`, `quieter`, `typeset`, `colorize`, `distill`, `onboard` and more, as listed in its argument hint. That makes it practical on an existing product. "Audit the settings page", then "polish" it, is a more controlled loop than asking for a redesign. Its stated ambition is "out-of-distribution craft": production-grade code and a clear point of view, rather than safe, measured output.

The skill's source lives in the repository's `skill/` folder as a template. A build generates an installable copy for each agent (.claude, .cursor, .agents, .opencode and others) plus a Claude Code plugin in `plugin/`, and the repository commits those copies so it can be installed straight from GitHub. The command above uses the generated Claude Code copy, `.claude/skills/impeccable`. That copy ships a `scripts/` folder with a launcher that downloads the Impeccable engine binary on first run, so the Skillpack CLI lists those files as executables when you install it.

**Best suited for:** teams with a live product that needs a structured design review and targeted fixes, rather than a blank-page redesign. Its breadth overlaps with frontend-design, so install one of the two as your main design skill.

### 6. webapp-testing (Anthropic), best for checking the UI in a real browser

- **Maintainer:** Anthropic, in [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/webapp-testing) (repository: 181.1K GitHub stars)
- **Installs:** 177.8K on [skills.sh](https://skills.sh/anthropics/skills/webapp-testing)
- **License:** Apache 2.0 (LICENSE.txt in the skill folder)

```bash
skillpack install github:anthropics/skills/skills/webapp-testing --scope project
```

webapp-testing covers what design skills leave out: checking that the interface actually works once rendered. It's a toolkit for testing local web applications with Playwright. Claude writes native Python Playwright scripts to verify behavior, debug the UI, capture screenshots and read browser logs.

The skill includes a decision tree. For static HTML, Claude reads the file to find selectors. For a dynamic app, it starts the server if needed, waits for the page to settle, takes a screenshot or inspects the DOM, and only then acts on the selectors it found. A helper, `scripts/with_server.py`, manages the server lifecycle, including several servers at once. The skill tells Claude to run helpers with `--help` and treat them as black boxes rather than reading them, which keeps the context window small.

Because it ships scripts, the Skillpack CLI flags them as executable files during install. Skillpack copies them but never runs them, and it doesn't install Playwright for you. You'll need Python and Playwright set up in the project.

**Best suited for:** developers who want Claude to check its own frontend work, with screenshots and console logs, before handing it over. It's a testing skill, not a design one, so it complements the design and review skills above.

### 7. web-artifacts-builder (Anthropic), best for complex React artifacts in claude.ai

- **Maintainer:** Anthropic, in [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/web-artifacts-builder) (repository: 181.1K GitHub stars)
- **Installs:** 108.9K on [skills.sh](https://skills.sh/anthropics/skills/web-artifacts-builder)
- **License:** Apache 2.0 (LICENSE.txt in the skill folder)

```bash
skillpack install github:anthropics/skills/skills/web-artifacts-builder --scope project
```

web-artifacts-builder is for building elaborate, multi-component HTML artifacts for claude.ai with React, Tailwind CSS and shadcn/ui. Its description reserves it for complex artifacts that need state management, routing or shadcn/ui components, not for simple single-file HTML.

The workflow runs through two scripts. `scripts/init-artifact.sh` creates a React and TypeScript project on Vite, with Tailwind CSS 3.4.1, path aliases and more than 40 shadcn/ui components preinstalled. `scripts/bundle-artifact.sh` then bundles everything into a single HTML file with Parcel. In between, Claude edits the generated code like any React app.

It also has a short style rule. To avoid "AI slop", it tells Claude to steer clear of excessive centered layouts, purple gradients, uniform rounded corners and the Inter font. That rule is useful even if you never build an artifact.

It ranks last on installs, and its scope is also narrower than the skills above. It targets self-contained artifacts, not your production app's codebase.

**Best suited for:** people prototyping interactive tools, demos or internal mini-apps as shareable single-file artifacts. For work inside an existing frontend repository, the skills above fit better.

## Side-by-Side Comparison

Ranked by adoption, with maintainer, license and scope shown for each skill. Data from skills.sh and GitHub, collected October 15, 2026. Stars are for each skill's whole GitHub repository.

| # | Skill | Maintainer | Installs (skills.sh) | Repo stars (GitHub) | License | Focus |
|---|---|---|---|---|---|---|
| 1 | frontend-design | Anthropic | 988.5K | 181.1K | Apache 2.0 | Visual direction |
| 2 | react-best-practices | Vercel | 802.6K | 32.4K | MIT | React/Next.js performance |
| 3 | web-design-guidelines | Vercel | 737.8K | 32.4K | None declared | UI and accessibility review |
| 4 | emil-design-eng | Emil Kowalski | 353.7K | 46.3K | MIT | Motion and polish |
| 5 | impeccable | Paul Bakaus | 333.5K | 81.3K | Apache 2.0 | Audit and polish commands |
| 6 | webapp-testing | Anthropic | 177.8K | 181.1K | Apache 2.0 | Browser testing (Playwright) |
| 7 | web-artifacts-builder | Anthropic | 108.9K | 181.1K | Apache 2.0 | claude.ai artifacts |

> [!TIP]
> **Already using three of these?** Put them in one Skillpack workspace and pin each one to an exact commit in `.companion/skills.lock.json`, so every developer and every agent runs the same files. [Start free](/login) · [How to share Claude Code skills with your team](/blog/how-to-share-claude-code-skills-with-your-team)

## Which frontend skill fits your use case

| Use case | Start with | Add | Why |
|---|---|---|---|
| New landing page or product UI | frontend-design | emil-design-eng | Visual direction first, interaction polish second |
| Improving an existing app | impeccable | web-design-guidelines | Targeted audit and fixes, then a rule-based check |
| React or Next.js codebase | react-best-practices | frontend-design | Performance and appearance |
| QA before shipping | webapp-testing | web-design-guidelines | A real browser check plus a guidelines review |
| Interactive prototype or demo | web-artifacts-builder | frontend-design | A single-file artifact that doesn't look templated |

## How to install and share these skills with your team

Each command above installs a public GitHub folder with the Skillpack CLI, without an account. The CLI resolves the branch or tag to an exact commit, shows you the source and any executable files, and asks before copying anything. It never runs package scripts. With `--scope project`, the skill lands in `.agents/skills/`, which OpenCode reads, with managed copies in `.claude/skills/` for Claude Code and `.codex/skills/` for Codex. The exact commit is recorded in `.companion/skills.lock.json`. Commit that lockfile, and `skillpack sync --frozen` gives every teammate and every CI run the same files ([full install guide](/blog/how-to-install-skills-in-claude-code)).

A skill can also be installed by hand: copy its folder into `.claude/skills/` in your repository, and Claude Code picks it up. Nothing records which commit you copied, though, so keeping teammates on the same version is up to you.

To share a skill with your organization, add `--share-org`. Once the CLI is signed in to your Skillpack workspace, it publishes a copy there and keeps the license and GitHub provenance. It refuses to overwrite an organization skill that already has the same name:

```bash
skillpack install github:anthropics/skills/skills/frontend-design --scope project --share-org
```

Skillpack is open source (MIT) and self-hostable. The Free plan includes up to 20 organization skills, and Pro costs $10 per seat per month.

## FAQ

**What is the best Claude Code skill for frontend design?**
By installs on skills.sh, it's Anthropic's frontend-design, with 988.5K installs on October 15, 2026. It's Apache 2.0 and maintained in anthropics/skills.

**How do I install a Claude Code skill from GitHub?**
Run `skillpack install github:owner/repo/path`, for example `skillpack install github:anthropics/skills/skills/frontend-design`. Add `--scope project` to install it in the current repository. You can also copy the skill's folder into `.claude/skills/` by hand.

**How many design skills should I install?**
Two or three that don't overlap: one for visual direction, one for review, and optionally one for testing. Overlapping skills can give the agent contradictory instructions.

**What is the difference between a skill and an MCP server?**
A skill teaches the agent a method. An MCP server gives it access to a system. See [Agent Skills vs MCP](/blog/agent-skills-vs-mcp).

**How do I keep the same skills across my team?**
Pin each skill to an exact commit in a lockfile committed to the repo, and share it through one workspace. See [how to share Claude Code skills with your team](/blog/how-to-share-claude-code-skills-with-your-team).

**What licenses do these skills use?**
Six of the seven are Apache 2.0 or MIT. web-design-guidelines declares no license, so check before redistributing it.

**Are third-party skills safe to install?**
Not automatically. A skill's instructions can make your agent run commands, so read the source first and pin a reviewed commit.

## Try Skillpack for free

After you've picked your skills, the next step is making sure everyone on your team runs the same ones. Skillpack installs any public skill from GitHub with one command. It pins the exact commit in a lockfile you can commit. It shares skills with your whole organization, with license and source kept. It's open source and free for up to 20 organization skills. [Create your free Skillpack workspace](/login) and share your first skill in a few minutes.

> [!TIP]
> **Your team's skills, in one place.** [Sign up free for Skillpack](/login)
