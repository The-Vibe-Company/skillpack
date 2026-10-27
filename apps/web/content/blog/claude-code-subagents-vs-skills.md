---
title: "Claude Code Subagents vs Skills: When to Use Each (2026)"
description: "Claude Code subagents vs skills: what each one is, how they load context, when to pick which, and how to combine them with skills: and context: fork."
slug: claude-code-subagents-vs-skills
date: 2026-10-27
tags: ["Claude Code", "Subagents", "Agent Skills", "SKILL.md"]
author: "Stan Girard"
authorRole: "co-founder of The Vibe Company, which builds Skillpack"
---

# Claude Code subagents vs skills: when to use each

A skill teaches Claude how to do a job. A subagent is a separate worker that does a job in its own context window and hands back a summary. Skills load into your current conversation when they're needed. Subagents start fresh, with their own system prompt, their own tools and their own permissions.

Most teams end up using both. Claude Code lets you combine them in two directions. This guide covers the difference, a simple rule for choosing, and a working setup where a subagent preloads a skill. Behavior details come from the official docs on [subagents](https://code.claude.com/docs/en/sub-agents) and [skills](https://code.claude.com/docs/en/skills). The Skillpack commands were run with Skillpack CLI 0.3.5 on 27 October 2026.

```takeaways
title: Key Takeaways
items:
  - lead: "A skill is instructions. A subagent is a worker."
    text: "Skills add a procedure to the current conversation. Subagents run a task in a separate context and return a summary."
  - lead: "Skills share your context. Subagents don't."
    text: "A subagent doesn't see your conversation history, the skills you already used or the files Claude already read."
  - lead: "Pick a subagent when the output is noisy or the tools must be limited."
    text: "Pick a skill when you want a reusable workflow that runs in the main conversation."
  - lead: "You can combine them."
    text: "A subagent can preload skills with the skills field, and a skill can run inside a subagent with context: fork."
  - lead: "Skills travel further."
    text: "SKILL.md follows the Agent Skills open standard. Subagent files are a Claude Code format."
```

## What a Claude Code skill is

A skill is a folder with a `SKILL.md` file. The frontmatter gives it a name and a description, and the body holds the instructions. Claude keeps every skill's description in context, loads the full body when your request matches, and you can also call it yourself with `/skill-name`.

Anthropic's docs suggest writing a skill when you keep pasting the same checklist or procedure into chat. The body only loads on use, so a long skill costs almost nothing until it runs. Custom commands have been merged into skills: `.claude/commands/deploy.md` and `.claude/skills/deploy/SKILL.md` both create `/deploy`.

Project skills live in `.claude/skills/<name>/SKILL.md`, personal ones in `~/.claude/skills/`. Skills follow the [Agent Skills](https://agentskills.io) open standard, so the same file can work in other agents. More on the format in [What is SKILL.md](/blog/what-is-skill-md), and on writing one in [how to create a Claude Code skill](/blog/how-to-create-a-claude-code-skill).

## What a Claude Code subagent is

A subagent is a Markdown file with YAML frontmatter, stored in `.claude/agents/` for a project or `~/.claude/agents/` for you. Only `name` and `description` are required. The body becomes the subagent's system prompt.

```md
---
name: code-reviewer
description: Reviews code for quality and best practices
tools: Read, Glob, Grep
model: sonnet
---

You are a code reviewer. When invoked, analyze the code and provide
specific, actionable feedback on quality, security, and best practices.
```

When a task matches a subagent's description, Claude delegates to it. The subagent works in its own context window and returns only the result. Per the docs, that keeps exploration out of your main conversation, lets you restrict tools, reuses the same setup across projects, and can route routine work to a cheaper model such as Haiku.

Claude Code also ships built-in subagents. Explore and Plan are read-only and search the codebase. General-purpose can both explore and edit.

## Subagents vs skills: the differences that matter

| | Skill | Subagent |
| :- | :- | :- |
| What it is | Instructions and supporting files | A separate worker with its own system prompt |
| Context | Loads into your current conversation | Fresh context window, returns a summary |
| Sees your conversation history | Yes | No (except a fork of the conversation) |
| File | `.claude/skills/<name>/SKILL.md` | `.claude/agents/<name>.md` |
| How it runs | Claude loads it when relevant, or you type `/name` | Claude delegates by description, or you name it or @-mention it |
| Tools and permissions | Your session's, plus optional pre-approved tools | Its own `tools`, `disallowedTools` and `permissionMode` |
| Model | Session model, or `model` for the current turn | Its own `model`, such as `haiku` for cheap tasks |
| What sits in context before use | The description | The description |
| Portability | Agent Skills standard, used by other agents | Claude Code format |

Context is the biggest difference. A skill works with everything you and Claude have said so far. A subagent starts from a short delegation message that Claude writes. That's why the docs keep quick, iterative work in the main conversation, and send self-contained, noisy work to subagents.

## When to use a skill

Use a skill when:

- you want Claude to follow the same procedure every time, like a release checklist or your API conventions;
- the work needs back-and-forth with you, or builds on what's already in the conversation;
- you want to trigger it yourself with `/name`. Add `disable-model-invocation: true` for anything with side effects, like `/deploy`, so Claude can't run it on its own;
- you want the same instructions to work in Codex, Cursor or another agent that reads `SKILL.md`.

## When to use a subagent

Use a subagent when:

- the task produces a lot of output you won't need again, like test logs, search results or a large file scan;
- the worker should have fewer tools than your session. A reviewer with only Read, Grep and Glob can't edit files;
- the job is self-contained and a summary is enough, such as "find every call site of this function";
- you want to run research in parallel, or route routine work to a cheaper model.

If the job needs your conversation history, a regular subagent won't cut it. The docs point to forking the conversation instead, which hands the subagent everything discussed so far.

## Using skills and subagents together

Claude Code wires them together in both directions.

**1. A subagent that preloads skills.** Add a `skills` list to the subagent's frontmatter. The full content of each listed skill is injected when the subagent starts, not just the description. The subagent keeps its own system prompt and receives Claude's delegation message as its task.

**2. A skill that runs inside a subagent.** Add `context: fork` to a skill's frontmatter, and optionally `agent` to choose the subagent type (`Explore`, `Plan`, `general-purpose` or one of yours). The skill's content becomes the subagent's task. It doesn't see your conversation, so the skill has to stand on its own. The docs warn that this only works for skills with explicit steps. A skill that only lists guidelines gives the subagent nothing to do.

| Approach | System prompt | Task |
| :- | :- | :- |
| Subagent with `skills` | The subagent's Markdown body | Claude's delegation message |
| Skill with `context: fork` | From the agent type | The SKILL.md content |

Put simply: a subagent with skills is a specialist with reference material. A forked skill is a procedure you send off to run on its own.

## Example: an end-to-end test subagent that uses a skill

Here is the first pattern, built in an empty repo. The skill is Anthropic's `webapp-testing`, which drives a local web app with Playwright. It's one of the skills we compared in [best Claude Code skills for testing](/blog/best-claude-code-skills-testing). Install it into the project with the Skillpack CLI:

```sh
skillpack install github:anthropics/skills/skills/webapp-testing --scope project --tools claude-code
```

Skillpack shows the source commit and warns that the skill contains an executable script. It asks you to confirm because the skill comes from a third party. Pass `--yes` in CI. It then copies the skill to `.agents/skills/webapp-testing` and `.claude/skills/webapp-testing` and pins the version in `.companion/skills.lock.json`.

Then add the subagent in `.claude/agents/e2e-tester.md`:

```md
---
name: e2e-tester
description: Runs browser tests against the local app and reports failures. Use after UI changes.
tools: Read, Grep, Glob, Bash
skills:
  - webapp-testing
---

You test the local web app. Start the dev server, run the flows you were given, and report each failure with the step and the error.
```

The skill holds the how-to: Playwright usage and helper scripts. The subagent holds the role: limited tools, a focused prompt, and its own context so test logs stay out of your main conversation. Ask Claude to "use the e2e-tester agent to check the signup flow", and you get back a list of failures instead of a wall of output.

Two limits from the docs: you can't preload a skill that sets `disable-model-invocation: true`, and the `skills` field only controls what is preloaded. The subagent can still call other skills through the Skill tool unless `Skill` is left out of its tools. Our `e2e-tester` lists its tools explicitly and doesn't include `Skill`, so it only gets the skill we preloaded.

Both files were written on the box we use for testing. We didn't run Claude Code there, so the delegation step above follows the docs rather than a live run.

```cta
title: "Keep the skills your subagents depend on in sync"
text: "Create a free Skillpack workspace to publish your team's skills and install the same pinned version on every laptop and in CI, so every subagent preloads the same instructions."
primary: { label: "Create a free Skillpack workspace", href: /login }
secondary: { label: "How to share skills with your team", href: /blog/how-to-share-claude-code-skills-with-your-team }
```

## Common mistakes

- **Turning every procedure into a subagent.** A subagent starts with no context and has to gather it again, which adds latency. If the task needs back-and-forth or depends on the conversation, a skill is usually faster.
- **Forking a skill that has no task.** `context: fork` on a style guide returns nothing useful. Keep reference skills inline, or preload them into a subagent.
- **Long descriptions.** Both skill and subagent descriptions sit in context all the time. Claude Code shows a startup warning when your custom subagents' descriptions pass 15,000 tokens combined. Keep descriptions short and put detail in the body.
- **Expecting CLAUDE.md everywhere.** Most subagents load your CLAUDE.md files, but the built-in Explore and Plan agents skip them. A forked skill with `agent: Explore` only gets the skill content and the agent's own prompt.

## Sharing skills and subagents with a team

Both are plain files, so the simplest way to share them is to commit `.claude/skills/` and `.claude/agents/` to the repo. Plugins can also bundle skills and subagents together. Note that plugin subagents ignore the `hooks`, `mcpServers` and `permissionMode` fields.

Skills change more often than subagent definitions, and they're the piece other agents can reuse. Skillpack installs and pins skills, not subagent files. Your subagents can name skills in their `skills` field, and `skillpack sync --frozen` restores the exact pinned versions on any machine or in CI. The details are in [how to share Claude Code skills with your team](/blog/how-to-share-claude-code-skills-with-your-team) and [how to install skills in Claude Code](/blog/how-to-install-skills-in-claude-code).

```faq
items:
  - question: "What is the difference between Claude Code subagents and skills?"
    answer: "A skill is a set of instructions that loads into your current conversation when needed. A subagent is a separate worker with its own context window, system prompt, tools and permissions, which does a task and returns a summary."
  - question: "When should I use a subagent instead of a skill?"
    answer: "Use a subagent when the task produces verbose output you don't need, when you want to restrict tools or permissions, or when the work is self-contained and a summary is enough. Use a skill for reusable workflows that run in the main conversation."
  - question: "Can a subagent use skills?"
    answer: "Yes. List skills in the subagent's `skills` frontmatter field and their full content is injected at startup. Without that field, the subagent can still load skills through the Skill tool."
  - question: "What does context: fork do in a skill?"
    answer: "It runs the skill in a new subagent. The skill content becomes the task, and the `agent` field picks the subagent type, defaulting to general-purpose. The subagent doesn't see your conversation history."
  - question: "Where are Claude Code subagents stored?"
    answer: "Project subagents go in `.claude/agents/`, personal ones in `~/.claude/agents/`. Subagents can also come from plugins, managed settings or the `--agents` CLI flag for one session."
  - question: "Are slash commands the same as skills?"
    answer: "Custom commands have been merged into skills. A file in `.claude/commands/` and a skill in `.claude/skills/` both create a `/name` command. Skills add supporting files and invocation control."
  - question: "Do subagents work in Codex or Cursor?"
    answer: "Subagent files in `.claude/agents/` are a Claude Code format. Skills follow the Agent Skills open standard, so the SKILL.md part of your setup is the piece that carries over to other agents."
```

## Next step

Look at the last task where Claude buried your conversation in logs or search results, and start your first subagent there. For your first skill, take the instructions you paste most often. When the skills are worth sharing, [create a free Skillpack workspace](/login) so every subagent on your team preloads the same version.
