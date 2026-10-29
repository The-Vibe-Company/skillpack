---
title: "Claude Code Skills vs Slash Commands vs Plugins (2026)"
description: "Custom slash commands are now skills in Claude Code. When to keep a command, write a skill or ship a plugin, plus the Codex and Cursor equivalents."
slug: claude-code-skills-vs-slash-commands
date: 2026-10-29
tags: ["Claude Code", "Agent Skills", "Slash commands", "Plugins"]
author: "Stan Girard"
authorRole: "co-founder of The Vibe Company, which builds Skillpack"
---

# Claude Code skills vs slash commands vs plugins: which one to use

Short answer: write a skill. In Claude Code, custom slash commands have been merged into skills, so `.claude/commands/deploy.md` and `.claude/skills/deploy/SKILL.md` both give you `/deploy`. A plugin isn't really a third option next to those two. It's a package that can hold skills, subagents, hooks and MCP servers, and you need one only when you ship several pieces together or reuse them across repos.

Behavior details below come from the official Claude Code docs on [skills](https://code.claude.com/docs/en/skills), [commands](https://code.claude.com/docs/en/commands) and [plugins](https://code.claude.com/docs/en/plugins). The Skillpack commands were run with Skillpack CLI 0.3.5 on 29 October 2026.

```takeaways
title: Key Takeaways
items:
  - lead: "Commands became skills"
    text: "A file in .claude/commands/ and a skill in .claude/skills/ both create /name. Old command files keep working."
  - lead: "Skills win on features"
    text: "A skill folder can carry scripts and reference files, and lets you choose whether Claude or only you can invoke it."
  - lead: "Same name, skill wins"
    text: "If a skill and a command share a name, Claude Code runs the skill."
  - lead: "Plugins are packaging"
    text: "Use one to bundle several components, install them in many repos or publish versioned releases. Plugin skills run as /plugin-name:skill-name."
  - lead: "Codex and Cursor went the same way"
    text: "Codex deprecated custom prompts in favor of skills. Cursor 2.4 ships /migrate-to-skills to convert slash commands."
```

## The four things people call "slash commands"

Type `/` in Claude Code and you see a mix of things that look the same but are built differently. The [commands reference](https://code.claude.com/docs/en/commands) splits them into built-in commands, whose behavior is coded into the CLI, and bundled skills, which are prompts handed to Claude like the skills you write yourself.

| What you type | What it is | Where it lives | Can you edit it? |
| :- | :- | :- | :- |
| `/help`, `/compact`, `/usage` | Built-in command | Inside the Claude Code CLI | No. A skill with the same name can replace it in a local terminal session |
| `/code-review`, `/batch` | Bundled skill | Shipped with Claude Code | No, but a skill with the same name replaces it |
| `/deploy` from `.claude/commands/deploy.md` | Legacy custom command | One Markdown file | Yes |
| `/deploy` from `.claude/skills/deploy/SKILL.md` | Skill | A folder with `SKILL.md` and optional files | Yes |
| `/my-plugin:review` | Skill inside a plugin | `my-plugin/skills/review/SKILL.md` | Yes, in the plugin source |

The useful comparison is the last three rows. Everything you write yourself is now either a command file, a skill, or a skill packaged in a plugin.

## Skill vs custom slash command

The skills page is direct about it: your existing `.claude/commands/` files keep working, and skills add optional features on top. In practice, it looks like this.

| | Custom command (`.claude/commands/`) | Skill (`.claude/skills/`) |
| :- | :- | :- |
| Creates `/name` | Yes | Yes |
| Frontmatter | Same fields, except `name` and `paths` | Full set, including `name` and `paths` |
| Supporting files (scripts, templates, references) | No, one file | Yes, anything in the folder |
| Claude can load it on its own when relevant | Yes, unless disabled | Yes, unless disabled |
| Manual-only mode | `disable-model-invocation: true` | `disable-model-invocation: true` |
| Claude-only mode (hidden from the `/` menu) | `user-invocable: false` | `user-invocable: false` |
| Wins a name clash | No | Yes |
| Portable to other agents | Claude Code only | `SKILL.md` follows the open [Agent Skills](https://agentskills.io) format |
| Subfolders | Namespaced: `commands/frontend/component.md` gives `/frontend:component` | One folder per skill |

Two rows matter most. Supporting files let a skill grow past a single prompt: a deploy skill can ship its script and a checklist next to `SKILL.md`, and Claude reads them only when needed. Portability matters if anyone on your team also uses Codex or Cursor, because both read `SKILL.md` folders and neither reads `.claude/commands/`.

### When a plain command file is still fine

Keep a command file if it's a short personal prompt, you only use Claude Code, and you have no files to bundle. There's no deadline to migrate. The plugin docs suggest keeping `commands/` only for files you are moving over, and say skills supersede commands for new work.

## Who invokes it: the setting that replaces "command vs skill"

The old mental model was "a command is something I type, a skill is something Claude picks up." With the merge, that choice moved into two frontmatter fields. This table is from the [skills docs](https://code.claude.com/docs/en/skills):

| Frontmatter | You can invoke | Claude can invoke | Context cost |
| :- | :- | :- | :- |
| (default) | Yes | Yes | Description always in context |
| `disable-model-invocation: true` | Yes | Not on its own | Description not in context |
| `user-invocable: false` | No | Yes | Description always in context |

Use `disable-model-invocation: true` for anything with side effects, like committing, deploying or posting a message. You decide when it runs, and it costs nothing in context until you type it. Use `user-invocable: false` for background knowledge, such as how a legacy system works, that Claude should apply but nobody should run as a command.

## When a plugin is worth it

A plugin is a directory with a manifest at `.claude-plugin/plugin.json` and components such as `skills/`, `agents/` (subagents, compared with skills in [Claude Code subagents vs skills](/blog/claude-code-subagents-vs-skills)), `hooks/` and `.mcp.json`. The [plugins overview](https://code.claude.com/docs/en/plugins) notes that skills, subagents, hooks and MCP servers all work on their own without one. The [features overview](https://code.claude.com/docs/en/features-overview) gives the trigger in one line: when a second repository needs the same setup, package it as a plugin.

| Your situation | Use |
| :- | :- |
| You keep typing the same prompt in one repo | A skill in `.claude/skills/` |
| You want it in every project on your machine | A skill in `~/.claude/skills/` |
| One skill, shared with the team through the repo | A project skill, committed |
| Several skills plus a hook, a subagent or an MCP server that belong together | A plugin |
| The same setup in many repos, with versioned updates | A plugin from a marketplace |

Plugins come with costs that a project skill doesn't have. An enabled plugin is part of every session. The name and description of each skill, agent and command Claude can invoke sit in context on every turn. Its MCP servers run and its hooks fire. And whatever it runs, it runs as you. Plugin skills are also namespaced, so `review` in a plugin becomes `/my-plugin:review`. That avoids clashes but makes names longer.

You install plugins with `/plugin install <plugin>@<marketplace>` at user, project or local scope, and while building one you can load it for a single session with `claude --plugin-dir ./my-plugin`.

### A real example: Anthropic's commit-commands plugin

We cloned Anthropic's [claude-plugins-official](https://github.com/anthropics/claude-plugins-official) marketplace (commit `f8c5e7a`) to see how a published plugin is laid out. `plugins/commit-commands` contains only a `plugin.json` manifest and a `commands/` folder with three files: `commit.md`, `commit-push-pr.md` and `clean_gone.md`. So it's a plugin built entirely from legacy command files. The same repo's `example-plugin` ships one command both ways, as `commands/example-command.md` and as `skills/example-command/SKILL.md`, and states that the two are functionally identical, with only the file layout differing.

## How to migrate a command to a skill

We moved `commit.md` from that plugin into a skill in a scratch repo. Four steps:

1. Create the folder: `.claude/skills/commit/`.
2. Move the file to `.claude/skills/commit/SKILL.md`.
3. Add `name` and a specific `description` to the frontmatter. Keep `allowed-tools` as it was.
4. Add `disable-model-invocation: true` if the command has side effects. A commit does, so we added it.

The resulting frontmatter:

```yaml
---
name: commit
description: Create a git commit from the current changes
disable-model-invocation: true
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*)
---
```

The body, including its `!` lines that inject `git status`, `git diff HEAD`, the branch and recent commits, stayed the same. You still type `/commit`. If you leave the old file in `.claude/commands/` during the move, the skill runs, because a skill wins a name clash.

Then we checked both layouts with the Skillpack CLI:

```sh
skillpack skills validate .claude/skills/commit
# valid: true, name "commit", files: 1, exit 0

skillpack skills validate .claude/commands
# "SKILL.md is missing or oversized", exit 5
```

The same split shows up with plugins. A skill inside a plugin is still a plain `SKILL.md` folder, so you can take it without the plugin. A plugin made only of command files can't be taken that way:

```sh
skillpack install github:anthropics/claude-plugins-official/plugins/frontend-design/skills/frontend-design \
  --scope project --tools claude-code,codex --dry-run
# targets .agents/skills, .claude/skills and .codex/skills, pinned to commit f8c5e7a, exit 0

skillpack install github:anthropics/claude-plugins-official/plugins/commit-commands \
  --scope project --tools claude-code --dry-run
# "SKILL.md is missing or oversized", exit 5
```

That last result is what staying on command files costs you in practice. Tools built around the Agent Skills format expect a `SKILL.md` folder, so a bare command file can't be validated, versioned or installed as a skill. We did not run Claude Code itself in this test, so the invocation behavior above comes from the docs.

For a full walkthrough of writing one from scratch, see [How to create a Claude Code skill](/blog/how-to-create-a-claude-code-skill). For the format itself, see [What is SKILL.md?](/blog/what-is-skill-md).

```cta
title: "Keep every skill versioned in one place"
text: "Create a free Skillpack workspace to store your team's SKILL.md folders with versions and checksums, then install them into Claude Code and Codex with one command."
primary: { label: "Create a free Skillpack workspace", href: /login }
secondary: { label: "Read the SKILL.md guide", href: /blog/what-is-skill-md }
```

## What about Codex and Cursor?

Both moved in the same direction as Claude Code.

| | Old way | Current way | Source |
| :- | :- | :- | :- |
| Claude Code | `.claude/commands/*.md` | Skills in `.claude/skills/`, plugins to package them | [Claude Code skills](https://code.claude.com/docs/en/skills) |
| Codex | Custom prompts in `~/.codex/prompts/`, run as `/prompts:name` | Skills. Custom prompts are marked deprecated | [Codex custom prompts](https://developers.openai.com/codex/custom-prompts) |
| Cursor | Slash commands | Skills. `/migrate-to-skills` converts commands to skills with `disable-model-invocation: true` | [Cursor skills](https://cursor.com/docs/skills) |

Codex's docs give the reason: custom prompts need explicit invocation and live in your local Codex home folder, so they aren't shared through the repository. Skills can be invoked explicitly or implicitly and can live in the repo. Cursor's docs describe `disable-model-invocation: true` as the way to make a skill behave like a traditional slash command. More detail in [How to use skills in Codex](/blog/how-to-use-skills-in-codex).

## Common mistakes

- **Writing new commands in `.claude/commands/`.** They work, but they can't carry files and other agents won't read them. Start new ones as skills.
- **Leaving side-effect skills auto-invocable.** A `/deploy` or `/commit` skill without `disable-model-invocation: true` lets Claude decide when to run it.
- **Wrapping one skill in a plugin.** For a single skill shared through one repo, a committed project skill does the job without the per-session plugin overhead.
- **Keeping both files during a migration and editing the wrong one.** The skill wins the name clash, so edits to the old command file do nothing. Delete it once the skill works.
- **Vague descriptions.** Claude decides when to load a skill from its description, so "helper" won't trigger. Say what it does and when.

```faq
items:
  - question: "Are slash commands the same as skills in Claude Code?"
    answer: "Custom slash commands have been merged into skills. A file at .claude/commands/deploy.md and a skill at .claude/skills/deploy/SKILL.md both create /deploy and work the same way. Skills add supporting files and frontmatter fields such as name and paths."
  - question: "Do my existing .claude/commands files still work?"
    answer: "Yes. The Claude Code docs say existing command files keep working. You only need to move one when you want to add supporting files or share it with other agents."
  - question: "What happens if a skill and a command have the same name?"
    answer: "The skill runs. Plugin skills don't clash with yours because they are namespaced as /plugin-name:skill-name."
  - question: "How do I make a skill run only when I type it?"
    answer: "Add disable-model-invocation: true to its frontmatter. Claude won't load it on its own, and its description stays out of context until you invoke it."
  - question: "When should I use a plugin instead of a skill?"
    answer: "When you want several skills, subagents, hooks or MCP servers installed as one unit, reused across repositories, or published with versioned updates. A single skill works fine on its own."
  - question: "Do plugins cost context?"
    answer: "An enabled plugin adds the name and description of each skill, agent and command Claude can invoke to context on every turn, even in sessions where you don't use it. Its MCP servers and hooks also run."
  - question: "What replaced custom prompts in Codex?"
    answer: "Skills. OpenAI's Codex docs mark custom prompts as deprecated and point to skills for reusable instructions that can be shared through the repository."
```

## Next step

Pick one command you type every week, move it into `.claude/skills/<name>/SKILL.md`, and add `disable-model-invocation: true` if it changes anything. When the team needs the same skills in every repo, [create a free Skillpack workspace](/login) to version them and install them in each agent with one command.
