---
title: "How to Install Skills in Claude Code: 4 Methods Tested"
description: "Install skills in Claude Code by hand, with the Skillpack CLI, a Claude Code plugin or skills.sh. Tested on 2.1.322: what each writes and what loads."
slug: how-to-install-skills-in-claude-code
date: 2026-10-13
tags: ["Claude Code", "Agent Skills", "Skillpack CLI"]
author: "Stan Girard"
authorRole: "co-founder of The Vibe Company, which builds Skillpack"
---

# How to install skills in Claude Code: 4 methods, tested

To install skills in Claude Code, put a folder that holds a `SKILL.md` file where Claude Code looks: `~/.claude/skills/<skill-name>/` for you, or `.claude/skills/<skill-name>/` in a repo for everyone who clones it ([What is SKILL.md?](/blog/what-is-skill-md)). You can copy the folder by hand, or let a tool do it: the Skillpack CLI, a Claude Code plugin or skills.sh.

A test on November 10, 2026 ran all four methods on Linux with Claude Code 2.1.322, Skillpack CLI 0.3.5 and skills.sh 1.7.6. Three traps stood out. A folder nested one level too deep didn't show up in the skill list, and the run printed no warning. A personal copy beats the project copy of the same skill. Cloud sessions don't read `~/.claude/skills` at all.

Disclosure: the author's company, The Vibe Company, builds Skillpack. Skillpack is an open-source Skills Hub, and its CLI is one of the four methods below.

## Each install method leaves a different trace

The November 10 run used an isolated home folder, an empty git project and skills from `anthropics/skills` at commit `2c5958ec`. Each method installed a skill. Claude Code then listed what it loaded.

| Method | Command | Writes | Version trace | Loaded by Claude Code 2.1.322 |
|---|---|---|---|---|
| Copy by hand | `cp -r skills/pdf ~/.claude/skills/pdf` | `~/.claude/skills/pdf/` | None | Yes, `pdf` |
| Skillpack CLI 0.3.5 | `skillpack install github:anthropics/skills/skills/frontend-design --scope project --tools claude-code --yes` | `.agents/skills/frontend-design/`, `.claude/skills/frontend-design/`, `.companion/skills.lock.json` | `lockfileVersion` 3, commit `2c5958ec`, a sha256 checksum per target | Yes, `frontend-design` |
| Plugin marketplace | `claude plugin marketplace add anthropics/skills`, then `claude plugin install document-skills@anthropic-agent-skills` | `~/.claude/plugins/cache/anthropic-agent-skills/document-skills/2c5958ecac7c/`, `enabledPlugins` in `~/.claude/settings.json` | `gitCommitSha` in `installed_plugins.json` | Yes, `document-skills:pdf`, `:docx`, `:pptx`, `:xlsx` |
| skills.sh 1.7.6 | `npx skills add anthropics/skills --skill frontend-design -a claude-code -y` | `.claude/skills/frontend-design/` (copy), `skills-lock.json` | `source`, `skillPath`, `computedHash`, no commit field | Not checked in a session |

Only the Skillpack CLI and the plugin recorded the exact commit they installed. A copy by hand keeps no record of the version.

## Claude Code reads two skill folders, and the personal one wins

![Where Claude Code finds skills: the personal folder beats the project folder, and three traps. Detailed below.](/images/blog/how-to-install-skills-in-claude-code/claude-code-skill-folders-map.png)

Claude Code loads skills from a personal folder and a project folder:

| Scope | Folder | Who gets it |
|---|---|---|
| Personal | `~/.claude/skills/<skill-name>/` | You, in all your projects on this machine, but not in Cowork or cloud sessions |
| Project | `.claude/skills/<skill-name>/` | Everyone who clones the repo |

