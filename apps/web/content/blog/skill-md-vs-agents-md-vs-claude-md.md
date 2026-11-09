---
title: "CLAUDE.md vs AGENTS.md vs SKILL.md: What Goes Where"
description: "CLAUDE.md vs AGENTS.md vs SKILL.md: what each file does, who reads it, when it loads, and a simple rule for deciding where an instruction belongs."
slug: skill-md-vs-agents-md-vs-claude-md
date: 2026-11-09
tags: ["SKILL.md", "AGENTS.md", "CLAUDE.md", "Agent Skills", "Comparison"]
author: "Stan Girard"
authorRole: "co-founder of The Vibe Company, which builds Skillpack"
cover: /blog/skill-md-vs-agents-md-vs-claude-md/cover-mascotte.webp
---

# CLAUDE.md vs AGENTS.md vs SKILL.md: what goes where

Short answer: `AGENTS.md` and `CLAUDE.md` hold the facts an agent needs in every session. `SKILL.md` holds one procedure the agent loads only when the task calls for it. `AGENTS.md` is the shared, tool-neutral file. `CLAUDE.md` is the Claude Code version of the same idea. They are not rivals, and most repos end up with more than one.

How we checked: loading rules and file locations come from the official docs for [Claude Code memory](https://code.claude.com/docs/en/memory), [Claude Code skills](https://code.claude.com/docs/en/skills), [Codex AGENTS.md](https://developers.openai.com/codex/guides/agents-md), [agents.md](https://agents.md) and the [Agent Skills specification](https://agentskills.io/specification), all read on November 9, 2026. We didn't benchmark any agent's adherence. Disclosure: we build [Skillpack](https://skillpack.app), which manages `SKILL.md` packages. It does not manage `AGENTS.md` or `CLAUDE.md`, so this isn't a ranking and none of the three files is "ours".

```takeaways
title: Key Takeaways
items:
  - lead: "Always-on vs on-demand"
    text: "AGENTS.md and CLAUDE.md are read at the start of a session. A skill's body loads only when it's used (Claude Code docs)."
  - lead: "AGENTS.md is the portable one"
    text: "It's plain Markdown with no required fields, read by Codex and listed as supported by Cursor, Gemini CLI, Copilot's coding agent and others (agents.md)."
  - lead: "Claude Code reads AGENTS.md only if there is no CLAUDE.md"
    text: "If both exist, Claude reads CLAUDE.md files only, unless you import AGENTS.md or change the Project instructions setting."
  - lead: "A procedure belongs in a skill"
    text: "The Claude Code docs say a multi-step procedure should move out of CLAUDE.md into a skill or a path-scoped rule."
```

## The three files at a glance

| | `AGENTS.md` | `CLAUDE.md` | `SKILL.md` |
| :- | :- | :- | :- |
| What it is | A "README for agents": setup, tests, conventions | Persistent instructions for Claude Code | One task's instructions, in a skill folder |
| Format | Plain Markdown, no required fields | Plain Markdown, optional `@path` imports | YAML frontmatter (`name`, `description`) plus Markdown |
| Who reads it | Codex, and many other agents listed on [agents.md](https://agents.md) | Claude Code | Claude Code, Codex, Cursor and others that follow the [Agent Skills spec](https://agentskills.io/specification) |
| When it loads | Start of the session, plus nested files as you work | Start of the session, plus subdirectory files on demand | Name and description at startup, full body only when the skill is used |
| Scope | Repo, subfolder, or global (`~/.codex`) | Managed policy, user, project, local | Personal, project, plugin, or organization, depending on the agent |
| Best for | Build and test commands, code style, repo layout | Same, plus Claude-specific rules | Repeatable workflows: deploy, review, release notes |

## What AGENTS.md is

[agents.md](https://agents.md) describes it as "a README for agents": a predictable place for the context a coding agent needs and a human contributor doesn't, such as build steps, test commands and conventions. There are no required fields. The FAQ says it's just standard Markdown and you can use any headings you like.

Two behaviors matter in practice:

- **The closest file wins.** In a monorepo you can place another `AGENTS.md` in each package. Agents read the nearest one in the directory tree, and explicit chat prompts override everything ([agents.md](https://agents.md)).
- **Codex builds a chain.** It reads a global file from `~/.codex`, then walks from the project root down to your working directory, at most one file per directory, and stops adding files at `project_doc_max_bytes` (32 KiB by default) ([Codex docs](https://developers.openai.com/codex/guides/agents-md)). A long `AGENTS.md` can be silently cut.

The [agents.md](https://agents.md) site says the format is now stewarded by the Agentic AI Foundation under the Linux Foundation.

## What CLAUDE.md is

`CLAUDE.md` is the file Claude Code loads into every session as persistent instructions. It comes in four scopes: managed policy, user (`~/.claude/CLAUDE.md`), project (`./CLAUDE.md` or `./.claude/CLAUDE.md`) and local (`./CLAUDE.local.md`, kept out of Git) ([Claude Code docs](https://code.claude.com/docs/en/memory)).

Three details people miss, all from the same page:

- It's context, not enforcement. Claude tries to follow it but there's no guarantee. To block an action, the docs point to a hook or a permission rule instead.
- The docs target under 200 lines per file. Longer files use more context and reduce adherence.
- `@path/to/file` imports expand into context with the file that imports them. They help organization but don't save tokens.

## What SKILL.md is

A `SKILL.md` file is the entry point of a skill, a folder that teaches the agent one task. It has YAML frontmatter, where `name` and `description` are required, followed by Markdown instructions ([Agent Skills specification](https://agentskills.io/specification)). Field-by-field details are in [What is SKILL.md?](/blog/what-is-skill-md).

The difference that matters here is loading. Per the spec, only the name and description (about 100 tokens per skill) load at startup. The body loads when the agent activates the skill, and files in `scripts/` or `references/` only when needed. The Claude Code docs make the same point: unlike CLAUDE.md content, a skill's body loads only when it's used, so long reference material costs almost nothing until you need it.

## Do Claude Code and Codex read each other's file?

Not by default, and this is where most of the confusion comes from.

| Agent | Reads `AGENTS.md`? | Reads `CLAUDE.md`? |
| :- | :- | :- |
| Codex | Yes, it's the native file | No, unless you add the name to `project_doc_fallback_filenames` |
| Claude Code | Yes, but only when no `CLAUDE.md` or `CLAUDE.local.md` exists in or above your working directory | Yes, native |

Sources: [Codex docs](https://developers.openai.com/codex/guides/agents-md) (the fallback list is configurable in `~/.codex/config.toml`) and [Claude Code docs](https://code.claude.com/docs/en/memory). The Claude Code page also says reading `AGENTS.md` directly needs v2.1.277 or later.

So a repo with both files makes Claude read only `CLAUDE.md`. If your team uses several agents, there are two documented ways to keep one source of truth:

1. **Import.** Put `@AGENTS.md` at the top of `CLAUDE.md`, then add Claude-specific lines below it.
2. **Symlink.** Run `ln -s AGENTS.md CLAUDE.md`. The docs warn that Windows checkouts may get a one-line text file instead of a link unless `core.symlinks` is enabled, and that Claude's Edit and Write tools won't write through a symlink.

The Skillpack repo itself uses the symlink approach, in the opposite direction: `AGENTS.md` is a symlink to `CLAUDE.md` (we checked in the repo on November 9, 2026). Symlinks come with the Windows caveat above, so check your own team's setup before copying it.

## The rule for deciding where an instruction goes

Ask two questions about each line you're about to write.

**1. Does the agent need it in every session?** Build commands, test commands, repo layout, naming conventions, "never edit the generated folder": yes. Put it in `AGENTS.md` or `CLAUDE.md`.

**2. Is it a procedure with steps, used for one kind of task?** "How we cut a release", "how we review a migration": that's a skill. The Claude Code docs say it directly: if a CLAUDE.md entry is a multi-step procedure, or only matters for one part of the codebase, move it to a skill or a path-scoped rule.

| Instruction | Where it goes |
| :- | :- |
| `pnpm test` runs the unit tests | `AGENTS.md` / `CLAUDE.md` |
| Use 2-space indentation | `AGENTS.md` / `CLAUDE.md` |
| API handlers live in `src/api/handlers/` | `AGENTS.md` / `CLAUDE.md` |
| Use plan mode for changes under `src/billing/` | `CLAUDE.md` (Claude-specific) |
| Ten steps to ship a release | `SKILL.md` |
| Review checklist for a pull request | `SKILL.md` |
| Rules that apply only to `src/api/**/*.ts` | Path-scoped rule in `.claude/rules/` |
| Never run a command, no exceptions | A hook or permission rule, not a text file |

## A layout that works across agents

```
repo/
├── AGENTS.md                      # facts for every session, shared by all agents
├── CLAUDE.md                      # starts with @AGENTS.md, then Claude-only lines
└── .agents/skills/
    └── release/
        └── SKILL.md               # one procedure, loaded on demand
```

Skill folders differ by agent. Claude Code reads `.claude/skills/`, Codex reads `.agents/skills/`, and Cursor reads `.agents/skills` or `.cursor/skills` ([Claude Code docs](https://code.claude.com/docs/en/skills), [Codex skills docs](https://developers.openai.com/codex/skills), [Cursor docs](https://cursor.com/docs/skills)). So the folder in the sketch above is the Codex and Cursor location. For Claude Code, the same skill needs to sit in `.claude/skills/` as well. That duplication is the part that drifts, and a hub that installs one version into each folder removes it ([try Skillpack](https://skillpack.app/login)). Our guide on [skills across Claude Code, Codex and Cursor](/blog/agent-skills-open-standard-vs-vendor-folders) covers it, and so does [how to share Claude Code skills with your team](/blog/how-to-share-claude-code-skills-with-your-team).

## Mistakes we see most

- **A 600-line CLAUDE.md.** It costs context on every turn and, per the docs, lowers adherence. Split it into a short file plus skills and path-scoped rules.
- **Procedures hiding in AGENTS.md.** If the section starts with "step 1", it's a skill waiting to be extracted.
- **Two files that disagree.** The Claude Code docs warn that if two instructions contradict each other, Claude may pick one arbitrarily. Keep one source and import it.
- **Using a text file for a hard rule.** `AGENTS.md` and `CLAUDE.md` are context, not enforcement.
- **Skipping the description in a skill.** It's the only part the agent sees before deciding to load it. [How to create a Claude Code skill](/blog/how-to-create-a-claude-code-skill) shows how to write one that triggers.

## When skills need a home of their own

`AGENTS.md` and `CLAUDE.md` live in your repo and travel with it. Skills are reused more widely: across repos, laptops and agents. That's where copies drift. [Skillpack](https://skillpack.app) is an open-source Skills Hub for that one problem. You publish a `SKILL.md` package as an immutable, checksummed version, share it with your organization, and install an exact version into Claude Code, Codex or OpenCode with one command. It won't write your `AGENTS.md`, and you don't need it for a single-repo setup.

Once you have a few procedures worth reusing, [create your Skillpack library](https://skillpack.app/login) and publish the first one.

## FAQ

```faq
items:
  - question: "What is the difference between CLAUDE.md and AGENTS.md?"
    answer: "Both are Markdown files of persistent instructions. CLAUDE.md is the Claude Code file, with scopes like user, project and local. AGENTS.md is a tool-neutral format that Codex reads natively and that many other agents list as supported. Claude Code reads AGENTS.md only when no CLAUDE.md exists in or above your working directory."
  - question: "Does Claude Code read AGENTS.md?"
    answer: "Yes, from Claude Code v2.1.277, but only when you have no CLAUDE.md or CLAUDE.local.md in your working directory or above. If you have both, put `@AGENTS.md` in your CLAUDE.md or set Project instructions to `claude-md-and-agents-md` in `/config`."
  - question: "Does Codex read CLAUDE.md?"
    answer: "Not by default. Codex looks for AGENTS.override.md, then AGENTS.md, then any names in `project_doc_fallback_filenames`. Add CLAUDE.md to that list in `~/.codex/config.toml` if you want Codex to treat it as an instructions file."
  - question: "Is SKILL.md a replacement for AGENTS.md?"
    answer: "No. They load differently. AGENTS.md is read at the start of a session and suits facts like commands and conventions. A SKILL.md body loads only when the agent decides the task matches the skill's description, so it suits a repeatable procedure."
  - question: "Should I use AGENTS.md, CLAUDE.md or both?"
    answer: "If you only use Claude Code, CLAUDE.md is enough. If your team mixes agents, keep the shared content in AGENTS.md and have CLAUDE.md import it with `@AGENTS.md`, then add Claude-only lines below. A symlink also works, with the Windows caveats described above."
  - question: "How long should AGENTS.md or CLAUDE.md be?"
    answer: "The Claude Code docs target under 200 lines per CLAUDE.md file. Codex stops adding AGENTS.md content at 32 KiB combined by default (`project_doc_max_bytes`). Move procedures into skills and area-specific rules into nested files."
  - question: "Can an AGENTS.md or CLAUDE.md file enforce a rule?"
    answer: "No. Claude Code treats CLAUDE.md as context, not enforced configuration. To block an action, use a permission rule or a PreToolUse hook. The same logic applies to AGENTS.md."
```
