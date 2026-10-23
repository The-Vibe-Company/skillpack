---
title: "Cursor Skills: How to Use, Create and Install Them (2026)"
description: "Cursor skills explained: which folders Cursor reads SKILL.md from, how to call a skill with /, how to write one, and how to install and share skills."
slug: how-to-use-skills-in-cursor
date: 2026-10-23
tags: ["Cursor", "Agent Skills", "SKILL.md", "Skillpack CLI"]
author: "Stan Girard"
authorRole: "co-founder of The Vibe Company, which builds Skillpack"
---

# Cursor skills: how to use, create and install them

A Cursor skill is a folder with a `SKILL.md` file that teaches Cursor's agent one workflow, like deploying to staging or writing a migration. Cursor finds skills in `.agents/skills` or `.cursor/skills` in your repo, and in the same folders under your home directory. The agent picks a skill when your request matches it, or you call it by typing `/` and its name.

Cursor added skills in [version 2.4](https://cursor.com/changelog/2-4), released on 22 January 2026, for both the editor and the CLI. This guide covers where Cursor looks, how to invoke and scope a skill, and how skills differ from rules. It also shows how to install skills from GitHub without building a plugin. Cursor behavior comes from the [official Cursor docs](https://cursor.com/docs/skills). The Skillpack commands were run with Skillpack CLI 0.3.5 on 23 October 2026.

```takeaways
title: Key Takeaways
items:
  - lead: "Project skills live in .agents/skills or .cursor/skills."
    text: "Personal skills go in ~/.agents/skills or ~/.cursor/skills."
  - lead: "Cursor also reads Claude Code and Codex folders."
    text: ".claude/skills and .codex/skills are loaded for compatibility, so existing skills usually work as they are."
  - lead: "Call a skill with / or let the agent choose."
    text: "Set disable-model-invocation: true when a skill should only run on demand."
  - lead: "Skills are not rules."
    text: "Rules are short guidance added to context. Skills are step-by-step procedures loaded when needed."
  - lead: "Only ~/.cursor/skills syncs to Cloud Agents."
    text: "For skills every teammate and every cloud run should get, commit them to the repo."
```

## What a Cursor skill is

A skill packages instructions, plus optional scripts and reference files, so the agent runs a workflow the same way every time. Cursor follows the open [Agent Skills standard](https://agentskills.io), the same `SKILL.md` format used by Claude Code and Codex. If the file format is new to you, [What is SKILL.md?](/blog/what-is-skill-md) walks through it field by field.

A typical skill looks like this:

```text
.cursor/skills/deploy-app/
  SKILL.md          # required: name, description, instructions
  scripts/          # optional: code the agent can run
  references/       # optional: longer docs read on demand
  assets/           # optional: templates, config files
```

Cursor loads skills progressively. At startup the agent sees the list of available skills and their descriptions. It reads the full instructions only when it decides a skill is relevant. So an installed skill costs little context until the agent actually uses it.

## Where Cursor looks for skills

The [Cursor docs](https://cursor.com/docs/skills) list four main locations:

| Location | Scope |
|---|---|
| `.agents/skills/` | Project |
| `.cursor/skills/` | Project |
| `~/.agents/skills/` | You, on this machine |
| `~/.cursor/skills/` | You, on this machine |

For compatibility, Cursor also loads `.claude/skills/`, `.codex/skills/`, `~/.claude/skills/` and `~/.codex/skills/`. In practice, a repo already set up for Claude Code or Codex gives Cursor its skills for free.

A few details that save time:

- **Category folders are fine.** Cursor walks the skills folder recursively. `.cursor/skills/shipping/land-it/SKILL.md` works, and the skill is called `land-it`, not `shipping`.
- **Monorepos get scoping for free.** A `.cursor/skills/` or `.agents/skills/` folder inside `apps/web/` is picked up too. Its skills only surface when the agent works on files under `apps/web/`.
- **The name must match the folder.** The `name` field accepts lowercase letters, numbers and hyphens, and it has to equal the parent folder name.

To see what Cursor actually found, open Customize in the sidebar and go to Skills.

## How to use a skill in Cursor

There are three ways a skill gets used:

1. **The agent picks it.** If your request matches a skill's description, the agent loads it on its own.
2. **You call it with `/`.** Type `/` in Agent chat and search for the skill name, for example `/deploy-app`. A skill called this way applies to that one message.
3. **You keep it on.** Use the skill as a Custom Mode (Option+Enter on Mac, Alt+Enter on Windows) to keep it active for the whole session. The optional `icon` and `color` fields style the badge that shows up in the chat input.

You can also type `@` and select a skill to attach it as context.

When a skill should never run on its own, add `disable-model-invocation: true` to its frontmatter. It then behaves like an old-style slash command. Do this for anything with side effects, like a deploy or a database migration.

### Built-in skills

Cursor ships with its own skills, managed by Cursor. Two are worth knowing on day one:

- `/create-skill` writes a new skill for you, folder and `SKILL.md` included.
- `/migrate-to-skills` converts eligible rules and slash commands into skills.

There are others, like `/review`, `/split-to-prs` and `/create-rule`. The full list is in the docs.

## How to create a Cursor skill

The quickest path is to type `/create-skill` and describe what you want. The built-in skill walks you through naming, structuring and saving it.

Writing one by hand takes two minutes. Create `.cursor/skills/release-notes/SKILL.md`:

```md
---
name: release-notes
description: Write user-facing release notes from merged pull requests. Use when asked for release notes, a changelog entry or "what shipped". Do not use for commit messages.
paths: "CHANGELOG.md, docs/releases/**"
---

1. List PRs merged since the last tag with `git log --merges <last-tag>..HEAD`.
2. Group them under New, Improved and Fixed. Skip refactors and dependency bumps.
3. Write one plain sentence per change, from the user's point of view.
```

Only `name` and `description` are required. The description is what the agent reads to decide whether the skill fits. So say what the skill does, when to use it and when not to.

The `paths` field is an optional Cursor field. It limits the skill to matching files, so the skill only surfaces when the agent reads or edits them. It takes a list or a comma-separated string of glob patterns. Leave it out for a skill that applies everywhere.

Test the skill twice. First ask something that should match, like "what shipped this week?". Then call `/release-notes` directly. If the explicit call works and the automatic one doesn't, rewrite the description, not the steps. Our [step-by-step guide to creating a skill](/blog/how-to-create-a-claude-code-skill) goes further on testing, scripts and reference files. Before you share a skill, `skillpack skills validate ./release-notes` checks the name and description locally. It accepted the `paths` field above without complaint.

## Cursor skills vs rules vs commands

Cursor now has several ways to give the agent instructions, and they overlap. Here's how they split, based on the [skills](https://cursor.com/docs/skills) and [rules](https://cursor.com/docs/context/rules) docs:

| | What it is | Loaded when | Best for |
|---|---|---|---|
| Project rule | `.mdc` file in `.cursor/rules` | Always, on matching files, when relevant, or when @-mentioned | Short guidelines and constraints |
| `AGENTS.md` | Plain Markdown file in the repo | Always, for its folder | Simple project instructions |
| Skill | Folder with `SKILL.md` | When relevant, or when you call it | Multi-step, repeatable procedures |
| Slash command | Older prompt shortcut | Only when you call it | Now covered by skills with `disable-model-invocation: true` |

The rule of thumb from Cursor's own help page: use a rule when a short instruction is enough, and a skill when the agent needs a detailed, repeatable process. "Use TypeScript for new files" is a rule. "Deploy to staging: run tests, build, deploy, check health" is a skill.

If your skill needs live data from another system, like an issue tracker or a database, pair it with an MCP server. [Agent skills vs MCP](/blog/agent-skills-vs-mcp) explains that split.

## How to install Cursor skills

Cursor doesn't import skills from a GitHub repo on its own. You have three options.

### 1. Copy the folder

Copy the skill folder into `.cursor/skills/` or `.agents/skills/` in your repo, or into `~/.cursor/skills/` for yourself. It's simple and works offline. The catch is updates: nothing tells you when the original changes, and copies drift between laptops.

### 2. Install a plugin

Cursor's official route for GitHub skills is plugins. The repository needs a `.cursor-plugin/marketplace.json`. You import it in Customize with From GitHub Repository, or add it as a team marketplace, then install the plugin. Good for skills their authors packaged that way, so check whether the repo ships that file first.

### 3. Install with the Skillpack CLI

Skillpack is the tool we build, so weigh this section accordingly. It installs a skill from any public GitHub folder or from your Skillpack workspace, and records the exact commit in a lockfile.

Skillpack doesn't have a Cursor target by name. Passing `--tools cursor` returns "unknown coding tool". It doesn't need one, though. Cursor reads `.agents/skills`, which Skillpack writes for OpenCode. So for a Cursor-only project, use `--tools opencode`:

```sh
skillpack install github:anthropics/skills/skills/frontend-design \
  --scope project --tools opencode
```

Before writing anything, the CLI shows the commit, lists executable files and asks you to confirm. Skillpack only copies files and never runs a skill's scripts. Add `--yes` in CI. In a test repo, that command produced:

```text
.agents/skills/frontend-design/   # what Cursor reads
.companion/skills.lock.json       # source, commit and checksums
```

Commit both. A teammate or CI job then runs `skillpack sync --frozen`, which checks the copies against the lock. When we deleted the skill folder and ran it, sync restored the recorded commit and left the lock unchanged. At user scope, `--scope user --tools opencode` targets `~/.agents/skills`, which Cursor also reads.

If your team uses Cursor alongside Claude Code or Codex, leave out `--tools`. The default writes `.agents/skills` plus `.claude/skills` and `.codex/skills` copies. Cursor reads all three folders, so it may list the same skill more than once. We haven't checked how Cursor handles that. If you see duplicates, the next section has a cleaner setup.

```cta
title: "One skill, every agent your team uses"
text: "Create a free Skillpack workspace to publish your team's skills and install the same pinned version in Cursor, Claude Code and Codex, on every laptop and in CI."
primary: { label: "Create a free Skillpack workspace", href: /login }
secondary: { label: "How to share skills with your team", href: /blog/how-to-share-claude-code-skills-with-your-team }
```

## Using the same skill in Cursor, Claude Code and Codex

Cursor is the easy one here, because it reads every other agent's folder. Codex reads `.agents/skills` and Claude Code reads `.claude/skills`, so a mixed team has two sensible layouts:

- **Codex and Cursor:** keep skills in `.agents/skills` only. Both agents read it, with no copies to maintain. Our [Codex skills guide](/blog/how-to-use-skills-in-codex) covers the Codex side.
- **Claude Code and Cursor:** keep skills in `.claude/skills` only. Cursor picks them up through its compatibility folders.

Once all three agents are involved, you need a copy in `.claude/skills` and one in `.agents/skills`. That's when a lockfile starts to pay off, so copies can't silently drift apart.

To keep one skill portable:

- Stick to `name`, `description` and Markdown steps. Other agents may not support Cursor fields like `paths`, `icon` and `color`.
- Keep the folder name equal to the skill `name`.
- Avoid tool names or paths that only exist in one agent.

For the team side, from git submodules to a shared registry, see [How to share Claude Code skills with your team](/blog/how-to-share-claude-code-skills-with-your-team). Looking for skills worth installing? Our [list of the best Claude Code skills](/blog/best-claude-code-skills) sticks to the shared SKILL.md format, which Cursor reads too.

## Skills in Cloud Agents and across your team

Local and cloud work differently here, and it catches people out.

- **Project skills** in the repo go wherever the repo goes, including Cloud Agents and automations. That's the safest place for team skills.
- **Personal skills** in `~/.cursor/skills/` stay on your machine until you turn on Sync Skills for Cloud Agents (Settings, then Agents). Synced skills stay private to you.
- **`~/.agents/skills/`** never syncs. Cursor doesn't copy it to Cloud Agents, remote SSH sessions or self-hosted workers.

On Teams and Enterprise plans, admins can switch sync off for everyone. To share a personal skill, open it in Customize, then Skills, and choose Publish. Cursor adds it to your team's marketplace, and teammates install it from there.

## Troubleshooting: my Cursor skill doesn't show up

Check these in order:

1. **Wrong folder.** The skill must sit in one of the folders listed above, in its own subfolder, with a file named exactly `SKILL.md`.
2. **Name mismatch.** The `name` field must match the folder name and use only lowercase letters, numbers and hyphens.
3. **Missing frontmatter.** `name` and `description` go between `---` lines at the top of the file.
4. **Scoped away.** A `paths` field, or a skill in a nested folder, only surfaces for matching files.
5. **Manual only.** With `disable-model-invocation: true` the agent never picks it on its own. Call it with `/`.
6. **Missing in Cloud Agents.** Skills in `~/.agents/skills` or unsynced `~/.cursor/skills` don't reach the cloud. Commit the skill to the repo instead.
7. **Never triggers.** Rewrite the description with the words you actually type, then test again.

Customize, then Skills, shows what Cursor discovered, which settles most of these quickly.

```faq
items:
  - question: "Where are Cursor skills stored?"
    answer: "Project skills go in `.agents/skills/` or `.cursor/skills/` in your repo. Personal skills go in `~/.agents/skills/` or `~/.cursor/skills/`. Cursor also loads `.claude/skills/`, `.codex/skills/` and their home-directory versions for compatibility."
  - question: "How do I use a skill in Cursor?"
    answer: "Type `/` in Agent chat and pick the skill, or type `@` to attach it as context. The agent can also load a skill on its own when your request matches its description. To keep a skill on for a whole session, use it as a Custom Mode."
  - question: "How do I create a skill in Cursor?"
    answer: "Type `/create-skill` and describe what you want, or create a folder in `.cursor/skills/` with a `SKILL.md` file. The file needs `name` and `description` frontmatter, followed by the instructions."
  - question: "What is the difference between Cursor rules and skills?"
    answer: "Rules are short guidelines added to the agent's context always, for matching files, or when relevant. Skills are detailed procedures loaded only when needed or when you call them. Use a rule for a constraint, a skill for a repeatable workflow."
  - question: "Do Claude Code skills work in Cursor?"
    answer: "Usually yes. Cursor reads `.claude/skills/` and `~/.claude/skills/` for compatibility, so skills written to the shared SKILL.md format work without changes."
  - question: "How do I install a skill from GitHub in Cursor?"
    answer: "Copy the folder into `.cursor/skills/` or `.agents/skills/`, install it as a plugin if the repo has a `.cursor-plugin/marketplace.json`, or use a CLI such as Skillpack: `skillpack install github:owner/repo/path --scope project --tools opencode` writes it to `.agents/skills`."
  - question: "Do my local skills work in Cursor Cloud Agents?"
    answer: "Only if they are in the repo or synced. Turn on Sync Skills for Cloud Agents to sync `~/.cursor/skills/`. Skills in `~/.agents/skills/` are not copied to Cloud Agents."
```

## Next step

Pick the instruction you paste into Cursor most often and turn it into a skill in `.agents/skills` today. When it's worth sharing, [create a free Skillpack workspace](/login) and install the same pinned version for everyone, whichever agent they use.
