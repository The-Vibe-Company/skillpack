---
title: "GitHub Copilot Skills: How to Add One in 5 Minutes"
description: "GitHub Copilot skills are SKILL.md folders Copilot loads when a task matches. Where to put them, how to call one, and how to install a stranger's skill safely."
slug: github-copilot-skills
date: 2026-11-23
tags: ["GitHub Copilot", "Agent Skills", "SKILL.md", "Copilot CLI", "VS Code"]
author: "Stan Girard"
authorRole: "co-founder of The Vibe Company, which builds Skillpack"
---

# GitHub Copilot skills: add one in 5 minutes, no ceremony

Your friend with Claude Code keeps saying "I made a skill for that." You use Copilot. Good news: you can do the exact same thing.

A GitHub Copilot skill is a folder with a `SKILL.md` file inside. Put it in `.github/skills/` in your repo, or in `~/.copilot/skills/` for every project. Copilot reads the description, and when your request matches, it loads the instructions. You can also call it by name with a slash. It works in the Copilot CLI, the Copilot app, agent mode in VS Code, and the cloud agent and code review on GitHub.com, according to [GitHub's docs](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills).

That's the whole idea. Here's the 5-minute version.

Disclosure: Skillpack, the site you're reading, publishes and installs `SKILL.md` packages. The commands below come from the GitHub and VS Code docs as they stood on November 23, 2026.

## Where do Copilot skills live?

In one of two places, depending on who should get the skill.

- **Project skills**, shared with everyone who clones the repo: `.github/skills/`, `.claude/skills/` or `.agents/skills/`.
- **Personal skills**, just for you, in every project: `~/.copilot/skills/` or `~/.agents/skills/`.

Each skill gets its own subfolder, named in lowercase with hyphens. So the path looks like `.github/skills/release-notes/SKILL.md`. The file must be called `SKILL.md`. Not `skill.md`. Not `instructions.md`. Copilot is picky here, and honestly, fair.

## What goes in your first Copilot skill?

Make the folder, then the file. The frontmatter needs two fields: `name` and `description`.

```markdown
---
name: release-notes
description: Write release notes from merged pull requests. Use when asked for release notes or a changelog.
---

1. List the pull requests merged since the last tag.
2. Group them under Features, Fixes and Chores.
3. Write one plain sentence per change. No marketing words.
4. End with a "Thanks" line naming the authors.
```

The `name` should match the folder name. The `description` is the important bit, because that's what Copilot reads to decide whether your skill fits the task. Write it like a bouncer's guest list: what the skill does, and when to let it in.

Need a script? Drop it in the same folder and tell the skill when to run it. Copilot makes every file in the skill's folder available alongside the instructions.

## How do you call a skill in Copilot?

Two ways. Let Copilot pick it on its own when your request matches the description. Or name it yourself with a slash:

```text
Use the /release-notes skill for everything merged this week.
```

In the Copilot CLI, a few commands save you from guessing:

- `/skills list` shows what's available.
- `/skills reload` picks up a skill you just added, no restart.
- `/skills info release-notes` tells you where the skill lives.

Prefer the terminal? `copilot skill list` does the same outside a session.

In VS Code, type `/` in chat and your skills show up next to your prompts. Two frontmatter switches control that menu. `disable-model-invocation: true` means "only when I ask." `user-invocable: false` hides it from the slash menu and leaves it to Copilot.

## Can you install a stranger's skill without regrets?

GitHub CLI now has a `gh skill` command, in public preview, for GitHub CLI 2.90.0 or later. It searches, previews, installs and updates skills straight from GitHub repos.

```shell
gh skill search changelog
gh skill preview github/awesome-copilot documentation-writer
gh skill install github/awesome-copilot documentation-writer
```

Do not skip the `preview` line. GitHub says it plainly: skills are not verified by GitHub and may contain prompt injections or malicious scripts. `preview` shows you the `SKILL.md` and its files before anything lands on your disk. Reading a skill takes a minute. Cleaning up after a sketchy one takes your afternoon.

Two more habits worth stealing:

- Want a version that never moves? Add `--pin` with a tag or commit, and `gh skill update` will leave it alone.
- Be stingy with `allowed-tools: shell` in the frontmatter. It lets the skill run terminal commands without asking you first. GitHub's own warning: only do it for skills you've read and fully trust.

## Do your Claude Code skills work in Copilot?

Mostly, yes. Copilot reads `.claude/skills/` in your repo, so a project skill written for Claude Code shows up without moving anything. It's the same open `SKILL.md` format from [agentskills.io](https://agentskills.io). Personal skills are the catch. GitHub's docs list `~/.copilot/skills/` and `~/.agents/skills/` for those, so a skill that only lives in `~/.claude/skills/` may need a copy.

Same story in other tools. [Cursor](/blog/how-to-use-skills-in-cursor) and [Codex](/blog/how-to-use-skills-in-codex) read the shared format too, each with its own folders. If you want the field-by-field version, there's a full guide to [the SKILL.md format](/blog/what-is-skill-md).

Bonus for reviewers: Copilot code review on GitHub.com can use skills in `.github/skills/` when they're relevant. GitHub suggests a review-flavored folder name like `code-review` if you want it picked up reliably.

## Skill or custom instructions?

Copilot also has custom instructions, like `.github/copilot-instructions.md`. GitHub's docs suggest an easy split. Instructions for things that apply to almost every task, like "use tabs" or "tests live in `/spec`". Skills for detailed workflows that matter some of the time, like release notes or debugging a failing GitHub Actions run.

Instructions are always in the room. Skills walk in when they're needed. That keeps Copilot's context light and your skill files short.

## Your 5-minute plan

1. Create `.github/skills/release-notes/SKILL.md`.
2. Paste the example above and tweak the steps to how your team actually works.
3. Open the Copilot CLI and run `/skills list`, or type `/` in VS Code chat.
4. Ask for this week's release notes and watch it go.

If the skill never shows up, check the folder name, the exact file name and the frontmatter first. The usual suspects are covered in [why skills don't load](/blog/claude-code-skills-not-working). And when you want a starter pack of ready-made skills, the guide to [installing skills in Claude Code](/blog/how-to-install-skills-in-claude-code) walks through four ways to get them. The skills are plain `SKILL.md` folders, so they're not locked to one tool.

```faq
items:
  - question: "Where do I put GitHub Copilot skills?"
    answer: "Project skills go in `.github/skills/`, `.claude/skills/` or `.agents/skills/` in your repository. Personal skills go in `~/.copilot/skills/` or `~/.agents/skills/`. Each skill is its own folder with a `SKILL.md` file inside."
  - question: "How do I use a skill in GitHub Copilot?"
    answer: "Copilot loads a skill on its own when your request matches its description. You can also call it by name with a slash, for example \"Use the /release-notes skill\". In the Copilot CLI, `/skills list` shows what's available."
  - question: "Do Claude Code skills work with GitHub Copilot?"
    answer: "Project skills do. Copilot reads `.claude/skills/` in your repository, and both tools use the same SKILL.md format. Personal skills need to live in `~/.copilot/skills/` or `~/.agents/skills/` for Copilot to see them."
```
