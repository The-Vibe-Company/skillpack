---
title: "How to Install Skills in Claude Code (Manual and CLI)"
description: "Install Agent Skills in Claude Code by hand or with the Skillpack CLI: where SKILL.md folders go, user vs project scope, and how to pin versions for your team."
slug: how-to-install-skills-in-claude-code
date: 2026-10-13
tags: ["Claude Code", "Agent Skills", "Skillpack CLI"]
---

# How to install skills in Claude Code

A Claude Code skill is a folder with a `SKILL.md` file in it (see [What is SKILL.md?](/blog/what-is-skill-md)). Installing one just means putting that folder where Claude Code looks. There are two places it can go, and two ways to get it there.

## Where Claude Code looks for skills

| Scope | Folder | Who gets it |
|---|---|---|
| User | `~/.claude/skills/<skill-name>/` | You, in every project |
| Project | `.claude/skills/<skill-name>/` | Everyone who clones the repo |

Source: [Claude Code docs, Agent Skills](https://code.claude.com/docs/en/skills).

## Option 1: install a skill by hand

1. Get the skill folder (clone it, or download and unzip it).
2. Copy it into `~/.claude/skills/` for yourself, or into `.claude/skills/` at the root of the repo for the team.
3. Check that `SKILL.md` sits directly inside the skill folder, not one level deeper.
4. Claude Code picks up the new skill in the current session, no restart needed. If the `skills` folder didn't exist when the session started, run `/reload-skills` once. Claude reads each skill's name and description and loads the full skill only when a task matches.

That's fine for one skill. It gets messy with ten skills, a few machines and teammates on different versions. And there's no record of which version you copied.

## Option 2: install with the Skillpack CLI

Skillpack is an open-source Skills Hub. Its CLI is a single native binary. It's not an npm package. The macOS and Linux installers are on [GitHub releases](https://github.com/The-Vibe-Company/skillpack/releases).

To install a skill for the current project, Claude Code only:

```sh
skillpack install <slug> --scope project --tools claude-code
```

This writes the skill into `.claude/skills/` and records it in `.companion/skills.lock.json` with its version and a sha256 checksum. Want it in `~/.claude/skills/` instead? Use `--scope user`.

A few useful flags:

- `--version 1.2.3` installs a specific version. `--pin` keeps it there.
- `--dry-run` shows what would change without writing anything.
- `--tools claude-code,codex,opencode` installs the same skill for Claude Code, Codex and OpenCode in one go.

## Keep the team in sync

Commit `.companion/skills.lock.json`. Then a teammate (or CI) runs:

```sh
skillpack sync --frozen
```

It checks installed skills against the lockfile and restores missing copies. If someone edited a skill locally, it fails instead of overwriting the change. Sharing skills across several repos? See [How to share Claude Code skills with your team](/blog/how-to-share-claude-code-skills-with-your-team). To move to newer versions:

```sh
skillpack update --all --dry-run
skillpack update --all
```

Using Codex too? [Codex skills: how to install, use and create them](/blog/how-to-use-skills-in-codex) covers where Codex looks for skills and how one install serves both agents. Looking for skills to start with? See [the best Claude Code skills for video and motion design](/blog/best-claude-code-skills-video-motion-design). For testing, see [the best Claude Code skills for testing](/blog/best-claude-code-skills-testing).

## Troubleshooting

- Claude doesn't use the skill: Claude matches on the `description` in the frontmatter. Make it say when to use the skill.
- Skill not found: check the path is `.claude/skills/<name>/SKILL.md`. If you created the `skills` folder after the session started, run `/reload-skills`.
- Something's off with the setup: run `skillpack doctor`. It checks setup and connectivity.

## Get started

Browse skills and [sign up on Skillpack](https://skillpack.app/login) to install, version and share them with your team.
