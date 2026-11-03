---
title: "Claude Skills Examples That Aren't Toy Demos (2026)"
description: "Five real Claude skills examples with scripts, references and clear triggers: frontend-design, webapp-testing, grill-me, brainstorming and agent-browser."
slug: claude-skills-examples
date: 2026-11-03
tags: ["Claude Code", "Agent Skills", "SKILL.md", "Examples", "Skillpack CLI"]
author: "Stan Girard"
authorRole: "co-founder of The Vibe Company, which builds Skillpack"
---

# Claude skills examples that aren't toy demos

Search for Claude skills examples and you mostly get a hello-world `SKILL.md`. That shows the folder shape. It rarely shows how a real skill loads work in stages. Here are five public skills that ship progressive disclosure, scripts, references or careful trigger design, plus the anti-patterns they dodge.

How we checked: layouts and frontmatter come from the public GitHub folders linked below, read on November 3, 2026. Install and validate commands were run the same day with Skillpack CLI 0.3.5. We didn't run Claude Code on these skills for this article. Trigger behavior below is inferred from their descriptions and the [Claude Code skills docs](https://code.claude.com/docs/en/skills).

```takeaways
title: Key Takeaways
items:
  - lead: "Study real folders, not toy SKILL.md files."
    text: "The useful examples keep a short body, push detail into scripts/ or references/, and write a description Claude can match."
  - lead: "Progressive disclosure is the pattern."
    text: "Agents load name and description first, then the full skill, then optional files. Good skills are built for that order."
  - lead: "Scripts are for black-box work."
    text: "webapp-testing tells the agent to run scripts/with_server.py with --help before reading the source."
  - lead: "Some skills must stay manual."
    text: "grill-me sets disable-model-invocation: true so only /grill-me starts the interview."
  - lead: "Validate before you share."
    text: "skillpack skills validate checks the folder locally. Both frontend-design and webapp-testing validated clean in our CLI run."
```

## What makes a Claude skill example worth studying

