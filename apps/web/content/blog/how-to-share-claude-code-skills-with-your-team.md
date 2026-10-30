---
title: "How to Share Claude Code Skills With Your Team"
description: "Four ways to share Claude Code skills with your team: commit them to the repo, ship a plugin, provision them in claude.ai, or use a Skills Hub with a lockfile."
slug: how-to-share-claude-code-skills-with-your-team
date: 2026-10-15
tags: ["Claude Code", "Agent Skills", "Skillpack CLI", "Teams"]
---

# How to share Claude Code skills with your team

Someone on your team writes a great skill. Maybe it's a `SKILL.md` that gets Claude Code to write release notes your way, or to run the migration checklist without skipping steps. They paste it in Slack or drop it in a gist, and everyone copies it into their own `~/.claude/skills/` folder.

Two weeks later there are four versions of that skill. One person fixed a bug in theirs. Another never got the fix. Nobody knows which copy CI uses, or what changed.

That's the real problem. Getting a file to a teammate is easy. Keeping the whole team on the same version isn't.

This guide goes through the options you have today, what each one is good at, and a setup that keeps every machine and every CI run on the same skills. If you're new to the format, start with [What is SKILL.md?](/blog/what-is-skill-md).

## Why copy-paste breaks down

A skill is a folder with a `SKILL.md` file and maybe a few scripts. That makes it easy to share, and just as easy to fork by accident. When skills travel through Slack or gists:

