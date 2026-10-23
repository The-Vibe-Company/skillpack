---
title: "Codex Skills: How to Install, Use and Create Them (2026)"
description: "Codex skills explained: where Codex looks for SKILL.md folders, how to invoke them with $ or /skills, and how to install, write, disable and share them."
slug: how-to-use-skills-in-codex
date: 2026-10-21
tags: ["Codex", "Agent Skills", "SKILL.md", "Skillpack CLI"]
author: "Stan Girard"
authorRole: "co-founder of The Vibe Company, which builds Skillpack"
---

# Codex skills: how to install, use and create them

A Codex skill is a folder with a `SKILL.md` file that teaches Codex one job, like fixing a failing CI run or writing release notes your way. Codex reads the name and description of every installed skill, then loads the full instructions only when a task matches or when you type `$skill-name`. Put skills in `.agents/skills` inside your repo, or in `~/.agents/skills` for your own machine.

That's the short version. Below you'll find where Codex actually looks, how to call a skill and three ways to install one. Then we write a skill and make it work in Claude Code too. Every command here was checked against the [official Codex docs](https://developers.openai.com/codex/skills) and, for the Skillpack parts, run with Skillpack CLI 0.3.5 on 21 October 2026.

```takeaways
title: Key Takeaways
items:
  - lead: "Repo skills live in .agents/skills."
    text: "Codex scans .agents/skills from your working directory up to the repo root. Personal skills go in ~/.agents/skills."
  - lead: "Call a skill with $ or /skills."
    text: "Codex can also pick a skill on its own when your request matches its description."
  - lead: "Codex ships with helper skills."
    text: "The built-in $skill-creator writes new skills and $skill-installer pulls curated ones from GitHub."
  - lead: "The description decides triggering."
    text: "Codex shortens descriptions when many skills are installed, so put the use case first."
  - lead: "One folder, several agents."
    text: "The SKILL.md format is an open standard. Claude Code reads .claude/skills, Codex reads .agents/skills, and a tool like Skillpack can write both."
```

## What a Codex skill is

A skill packages instructions, plus optional scripts and reference files, so Codex follows a workflow the same way every time. OpenAI builds skills on the open [Agent Skills standard](https://agentskills.io), the same `SKILL.md` format Claude Code and other agents use. If you've never opened one, [What is SKILL.md?](/blog/what-is-skill-md) walks through the file field by field.

The folder looks like this:

```text
my-skill/
  SKILL.md          # required: name, description, instructions
  scripts/          # optional: code the skill can run
  references/       # optional: longer docs loaded on demand
  assets/           # optional: templates, images
  agents/
    openai.yaml     # optional: Codex/ChatGPT display name, policy, tool dependencies
```

Skills use what OpenAI calls progressive disclosure. At the start of a session Codex only sees each skill's name, description and file path. It reads the whole `SKILL.md` when it decides to use that skill. So a dozen installed skills cost you very little context until one is needed.

There is a cap, though. By default the skills list takes at most 2% of the model's context window (8,000 characters if the window is unknown). With many skills installed, Codex shortens descriptions first and may drop some from the list with a warning. You can set a different budget with `skills.max_context_tokens`, up to 10,000 tokens.

## Where Codex looks for skills

This is the part most people get stuck on. The [Codex docs](https://developers.openai.com/codex/skills) list these locations:

| Scope | Path | Use it for |
|---|---|---|
| Repo | `$CWD/.agents/skills` | Skills for one module or service |
| Repo | `$CWD/../.agents/skills` | Skills for a shared parent folder |
| Repo | `$REPO_ROOT/.agents/skills` | Skills for everyone in the repo |
| User | `~/.agents/skills` | Your personal skills, in every repo |
| Admin | `/etc/codex/skills` | Machine-wide skills, containers, automation |
| System | Bundled with Codex | Built-ins like `skill-creator` |

A few details that save time:

- **`~/.codex/skills` is the old location.** Codex added `~/.agents/skills` in early 2026 and kept reading `~/.codex/skills` for backward compatibility ([openai/codex#10437](https://github.com/openai/codex/pull/10437)). New skills should go in `~/.agents/skills`.
- **Same name, no merge.** If two folders define a skill with the same `name`, Codex doesn't combine them. Both can show up in the picker.
- **Symlinks work.** Codex follows a symlinked skill folder to its target.
- **Changes are picked up automatically.** If a new or edited skill doesn't appear, restart Codex.

## How to use a skill in Codex

There are two ways a skill gets used.

**Explicitly.** In the Codex CLI or IDE extension, type `$` and start typing the skill name, or run `/skills` to browse what's installed. For example:

```text
$sentry summarize the new production errors from the last 24 hours
```

**Implicitly.** You just describe the task, and Codex picks the skill whose description matches. "What broke in production overnight?" can load a Sentry skill without you naming it.

If you only want a skill to run when you ask for it, add `agents/openai.yaml` with this policy:

```yaml
policy:
  allow_implicit_invocation: false
```

Codex then ignores the skill for automatic matching, but `$skill-name` still works. That's useful for skills with side effects, like deploying or opening pull requests.

## How to install Codex skills

You have three options. Pick based on whether the skill is just for you or for a whole team.

### 1. The built-in installer

Codex ships with a `$skill-installer` skill. Ask it for a curated skill by name, or point it at a GitHub folder:

```text
$skill-installer linear
$skill-installer install https://github.com/<owner>/<repo>/tree/main/<skill-folder>
```

One thing to know: the [openai/skills](https://github.com/openai/skills) repository, the original source of curated skills, is now marked deprecated. OpenAI points to [openai/plugins](https://github.com/openai/plugins) for current examples. For distributing your own skills to other people, OpenAI recommends packaging them as a [plugin](https://developers.openai.com/codex/plugins/build).

### 2. Copy the folder yourself

A skill is just files, so `git clone` or a plain copy works:

```sh
mkdir -p ~/.agents/skills
cp -R ./my-skill ~/.agents/skills/my-skill
```

This is fine for one person. It gets messy on a team: nobody knows which version is on which laptop, and an edit in one repo never reaches the others.

### 3. Install with the Skillpack CLI

Skillpack is the tool we build, so weigh this section accordingly. It installs a skill from a public GitHub folder or your Skillpack workspace into every agent you use. It also records the exact commit in a lockfile.

```sh
skillpack install github:openai/plugins/plugins/sentry/skills/sentry \
  --scope project --tools codex,claude-code
```

Before writing anything, the CLI shows the commit and lists executable files (this one has a `scripts/` folder). Then it asks you to confirm, because a third-party skill can tell your agent to run commands. Skillpack copies files and never runs the scripts itself. Add `--yes` for CI.

In a test repo, that command produced:

```text
.agents/skills/sentry/      # what Codex reads
.claude/skills/sentry/      # what Claude Code reads
.codex/skills/sentry/       # extra copy managed by Skillpack
.companion/skills.lock.json # source, commit and checksums
```

Commit the skill folders and the lock. A teammate or a CI job then runs `skillpack sync --frozen --project .`, which checks the copies offline against the lock. When we deleted the `.codex` copy and ran it, sync restored it from a verified copy and left the lock unchanged. It fails instead of guessing when a copy was edited locally. If the setup is new to you, [How to install skills in Claude Code](/blog/how-to-install-skills-in-claude-code) covers the same flow from the Claude Code side.

At user scope (`--scope user`, the default), Skillpack currently writes the Codex copy to `~/.codex/skills`, the older folder Codex still reads. With the default tool list it also writes `~/.agents/skills`.

```cta
title: "Install a skill once, use it in Codex and Claude Code"
text: "Create a free Skillpack workspace to publish your team's skills and install the same pinned version on every laptop and in CI."
primary: { label: "Create a free Skillpack workspace", href: /login }
secondary: { label: "How to share skills with your team", href: /blog/how-to-share-claude-code-skills-with-your-team }
```

## How to create your own Codex skill

The fastest route is the built-in creator:

```text
$skill-creator
```

It asks what the skill should do, when it should trigger and whether it needs scripts. Instruction-only is the default, and it's usually the right start.

Writing one by hand takes two minutes:

```sh
mkdir -p .agents/skills/release-notes
```

Then create `.agents/skills/release-notes/SKILL.md`:

```md
---
name: release-notes
description: Write user-facing release notes from merged pull requests. Use when asked for release notes, a changelog entry or "what shipped". Do not use for internal commit messages.
---

1. List PRs merged since the last tag with `git log --merges <last-tag>..HEAD`.
2. Group them under New, Improved and Fixed. Skip refactors and dependency bumps.
3. Write one plain sentence per change, from the user's point of view.
```

Three habits from OpenAI's own [best practices](https://developers.openai.com/codex/skills):

- **One job per skill.** Split "release notes and deploy" into two.
- **Say when not to trigger.** The `description` is all Codex sees before loading the skill, so state the scope and the boundaries.
- **Prefer instructions over scripts** unless you need deterministic output or an external tool.

Test it twice: once with a request that should match ("what shipped this week?"), once with `$release-notes`. If the explicit call works and the implicit one doesn't, fix the description, not the steps. Our [step-by-step guide to creating a skill](/blog/how-to-create-a-claude-code-skill) goes deeper on testing and on adding scripts and references. Before sharing, `skillpack skills validate ./release-notes` checks the name and description locally and exits nonzero if something is wrong.

## How to turn a skill off

You don't have to delete a skill to stop Codex from using it. Add an entry to `~/.codex/config.toml`:

```toml
[[skills.config]]
path = "/path/to/skill/SKILL.md"
enabled = false
```

Restart Codex after editing the file.

## Skills vs AGENTS.md vs plugins vs MCP

These four overlap, so here's how they split:

| | What it is | Loaded when | Best for |
|---|---|---|---|
| `AGENTS.md` | Project instructions file | Every run, up to 32 KiB by default | Rules that always apply: test commands, conventions |
| Skill | Folder with `SKILL.md` | Only when the task matches or you call it | Repeatable workflows you don't need every time |
| Plugin | Package of skills, optionally with connectors | Installed from a plugin directory | Distributing skills to people outside your repo |
| MCP server | Live connection to a tool or API | When Codex calls its tools | Reading or changing data in another system |

A good rule of thumb: if the instruction matters on every task, put it in [`AGENTS.md`](https://developers.openai.com/codex/guides/agents-md). If it matters for one kind of task, make it a skill. If the skill needs live data, pair it with an MCP server. [Agent skills vs MCP](/blog/agent-skills-vs-mcp) explains that split in more detail.

## Using the same skill in Codex and Claude Code

Many teams run both agents. The skill format is shared, but the folders aren't: Codex reads `.agents/skills`, Claude Code reads `.claude/skills`.

To keep one skill working in both:

- Stick to `name`, `description` and Markdown instructions. Put Codex-specific settings in `agents/openai.yaml`, not in the frontmatter.
- Keep the folder name equal to the skill `name`.
- Avoid paths that only exist in one agent's setup.

Then either symlink one folder to the other, or install with a tool that writes both. The Skillpack command above did exactly that with `--tools codex,claude-code`. For teams, [How to share Claude Code skills with your team](/blog/how-to-share-claude-code-skills-with-your-team) compares the options, from git submodules to a shared registry. Cursor reads both folders too, as our [Cursor skills guide](/blog/how-to-use-skills-in-cursor) explains.

## Troubleshooting: my Codex skill doesn't show up

Go through these in order:

1. **Wrong folder.** Repo skills belong in `.agents/skills`. `.claude/skills` is not on Codex's list, and `.codex/skills` is the deprecated spot. Check that you launched Codex inside the repo.
2. **Missing frontmatter.** `SKILL.md` needs `name` and `description` between `---` lines.
3. **Not reloaded yet.** Restart Codex.
4. **Disabled.** Look for an `enabled = false` entry in `~/.codex/config.toml`.
5. **Pushed out of the list.** With lots of skills installed, Codex may shorten or omit some. Remove skills you don't use, or raise `skills.max_context_tokens`.
6. **Never triggers on its own.** Check `allow_implicit_invocation` in `agents/openai.yaml`, then rewrite the description with the words you actually type.

```faq
items:
  - question: "Where are Codex skills stored?"
    answer: "Repo skills live in `.agents/skills`, scanned from your current directory up to the repo root. Personal skills go in `~/.agents/skills`, machine-wide ones in `/etc/codex/skills`, and built-in skills ship with Codex. The older `~/.codex/skills` folder is still read for backward compatibility."
  - question: "How do I use a skill in Codex?"
    answer: "Type `$` followed by the skill name, or run `/skills` to browse installed skills. Codex can also load a skill on its own when your request matches the skill's description."
  - question: "How do I install a skill in Codex?"
    answer: "Use the built-in `$skill-installer` with a skill name or a GitHub folder URL, copy the folder into `.agents/skills` or `~/.agents/skills`, or use a CLI such as Skillpack: `skillpack install github:owner/repo/path --scope project --tools codex`."
  - question: "How do I create a Codex skill?"
    answer: "Run `$skill-creator` and answer its questions, or create a folder in `.agents/skills` with a `SKILL.md` file containing `name` and `description` frontmatter followed by the instructions."
  - question: "What is the difference between AGENTS.md and a skill in Codex?"
    answer: "Codex reads `AGENTS.md` at the start of every run, so it suits rules that always apply. A skill is loaded only when the task matches or you call it, so it suits specific workflows."
  - question: "Do Claude Code skills work in Codex?"
    answer: "Usually yes, if they stick to the shared SKILL.md format. Copy or install them into `.agents/skills` for Codex, since Codex doesn't read `.claude/skills`."
  - question: "Do I need to restart Codex after adding a skill?"
    answer: "Codex detects skill changes automatically. If a new or edited skill doesn't appear, restart it. Changes to `~/.codex/config.toml` always need a restart."
```

## Next step

Take the one instruction you paste into Codex most often and turn it into a skill in `.agents/skills` today. When it's worth sharing, [create a free Skillpack workspace](/login) and install the same version in Codex and Claude Code for the whole team.