A skill is a folder with a `SKILL.md` file. Per the open [Agent Skills](https://agentskills.io/) format and Claude Code's docs, hosts load skills in stages: discover name and description, activate the full instructions when the task matches, then run bundled scripts or open references as needed. That's progressive disclosure. Toy demos skip it. They dump every tip into one file, write a vague description, and never show where a script or a reference belongs.

If you're new to the format, start with [What is SKILL.md?](/blog/what-is-skill-md) and [how to create a Claude Code skill](/blog/how-to-create-a-claude-code-skill). The rest assumes you know the basics and want patterns worth copying.

## Example 1: frontend-design (opinionated instructions, no scripts)

Source: [anthropics/skills `skills/frontend-design`](https://github.com/anthropics/skills/tree/main/skills/frontend-design).

```sh
skillpack install github:anthropics/skills/skills/frontend-design --scope project
```

In our CLI 0.3.5 run this installed into `.agents/skills/frontend-design` and `.claude/skills/frontend-design`. `skillpack skills validate` returned `valid: true` with 2 files (SKILL.md plus LICENSE.txt). No `scripts/` folder.

What to copy:

- The description names the job and the failure mode: distinctive UI work that avoids "templated defaults".
- The body is a design brief for the agent: ground choices in the subject, plan tokens first, then critique against known AI-default looks.
- It stays instruction-only. That fits a judgment skill where deterministic scripts wouldn't help.

Why it isn't a toy: it encodes a review process and a list of defaults to refuse. A toy would be a one-line "make nice CSS" prompt.

## Example 2: webapp-testing (scripts/ + examples/)

Source: [anthropics/skills `skills/webapp-testing`](https://github.com/anthropics/skills/tree/main/skills/webapp-testing).

```sh
skillpack install github:anthropics/skills/skills/webapp-testing --scope project
```

Our install wrote 6 files under the skill folder, including `scripts/with_server.py` and three files in `examples/`. Validate returned `valid: true`. The CLI warning flagged `scripts/with_server.py` as an executable file. Useful: you see what can run before you commit the skill.

What to copy:

- The description lists concrete triggers: verifying frontend behavior, screenshots, browser logs.
- SKILL.md tells the agent to treat helper scripts as black boxes. Run `--help` first. Don't read the Python source unless you must. That keeps the script out of the context window until it's needed.
- A decision tree in the body picks static HTML vs dynamic app, and whether a server is already running.
- `examples/` holds patterns the agent can open on demand: element discovery, static HTML, console logging.

That's progressive disclosure done with folders. The [Agent Skills overview](https://agentskills.io/) describes the same three stages; webapp-testing designs for all three.

## Example 3: grill-me (manual trigger + handoff)

Source: [mattpocock/skills `skills/productivity/grill-me`](https://github.com/mattpocock/skills/tree/main/skills/productivity/grill-me).

```sh
skillpack install github:mattpocock/skills/skills/productivity/grill-me --scope project
```

Dry-run with CLI 0.3.5 resolved the path and listed targets under `.agents/skills/grill-me` and `.claude/skills/grill-me`. The SKILL.md itself is tiny:

```md
---
name: grill-me
description: A relentless interview to sharpen a plan or design.
disable-model-invocation: true
---

Call the Skill tool with "grilling".
```

What to copy:

- `disable-model-invocation: true` keeps Claude from starting a hard interview on its own. You type `/grill-me` when you want it. Claude Code's docs recommend that for workflows with side effects or timing you control.
- The body is a handoff. The real procedure lives in a paired `grilling` skill. Install both, or the stub does nothing useful.
- The description is short and specific. It names the outcome (a sharper plan or design), not "helps with planning".

Pair this with the planning set in [best Claude Code skills for planning](/blog/best-claude-code-skills-planning) if you want the wider list.

## Example 4: brainstorming (must-use description + supporting files)

Source: [obra/superpowers `skills/brainstorming`](https://github.com/obra/superpowers/tree/main/skills/brainstorming).

```sh
skillpack install github:obra/superpowers/skills/brainstorming --scope project
```

Dry-run listed several files under `scripts/` (including a small local server helper) plus supporting markdown such as `visual-companion.md` and `builder-check-prompt.md` beside SKILL.md.

What to copy:

- The description is aggressive on purpose: "You MUST use this before any creative work…" followed by concrete cases (features, components, talks). That's how you force discovery matching when the skill is meant to gate other work.
- The body sequences the conversation: check what you already know, ask one question whose answer would change the design most, size the design doc, get approval, then call `writing-plans`.
- Extra files sit one hop from SKILL.md. That matches Anthropic's guidance to keep SKILL.md short and link detail instead of nesting references.

It overlaps with grill-me. Most teams pick one planning interview style, not both.

## Example 5: agent-browser (stub that loads versioned guides)

Source: [vercel-labs/agent-browser `skills/agent-browser`](https://github.com/vercel-labs/agent-browser/tree/main/skills/agent-browser).

```sh
skillpack install github:vercel-labs/agent-browser/skills/agent-browser --scope project
```

Dry-run with CLI 0.3.5 resolved the skill path. Install from the `skills/agent-browser` path above, not from the repo root.

What to copy:

- The checked-in SKILL.md is a discovery stub. It tells the agent to install the CLI, then run `agent-browser skills get core` so the guide matches the installed binary version.
- Specialized guides (`electron`, `slack`, `dogfood`, …) load only when the task needs them. That's progressive disclosure pushed one step further: out of the repo and into the tool.
- The description is long on purpose. It front-loads browser tasks and lists trigger phrases ("open a website", "take a screenshot", "test this web app") so implicit matching still works if the host shortens descriptions, which [Codex docs](https://developers.openai.com/codex/skills) also warn about.
- `allowed-tools: Bash(agent-browser:*)` pre-approves the CLI for the turn. Review that the same way you review a dependency.

More browser and QA options sit in [best Claude Code skills for testing](/blog/best-claude-code-skills-testing).

```cta
title: "Want these skills on every laptop the same way?"
text: "Install them into a free Skillpack workspace, lock the versions, and share the same copies across Claude Code and Codex."
primary: { label: "Create a free Skillpack workspace", href: /login }
secondary: { label: "How to install skills in Claude Code", href: /blog/how-to-install-skills-in-claude-code }
```

## Side-by-side: what each example teaches

| Skill | Repo path | Pattern to steal | Folder extras we saw |
| :- | :- | :- | :- |
| frontend-design | anthropics/skills/skills/frontend-design | Opinionated process, refuse generic defaults | SKILL.md + license only |
| webapp-testing | anthropics/skills/skills/webapp-testing | Black-box scripts, decision tree, on-demand examples | `scripts/`, `examples/` |
| grill-me | mattpocock/skills/skills/productivity/grill-me | Manual-only trigger, hand off to a partner skill | Tiny stub SKILL.md |
| brainstorming | obra/superpowers/skills/brainstorming | Gate creative work, then call the next skill | `scripts/` + companion markdown |
| agent-browser | vercel-labs/agent-browser/skills/agent-browser | Stub loads version-matched guides from the CLI | Discovery stub in git |

Install counts move. Treat skills.sh numbers as a discovery signal, not a quality score. Open the folder and read it.

## Anti-patterns these examples avoid

| Anti-pattern | What goes wrong | Better pattern from above |
| :- | :- | :- |
| Vague description ("helps with coding") | Skill never triggers, or triggers on everything | frontend-design and agent-browser name the job and the trigger words |
| Everything in one SKILL.md | Every activation burns tokens on rarely used detail | webapp-testing moves helpers to `scripts/` and `examples/` |
| Reading large scripts into context | Context fills with code the agent only needed to run | webapp-testing: run with `--help`, treat as black box |
| Auto-running a confrontational workflow | Agent "grills" the user uninvited | grill-me: `disable-model-invocation: true` |
| Stub without its partner skill | `/grill-me` calls missing `grilling` | Install the pair, or inline the steps |
| Copying a skill you did not read | Hidden `allowed-tools` or executables in CI | Read SKILL.md, scripts and the CLI install warning first |

If a skill is installed but never used, walk the checklist in [Claude Code skills not working](/blog/claude-code-skills-not-working). For team installs and drift checks, use [how to check agent skills in CI](/blog/how-to-check-agent-skills-in-ci).

## How to study a skill before you invent one

1. Open the public folder. Confirm `SKILL.md` sits at the skill root.
2. Read the frontmatter. Note `description`, and any of `disable-model-invocation`, `allowed-tools` or `context`.
3. List `scripts/`, `references/`, `examples/` and `assets/`. Ask which stage of progressive disclosure each file serves.
4. Dry-run an install: `skillpack install github:owner/repo/path --scope project --dry-run`.
5. Install into a scratch repo and run `skillpack skills validate ./path-to-skill`.
6. Write three prompts you expect to trigger it, then decide if the description would match them.

The same `SKILL.md` works in Codex if you keep to the shared fields. Codex reads `.agents/skills` in the repo and `~/.agents/skills` on your machine ([Codex skills docs](https://developers.openai.com/codex/skills)). Claude Code reads `.claude/skills`. A project install from Skillpack writes the shared copy plus the host copies so you don't maintain them by hand. More on that in [how to use skills in Codex](/blog/how-to-use-skills-in-codex).

When the skill is worth keeping across repos, [create a free Skillpack workspace](/login) and publish or lock it so every machine runs the same version.

```faq
items:
  - question: "What are good Claude skills examples to learn from?"
    answer: "Start with public skills that show more than a toy SKILL.md: anthropics frontend-design (instruction-only craft), anthropics webapp-testing (scripts/ and examples/), mattpocock grill-me (manual trigger plus handoff), obra brainstorming (gated creative work with supporting files), and vercel-labs agent-browser (stub that loads versioned CLI guides)."
  - question: "What is progressive disclosure in Claude skills?"
    answer: "Hosts load skills in stages: name and description at discovery, full SKILL.md on activation, then scripts or references only when needed. The Agent Skills standard and Claude Code docs both describe that pattern."
  - question: "Should every Claude skill include a scripts/ folder?"
    answer: "No. frontend-design is instruction-only and that fits design judgment. Add scripts when you need deterministic helpers, like webapp-testing's with_server.py, and tell the agent to run them as black boxes."
  - question: "Why does grill-me set disable-model-invocation?"
    answer: "So Claude will not start the interview on its own. You invoke /grill-me when you want that workflow. Claude Code's docs recommend this for skills whose timing or side effects you want to control."
  - question: "How do I install these example skills?"
    answer: "With Skillpack CLI 0.3.5, for example: skillpack install github:anthropics/skills/skills/frontend-design --scope project. Swap the GitHub path for webapp-testing, grill-me, brainstorming or agent-browser. Read the third-party warning before you pass --yes."
  - question: "How do I validate a skill folder?"
    answer: "Run skillpack skills validate on the skill directory. In our November 3, 2026 run, frontend-design and webapp-testing both returned valid: true. Invalid frontmatter fails with a nonzero exit code."
  - question: "Where can I find more Claude Code skill examples?"
    answer: "Browse the rankings on this site for planning, testing, frontend design and the overall hub, and check skills.sh for install counts. Always open the GitHub folder and read SKILL.md before you install a third-party skill."
```