- **There's no version.** You can't tell if your copy is the latest one.
- **Fixes don't spread.** The author improves the skill. Everyone else's copy stays the same.
- **Local edits go unnoticed.** Someone tweaks their copy, and Claude behaves differently on their machine only.
- **CI and cloud sessions miss them.** Claude Code's docs say personal skills in `~/.claude/skills/` aren't loaded in cloud sessions or routines ([Claude Code docs](https://code.claude.com/docs/en/skills)). If a skill only lives on your laptop, those runs don't get it.
- **Each agent has its own folder.** If part of the team uses Codex or OpenCode, the same skill gets copied to even more places.

## Where Claude Code loads skills from

Before you pick a method, it helps to know where Claude Code looks. The official docs list these locations ([Claude Code docs, where skills load](https://code.claude.com/docs/en/skills)):

| Location | Path | Who gets it |
|---|---|---|
| Personal | `~/.claude/skills/<name>/SKILL.md` | You, in all your projects on this machine |
| Project | `.claude/skills/<name>/SKILL.md` | Anyone working in the repo, once it's committed |
| Plugin | `<plugin>/skills/<name>/SKILL.md` | Anyone who enables the plugin, as `/plugin-name:skill-name` |
| Enterprise | `.claude/skills/` in the managed settings directory | All users on machines your organization manages |
| claude.ai account | Skills enabled for your claude.ai account | Sessions where you sign in with that account |

Each sharing method below maps to one of these locations.

## Option 1: commit skills to the repo

The simplest setup: put the skill in `.claude/skills/` at the root of the repo and commit it.

```sh
mkdir -p .claude/skills/release-notes
# add SKILL.md and any scripts
git add .claude/skills/release-notes
git commit -m "Add release-notes skill"
```

Everyone who pulls the repo gets the skill. Changes go through pull requests like any other code. Claude Code also loads skills from parent directories up to the repo root, so this works in monorepos too.

**Good for:** skills that belong to one repo, like a deploy recipe or a project's test conventions.

**Where it breaks:** skills that apply to many repos. A code review checklist ends up copied into ten repos, and the copies drift again. Some teams put shared skills in their own repo and pull it in as a git submodule. That works, but submodules come with their own friction, and you still can't easily tell which version each repo runs.

## Option 2: package skills as a Claude Code plugin

A Claude Code plugin bundles skills, and optionally hooks, agents and MCP configs, behind a `.claude-plugin/plugin.json` manifest. You publish plugins through a marketplace, which can be a git repo. Teammates add it with `claude plugin marketplace add <owner>/<repo>` and install a plugin by name ([Claude Code docs, create a marketplace](https://code.claude.com/docs/en/plugins/create-marketplace)).

**Good for:** Claude Code-only teams that want to ship a bundle, not just skills.

**Where it breaks:** it only works in Claude Code. Teammates on Codex or OpenCode get nothing from it. Plugin skills are namespaced (`/plugin-name:skill-name`), so anything that called the old name needs updating. And it's one more manifest and marketplace repo to maintain.

## Option 3: provision skills from claude.ai

On Claude Team and Enterprise plans, organization owners can upload a skill in organization settings, and it's provisioned to everyone in the organization. Provisioned skills also load in Claude Code for users who sign in with their Claude account ([Claude Help Center](https://support.claude.com/en/articles/13119606-provision-and-manage-skills-for-your-organization)).

**Good for:** companies already on a Claude Team or Enterprise plan that want admins to roll out approved skills.

**Where it breaks:** you need one of those plans, and an admin uploads each skill. It's tied to Claude accounts, so Codex and OpenCode users are left out. And a repo doesn't get a pinned version you can check in CI.

## Option 4: a versioned Skills Hub with a lockfile

What's missing above is something package managers solved for code years ago: one source of truth, numbered versions, and a lockfile in each repo that says exactly what's installed.

That's what [Skillpack](https://skillpack.app) does. It's an open-source Skills Hub built by The Vibe Company. Your organization has a shared library of `SKILL.md` packages. Every member can read and manage the organization's skills, and personal skills stay private to their creator. Each publication is an immutable version, so you can read a skill's history instead of guessing.

Skillpack installs the same skill for Claude Code, Codex and OpenCode.

[Sign up on Skillpack](https://skillpack.app/login) to set up a shared skills library for your team, then follow the steps below.

## Step by step: share a skill with Skillpack

### 1. Install the CLI and sign in

The CLI is a single native binary for macOS, Linux and Windows, not an npm package. Get the installer from the [GitHub releases](https://github.com/The-Vibe-Company/skillpack/releases), then approve it in your browser:

```sh
skillpack auth login
```

### 2. Validate and publish the skill to your organization

From the folder that holds the skill:

```sh
skillpack skills validate ./release-notes
skillpack skills publish ./release-notes --scope org
```

`validate` checks the package locally. `publish --scope org` uploads it to the organization library. The first publication is version 1.0.0. Later ones get the next version number unless you pass `--version`. Want to keep it private for now? Use `--scope personal`. You can share a personal skill with the organization later. That move is one-way, and only the skill's owner can make it.

Teammates can see what's available with `skillpack skills list`, and a skill's history with `skillpack skills versions release-notes`.

### 3. Install it into the repo

In each repo that should use the skill:

```sh
skillpack install release-notes --scope project --tools claude-code,codex,opencode
```

A project install writes the skill to `.agents/skills/`, adds a copy where each agent looks for skills (`.claude/skills/` for Claude Code), and records the skill in `.companion/skills.lock.json` with its version and checksum. No `CLAUDE.md` or `AGENTS.md` edit is needed.

Add `--dry-run` to see what would change first. To hold a skill at a version, use `--version 1.2.0` for an exact one, or `--pin` to pin the one you're installing. More install details: [How to install skills in Claude Code](/blog/how-to-install-skills-in-claude-code).

### 4. Commit the skills and the lockfile

Commit the installed skill folders and `.companion/skills.lock.json`. Then the skills are there after any fresh clone, cloud sessions included. Don't commit the temporary `.skillpack-stage-*` or `.skillpack-backup-*` files.

The lockfile is now the record. Anyone reviewing a pull request can see which skill changed, and to which version.

### 5. Check skills in CI with frozen sync

Teammates and CI run:

```sh
skillpack sync --frozen
```

Frozen sync checks the committed skills against the lockfile, offline. If a copy is missing, it restores it from another verified copy in the repo. If every copy is missing, it needs credentials for your organization to download the exact locked version. In CI, pass `SKILLPACK_API_KEY` through the runner's secret environment.

If someone edited a skill locally, frozen sync fails instead of quietly accepting it. It leaves the files and the lockfile alone, and it never rewrites the lockfile. That's the check you want. The skill CI runs is the one the team agreed on.

For a full CI setup with exit codes and a GitHub Actions example, see [how to check agent skills in CI](/blog/how-to-check-agent-skills-in-ci).

### 6. Ship updates through a pull request

When the author improves the skill, they publish again:

```sh
skillpack skills publish ./release-notes --scope org
```

In each repo, preview the update first, then apply it:

```sh
skillpack update --all --dry-run
skillpack update --all
```

Pinned skills stay put, and local edits are kept. Commit the updated skills and lockfile in a pull request. The diff shows which skills moved, so updates get reviewed like any dependency bump.

## Which option should you pick?

| | Copy-paste | Commit to repo | Claude Code plugin | claude.ai provisioning | Skillpack |
|---|---|---|---|---|---|
| Versions | None | Git history, per repo | Plugin version | Admin uploads | Immutable versions + lockfile |
| Works across repos | Manual | Copy per repo | Yes | Yes | Yes |
| Claude Code | Yes | Yes | Yes | Yes, signed-in users | Yes |
| Codex / OpenCode | Manual | Manual copies | No | No | Yes |
| Lockfile check in CI | No | No | No | No | `skillpack sync --frozen` |
| Needs | Nothing | Nothing | Marketplace repo | Claude Team or Enterprise | Skillpack account |

A simple rule:

- **One repo, Claude Code only:** commit skills to `.claude/skills/`. It's free and it works.
- **Claude Code only, many repos, plus hooks or MCP configs:** a plugin marketplace.
- **Already on Claude Team or Enterprise and admin-driven:** claude.ai provisioning.
- **Skills shared across repos, agents and CI, with versions you can review:** a Skills Hub like Skillpack.

You can mix them. Personal skills in `~/.claude/skills/` still work next to project skills.

## What to share first

Start with the instructions people already repeat in code review or in Slack:

- **Code review checklist:** what your team actually checks for.
- **Release notes or changelog format.**
- **Commit and branch conventions.**
- **Test conventions:** framework, naming, what counts as covered.
- **Runbooks:** migrations, incident write-ups, deploy steps.

If you keep pasting the same instructions into prompts, that's a skill waiting to be written. If it also needs live access to a system, like your issue tracker, pair it with an MCP server. See [Agent Skills vs MCP](/blog/agent-skills-vs-mcp).

## FAQ

**Can I share a skill without any tool?** Yes. Commit it to `.claude/skills/` in the repo. For a skill that belongs to one repo, that's the right call.

**Do personal skills work in Claude Code cloud sessions?** Not from `~/.claude/skills/` on your machine, per Claude Code's docs. Commit the skill to the repo's `.claude/skills/`, or enable it on your claude.ai account.

**What file should I commit with Skillpack?** The installed skill folders and `.companion/skills.lock.json`.

**Does Skillpack work with Codex and OpenCode?** Yes. `--tools claude-code,codex,opencode` installs the same skill for all three.

**What happens if someone edits a shared skill locally?** `skillpack sync --frozen` reports the drift and fails, without touching the files or the lockfile. `skillpack update` preserves local edits instead of overwriting them.

## Get started

Done pasting skills into Slack? [Sign up on Skillpack](https://skillpack.app/login), publish your first skill to your organization, and install it in Claude Code, Codex and OpenCode with one command.