Source: [Claude Code docs, Agent Skills](https://code.claude.com/docs/en/skills).

When both folders hold a skill with the same name, the personal copy runs. The docs put it as "personal over project": with `deploy` in both places, `/deploy` runs the personal one. The test confirmed it. A personal `frontend-design` copy with a marked description took over from the project copy that the Skillpack CLI had installed. So a teammate with an old copy in `~/.claude/skills/` keeps running that one, whatever the repo holds.

Plugin skills don't collide. They load as `/plugin-name:skill-name`, so `pdf` and `document-skills:pdf` showed up side by side in the test.

The personal folder stays on your machine. If a cloud scheduled task invokes a skill that exists only in `~/.claude/skills/` on your machine, the docs say "Claude Code reports that the skill was not found". For those sessions, enable the skill on your claude.ai account. Committing it to the repo's `.claude/skills/` also works, except in cloud project threads.

If you sign in with a claude.ai account, Claude Code downloads the skills enabled there into `~/.claude/skills/synced/`. The docs list Claude Code v2.1.273 or later for this. The [changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md) files it under 2.1.275, with an opt-out: `syncClaudeAiSkills: false`. Edit those skills on claude.ai, because a later sync can overwrite or remove local changes. And never name one of your own folders `synced`.

## Method 1: install skills in Claude Code by hand

A manual install is one copy, plus two checks.

1. **Get the skill folder.** Clone its repository, or download and unzip it.
2. **Check the name.** Keep the folder name equal to the `name` in `SKILL.md`. The [Agent Skills specification](https://agentskills.io/specification) requires it ("Must match the parent directory name"). In Claude Code, that name becomes the `/command` you type.
3. **Copy it.** Put it in `~/.claude/skills/` for yourself, or in `.claude/skills/` at the root of the repo for the team. This command ran from a clone of [anthropics/skills](https://github.com/anthropics/skills) on November 10:

   ```sh
   cp -r skills/pdf ~/.claude/skills/pdf
   ```

4. **Check the depth.** `SKILL.md` must sit directly inside the skill folder. On November 10, `~/.claude/skills/webapp-testing-main/webapp-testing/SKILL.md` didn't appear in the skill list of a `-p` run. Nothing reached stderr either. Moving `webapp-testing/` up one level gives the path the docs expect: `~/.claude/skills/<skill-name>/SKILL.md`.
5. **Use it.** Claude Code picks up the new skill in the current session, with no restart. Automatic hot reload arrived in Claude Code 2.1.0. One exception: if the `skills` folder didn't exist when the session started, run `/reload-skills`. Then run it again after each later change there, since Claude Code isn't watching that folder yet. Live change detection covers `SKILL.md` text only.

## Method 2: the Skillpack CLI records the exact commit

The Skillpack CLI is a native binary. Don't look for it on npm: the package named [skillpack](https://www.npmjs.com/package/skillpack) there (version 0.1.3 on November 10, 2026) belongs to another project, "Package manager for skills.sh". The [GitHub releases](https://github.com/The-Vibe-Company/skillpack/releases) carry `install.sh` for macOS and Linux and `install.ps1` for Windows. The test ran on Linux only. The general form installs a skill for the current project and targets Claude Code:

```sh
skillpack install <slug> --scope project --tools claude-code
```

The test installed Anthropic's `frontend-design` skill from GitHub this way:

```sh
skillpack install github:anthropics/skills/skills/frontend-design --scope project --tools claude-code --yes
```

The CLI wrote the skill to `.agents/skills/frontend-design/`, the shared project copy, and to `.claude/skills/frontend-design/`. The lockfile `.companion/skills.lock.json` got commit `2c5958ec` and a sha256 checksum for each target. Claude Code then loaded `frontend-design`.

Leave out `--yes` in a non-interactive shell and the install stops with exit code 2:

```text
third-party skill requires confirmation; inspect the source and use --yes in CI or non-interactive mode
```

Per the [CLI docs](https://github.com/The-Vibe-Company/skillpack/blob/main/docs/skillpack-cli.md), `--yes` accepts without prompting and keeps the warning. CI, redirected input and `--json` all require it for install and update.

The flags worth knowing:

- `--scope` defaults to `user`. For Claude Code, that means `~/.claude/skills/`.
- `--dry-run` shows every target without writing anything. Run it first.
- For a GitHub source, pin with a ref: a branch, a tag or a full commit SHA, either as a suffix (`github:acme/skills/review@v1.2`) or with `--ref feature/review`. The docs say "Use refs instead of `--version`."
- For a registry skill, an exact `--version` pins it, and `--pin` pins the current version.
- `--tools claude-code,codex,opencode` installs the same skill for Claude Code, Codex and OpenCode in one go, plus the shared `.agents/skills` copy.

The CLI docs add one caveat: "pinning ensures reproducibility, not safety".

## Method 3: install a Claude Code plugin from a marketplace

The `document-skills` plugin from the `anthropics/skills` marketplace bundles four skills. Two commands install it:

```sh
claude plugin marketplace add anthropics/skills
claude plugin install document-skills@anthropic-agent-skills
```

The install printed "✔ Successfully installed plugin: document-skills@anthropic-agent-skills (scope: user)". The files went to `~/.claude/plugins/cache/anthropic-agent-skills/document-skills/2c5958ecac7c/`. Claude Code added `enabledPlugins` to `~/.claude/settings.json` and kept the commit as `gitCommitSha` in `installed_plugins.json`. It then loaded `document-skills:pdf`, `:docx`, `:pptx` and `:xlsx`.

Plugins install at user scope by default. Pass `--scope project` or `--scope local` to change it. Project scope has a catch for teams. It writes an entry to `.claude/settings.json`, and per the [plugin docs](https://code.claude.com/docs/en/discover-plugins), committing that entry "turns the plugin on for your collaborators but doesn’t download it to their machines". Each teammate still runs this once per clone:

```sh
claude plugin install <name>@<marketplace> --scope project
```

A skill folder committed under `.claude/skills/` needs no such step.

## Method 4: skills.sh copies the folder into .claude/skills

skills.sh 1.7.6 installed the same `frontend-design` skill with one `npx` command:

```sh
npx skills add anthropics/skills --skill frontend-design -a claude-code -y
```

It printed "✓ frontend-design (copied) → ./.claude/skills/frontend-design". It also wrote a `skills-lock.json` with `source`, `sourceType`, `skillPath` and `computedHash`. That lockfile has no commit field. The November 10 run didn't check whether Claude Code loaded this copy in a session. Treat that part as unverified.

## Check that Claude Code loaded the skill

Claude Code reads each skill's name and description, and loads the full skill only when a task matches. In an interactive session, the `/skills` menu lists the loaded skills. For a scripted check, read the `skills` field of the `system/init` event from a one-turn non-interactive run, as on November 10:

```sh
claude -p "Reply with the single word: ok" --output-format stream-json --verbose --max-turns 1
```

Each loaded skill shows up in that list by name, like `pdf` or `document-skills:pdf`. You can also call a skill directly: type `/` and its name.

## Keep team skills in sync with the lockfile

Commit `.companion/skills.lock.json`. Then each teammate, or CI, runs:

```sh
skillpack sync --frozen
```

`sync --frozen` checks installed skills against the lockfile and restores missing copies: after a deleted `.claude/skills/frontend-design`, it reported `restored: 1`. A local edit stops it with exit code 9 ("locked package drift; files and lockfile preserved"), and the edit stays in place. `skillpack doctor`, which checks setup and connectivity, then listed that copy as `"status": "modified"`.

To move to newer versions, preview first:

```sh
skillpack update --all --dry-run
skillpack update --all
```

Sharing skills across several repos? See [How to share Claude Code skills with your team](/blog/how-to-share-claude-code-skills-with-your-team). Using Codex too? [Codex skills: how to install, use and create them](/blog/how-to-use-skills-in-codex) covers how one install serves both agents. For skills to start with, see [the best Claude Code skills for video and motion design](/blog/best-claude-code-skills-video-motion-design) and [the best Claude Code skills for testing](/blog/best-claude-code-skills-testing).

## Troubleshoot a skill that doesn't load

- **Not in the skill list.** Check that the path is `.claude/skills/<name>/SKILL.md`, with no folder in between.
- **Folder created mid-session.** Run `/reload-skills`, and again after each change there.
- **The wrong copy runs.** Look for a personal copy with the same name in `~/.claude/skills/`.
- **Claude ignores the skill.** Claude matches on the `description` in the frontmatter. Make it say when to use the skill.
- **A cloud task says "not found".** Enable the skill on claude.ai, or commit it to the repo (not for cloud project threads).
- **Setup looks off.** Run `skillpack doctor`.

More causes: [Claude Code skills not working? 8 causes and fixes](/blog/claude-code-skills-not-working).

## FAQ

```faq
items:
  - question: "Where do Claude Code skills go?"
    answer: "In `~/.claude/skills/<skill-name>/` for you, in all your projects on this machine but not in Cowork or cloud sessions. Or in `.claude/skills/<skill-name>/` for everyone who clones the repo. `SKILL.md` must sit directly inside the skill folder."
  - question: "Do I need to restart Claude Code after installing a skill?"
    answer: "No. Claude Code picks up the new skill in the current session. If the `skills` folder didn't exist when the session started, run `/reload-skills`, and run it again after each later change there."
  - question: "What does skillpack install write?"
    answer: "With `--scope project --tools claude-code` on Skillpack CLI 0.3.5, it writes the skill to the shared project copy under `.agents/skills/` and to `.claude/skills/`. It records the skill in `.companion/skills.lock.json` with its version and a sha256 checksum; for a GitHub source, that version is the exact commit. `--scope` defaults to `user`, and `--dry-run` lists every target first."
  - question: "Can I install a specific version of a skill?"
    answer: "Yes. For a registry skill, an exact `--version` pins it and `--pin` pins the current version. For a GitHub source, use a ref: a branch, a tag or a full commit SHA. Add `--dry-run` to see what would change without writing anything."
  - question: "How do teammates get the same skills?"
    answer: "Commit `.companion/skills.lock.json`, then have them (or CI) run `skillpack sync --frozen`. It restores missing copies. A local edit makes it stop with exit code 9, with files and lockfile left as they are."
  - question: "Do plugin skills clash with skills in ~/.claude/skills?"
    answer: "No. Plugin skills load as `/plugin-name:skill-name`, so both load. Between a personal and a project skill with the same name, the personal one runs."
  - question: "Can I edit skills synced from claude.ai?"
    answer: "Edit them on claude.ai. Claude Code downloads them into `~/.claude/skills/synced/`, and a later sync can overwrite or remove local edits."
```

## Sign up to share skills with your team

[Sign up on Skillpack](/login) to install, version and share skills with your team.
