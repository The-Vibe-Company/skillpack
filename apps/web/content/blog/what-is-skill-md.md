---
title: "SKILL.md Format: Specification, Fields and Examples (2026)"
description: "SKILL.md format explained: frontmatter fields, naming rules, size limits, an example file and how to validate it. Based on the agentskills.io spec."
slug: what-is-skill-md
date: 2026-10-13
tags: ["SKILL.md", "Agent Skills"]
---

# What is SKILL.md? Format, specification and examples (2026)

Most coding agents can write code. The useful ones know how your team works: the review checklist, the deploy steps, how you triage an incident. In 2026, more and more of that knowledge lives in one file: `SKILL.md`.

Here's what a SKILL.md file is, how the format works, and what a good one looks like. Then we'll cover how to keep skills from rotting in gists and Slack threads once your team starts writing them.

Jump to the [SKILL.md format specification](#skillmd-format-specification) if you only need the fields and limits. Not sure whether your instruction belongs in a skill or in `AGENTS.md` or `CLAUDE.md`? Read [CLAUDE.md vs AGENTS.md vs SKILL.md](/blog/skill-md-vs-agents-md-vs-claude-md).

Want to build one right away? Follow [How to create a Claude Code skill](/blog/how-to-create-a-claude-code-skill), a step-by-step walkthrough with a working example. Looking for ready-made skills instead? See [the best Claude Code skills in 2026](/blog/best-claude-code-skills), ranked by installs.

## The short answer

A skill is a folder that teaches an AI agent how to do one specific task. At minimum, that folder contains a `SKILL.md` file: YAML frontmatter (a name and a description) followed by Markdown instructions. It can also bundle scripts, reference docs and templates the agent loads only when needed ([Agent Skills specification](https://agentskills.io/specification)).

Anthropic introduced Agent Skills for Claude and explained the design in [Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills). In December 2025 the format was published as an open standard at [agentskills.io](https://agentskills.io), and other tools picked it up fast, including OpenAI Codex, Cursor and OpenCode ([Codex docs](https://developers.openai.com/codex/skills), [Cursor docs](https://cursor.com/docs/skills), [OpenCode docs](https://opencode.ai/docs/skills/)).

In practice, one SKILL.md can work across several agents. You don't rewrite it for each vendor's prompt format.

A skill is not the same thing as a Claude Code subagent, which runs a task in its own context window and reports back a summary ([subagents vs skills](/blog/claude-code-subagents-vs-skills) explains when to reach for each).

## Why skills exist: progressive disclosure

Stuffing every procedure into a system prompt wastes context and confuses the model. Skills fix this with progressive disclosure ([Anthropic](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)):

1. **Discovery.** At startup, the agent only loads each skill's `name` and `description`, roughly 100 tokens per skill ([Claude docs](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview)).
2. **Activation.** When a task matches a description, the agent reads the full `SKILL.md` body.
3. **Execution.** If the instructions point to extra files (`references/`, `scripts/`), the agent opens or runs them only then.

That's why you can install dozens of skills without bloating every conversation. It's also why the `description` field matters so much. It's the only thing the agent sees when it decides whether to use your skill.

## Anatomy of a skill

The spec defines a simple directory layout ([agentskills.io](https://agentskills.io/specification)):

```
code-review/
├── SKILL.md          # Required: metadata + instructions
├── scripts/          # Optional: executable code
├── references/       # Optional: documentation
└── assets/           # Optional: templates, resources
```

Only `SKILL.md` is required. Everything else is optional and loads on demand.

## SKILL.md format specification

The format is defined in the [Agent Skills specification](https://agentskills.io/specification) (we read it on November 9, 2026). A `SKILL.md` file has two parts: YAML frontmatter between two `---` lines, then a Markdown body with the instructions. The body has no format restrictions. The spec suggests step-by-step instructions, examples of inputs and outputs, and common edge cases.

### SKILL.md frontmatter, field by field

Two fields are required. Everything else is optional:

| Field | Required | Rules |
|---|---|---|
| `name` | Yes | 1–64 chars, lowercase letters, numbers and hyphens; no leading, trailing or double hyphens; must match the folder name |
| `description` | Yes | 1–1024 chars; what the skill does **and when to use it** |
| `license` | No | License name or bundled license file |
| `compatibility` | No | Up to 500 chars; environment requirements |
| `metadata` | No | Free-form string key/value map |
| `allowed-tools` | No | Space-separated pre-approved tools (experimental) |

### The minimal SKILL.md

```markdown
---
name: code-review
description: Reviews a diff against our team checklist (tests, naming, security, migrations). Use when the user asks for a code review or before opening a pull request.
---

# Code review

1. Run `git diff main...HEAD` and read every changed file.
2. Check the items in references/checklist.md, in order.
3. Report blocking issues first, then suggestions, with file:line references.
```

### A richer example

```markdown
---
name: deploy
description: Deploys the web app to staging or production with our release checklist. Use when the user asks to ship, deploy, release or roll back.
license: MIT
compatibility: Requires git, pnpm and the Vercel CLI
metadata:
  author: platform-team
  version: "3.0.1"
allowed-tools: Bash(git:*) Bash(pnpm:*) Read
---

# Deploy

## Before deploying
- Confirm the branch is green in CI.
- Read references/rollback.md so you know how to undo.

## Steps
1. Run `scripts/preflight.sh` and stop if it fails.
2. ...
```

Two details trip people up. First, the `name` must match the parent directory, so `deploy/SKILL.md` must say `name: deploy`. Second, `metadata` values are strings, which is why `version: "3.0.1"` is quoted.

### Naming rules and size limits

Per the [specification](https://agentskills.io/specification):

- `name`: 1 to 64 characters, lowercase letters, numbers and hyphens only. It can't start or end with a hyphen, can't contain `--`, and must match the parent folder name.
- `description`: 1 to 1,024 characters, non-empty. Say what the skill does and when to use it.
- `compatibility`: up to 500 characters, and only worth adding if the skill has real environment requirements.
- Body: the spec recommends keeping `SKILL.md` under 500 lines and the instructions under about 5,000 tokens. Move detail into `references/`, one level deep from `SKILL.md`.

### Which fields work everywhere

The spec defines six frontmatter fields. Claude Code accepts more of its own, such as `disable-model-invocation`, `paths` and `when_to_use`. According to the [Claude Code skills docs](https://code.claude.com/docs/en/skills), uploading a skill to claude.ai or the Skills API with a field outside the spec fails with an error, and Claude Code ignores a field name it doesn't recognize without reporting anything. If you want one file that works in every agent, stay within the six spec fields.

### Validate the file

The spec points to the `skills-ref` reference library: `skills-ref validate ./my-skill` checks that the frontmatter is valid and follows the naming rules. Our guide to [checking agent skills in CI](/blog/how-to-check-agent-skills-in-ci) shows how to validate every skill on each pull request with the Skillpack CLI.

### SKILL.md vs the other instruction files

`SKILL.md` is loaded on demand, one task at a time. `AGENTS.md` and `CLAUDE.md` are read at the start of a session. The comparison, with a table of who reads what, is in [CLAUDE.md vs AGENTS.md vs SKILL.md](/blog/skill-md-vs-agents-md-vs-claude-md).

## Writing a description that actually triggers

The spec contrasts a good description ("Extracts text and tables from PDF files, fills PDF forms, and merges multiple PDFs. Use when working with PDF documents…") with a poor one ("Helps with PDFs.") ([agentskills.io](https://agentskills.io/specification)). A few rules of thumb:

- Say when, not just what. "Use when the user asks to ship, deploy or release" gives the agent a trigger.
- Use the words people actually type. If your team says "PR review", put "PR review" in the description.
- One skill, one job. A "devops" skill that does everything triggers at the wrong times. Split it into `deploy`, `rollback` and `triage`.
- Keep the body short and focused. Move long reference material into `references/` so it only loads when needed.

## Where skills live in each agent

Each agent discovers skills from its own locations (project folders, user folders, plugins). Claude Code, Codex, Cursor and OpenCode all read SKILL.md, but paths and install mechanics differ, so check each tool's docs, for example [Cursor's skills documentation](https://cursor.com/docs/skills) or our [Cursor skills guide](/blog/how-to-use-skills-in-cursor). This is where it gets messy for teams. The same skill ends up copied into several folders on several laptops, and the copies drift.

## The team problem: skills don't travel

Writing your first skill takes ten minutes. Keeping fifteen skills in sync across twelve engineers and three agents is another story. Sound familiar?

- The review checklist lives in one engineer's gist.
- The deploy skill was pasted in Slack, and three versions now exist.
- Nobody knows which copy is current, or who changed it.
- A skill with an API key in plain text sits on someone's laptop.

Public directories such as [skills.sh](https://skills.sh) are great for finding community skills. But your internal skills (your deploy process, your conventions, your runbooks) need what the rest of your internal code gets: versioning, access control and a single source of truth.

## How to version, share and install skills with Skillpack

[Skillpack](https://skillpack.app) is an open-source, self-hostable Skills Hub built for exactly this. Your team writes, versions and shares SKILL.md packages, then installs them into Claude Code, Codex and OpenCode with one command ([GitHub](https://github.com/The-Vibe-Company/skillpack)).

**1. Create and validate.** Write a SKILL.md in the web app or upload a package. Skillpack checks the archive, manifest, dependencies and declared secrets before anything ships.

**2. Version.** Each publish creates an immutable version (for example `code-review@1.3.0`) with a checksum, so you know exactly what an agent is running.

**3. Share.** Keep a skill in My Skills while you iterate, then share it with your organization so every member can use and improve it. Labels help you organize libraries without changing access.

**4. Install everywhere.** One command installs an exact version into each coding agent:

```bash
skillpack install code-review --version 1.3.0 --scope project --tools claude-code,codex
```

Skillpack writes the skill into each tool's own skills folder (supported tools: `claude-code`, `codex`, `opencode`) and records the exact version and sha256 checksum in a project lockfile (`.companion/skills.lock.json`) you can commit. Add `--pin` to hold a version. `skillpack update --all --dry-run` previews updates and skips pinned skills, and a teammate who clones the repo runs `skillpack sync --frozen` to verify the locked packages against their checksums and restore missing ones. If local files have drifted, it stops instead of overwriting them.

**5. Connect agents safely.** Agents connect as delegated clients through Agent Auth or personal access tokens, acting with the consenting member's rights. Secrets are stored encrypted and write-only instead of living inside SKILL.md.

**6. See what gets used.** Activation reporting shows which skills actually get used. Reporting is best-effort and visible, and anyone can opt out (for the CLI, `SKILLPACK_TELEMETRY=0`).

Skillpack is MIT-licensed. If your skills encode sensitive internal processes, run it on your own infrastructure. Or start right away on skillpack.app.

## A quick checklist before you publish a skill

- [ ] `name` is lowercase, hyphenated and matches the folder
- [ ] `description` says what it does and when to use it
- [ ] Instructions are numbered steps, not an essay
- [ ] Long docs moved into `references/`
- [ ] No secrets in the file
- [ ] Tested in at least one agent
- [ ] Published as a versioned release your team can install

## FAQ

```faq
items:
  - question: "Is SKILL.md only for Claude?"
    answer: "No. The format started at Anthropic but is now an open standard at [agentskills.io](https://agentskills.io), supported by several agents including Codex, Cursor and OpenCode."
  - question: "What is the SKILL.md format?"
    answer: "A SKILL.md file is YAML frontmatter followed by Markdown instructions. `name` and `description` are required; `license`, `compatibility`, `metadata` and `allowed-tools` are optional ([spec](https://agentskills.io/specification))."
  - question: "Is SKILL.md the same as AGENTS.md or CLAUDE.md?"
    answer: "No. AGENTS.md and CLAUDE.md are read at the start of a session. A SKILL.md body loads only when the agent uses that skill. See [CLAUDE.md vs AGENTS.md vs SKILL.md](/blog/skill-md-vs-agents-md-vs-claude-md)."
  - question: "What's the difference between a skill and an MCP server?"
    answer: "An [MCP server](/blog/agent-skills-vs-mcp) exposes tools and data (APIs, databases). A skill is instructions and resources that teach the agent how to do a task, often with those tools. You'll usually want both."
  - question: "How long should a SKILL.md be?"
    answer: "The spec recommends keeping SKILL.md under 500 lines and the instructions under about 5,000 tokens. Move extra detail into `references/` files that load on demand."
  - question: "Can I keep skills private?"
    answer: "Yes. In Skillpack, personal skills are visible only to their creator, and organization skills are shared with members. You can also self-host the whole hub."
```

## Start your skill library

Your agents are only as good as their skills. And skills only help if the whole team runs the same version. [Create your Skillpack library](https://skillpack.app/login): write your first SKILL.md, publish `v1.0.0` and install it into Claude Code, Codex and OpenCode with one command.
