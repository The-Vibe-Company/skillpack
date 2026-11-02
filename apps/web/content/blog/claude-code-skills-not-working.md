---
title: "Claude Code Skills Not Working? 8 Causes and Fixes"
description: "Claude Code skill not loading or never triggering? Check the folder, scope, SKILL.md frontmatter, description, duplicates and Codex or Cursor paths."
slug: claude-code-skills-not-working
date: 2026-11-02
tags: ["Claude Code", "Agent Skills", "Troubleshooting", "Codex", "Cursor", "Skillpack CLI"]
author: "Stan Girard"
authorRole: "co-founder of The Vibe Company, which builds Skillpack"
---

# Claude Code skills not working? 8 causes and how to fix each

You wrote or installed a skill, and Claude Code ignores it. Either it never shows up, or it shows up and Claude never uses it. Those are two different problems. Most of the time, one of eight causes is behind it.

How we checked: the loading rules for Claude Code, Codex and Cursor come from their official docs, read on November 2, 2026. The commands and exit codes come from Skillpack CLI 0.3.5, run the same day in a scratch repo. We didn't run Claude Code, Codex or Cursor for this guide, so anything we say about how they behave comes from their docs rather than from our own runs.

```takeaways
title: Key Takeaways
items:
  - lead: "Split the problem first"
    text: "Not in /skills means it didn't load: check folder, file name, frontmatter. Listed but never used means check the description and invocation settings."
  - lead: "Frontmatter starts on line 1"
    text: "Broken YAML still loads the skill, but with no description for Claude to match."
  - lead: "Personal beats project"
    text: "With the same name in ~/.claude/skills and .claude/skills, Claude Code runs the personal copy."
  - lead: "Each tool reads its own folders"
    text: "Claude Code reads .claude/skills, Codex reads .agents/skills, Cursor reads both and more."
```

## First, find out which problem you have

Start Claude Code in the repo and run these checks in order, all from the [Claude Code skills docs](https://code.claude.com/docs/en/skills) and the [debug guide](https://code.claude.com/docs/en/debug-your-config).

1. Type `/skills`. It lists the skills Claude Code found from project, user and plugin sources.
2. Ask "What skills are available?" and see if yours is named.
3. Type `/your-skill-name`. If that works, the skill loaded fine and the problem is matching.
4. Run `/context` to see what sits in the context window, including the skill listing.
5. Restart with `claude --debug` and read the debug log for parse errors or refused names.

| What you see | Likely cause | Go to |
| :- | :- | :- |
| Not in `/skills`, `/name` unknown | Wrong folder, file name, or refused name | Causes 1 and 3 |
| `/name` works, Claude never picks it alone | Frontmatter didn't parse, or vague description | Causes 2 and 4 |
| Listed with a "user-only" badge | Model invocation is off | Cause 5 |
| A different version of the skill runs | Duplicate in another scope | Cause 6 |
| Works in Claude Code, not in Codex or Cursor | Tool-specific folders | Cause 7 |
| You just added it and nothing changed | Session didn't reload | Cause 8 |

## Cause 1: the skill is in the wrong folder

Claude Code loads a skill from a folder that contains a file named `SKILL.md`. The [debug guide](https://code.claude.com/docs/en/debug-your-config) lists a flat file as the classic mistake: `.claude/skills/deploy.md` doesn't show up, `.claude/skills/deploy/SKILL.md` does.

The locations Claude Code reads:

| Scope | Path |
| :- | :- |
| Personal | `~/.claude/skills/<skill-name>/SKILL.md` |
| Project | `.claude/skills/<skill-name>/SKILL.md` |
| Nested | `<subdir>/.claude/skills/<skill-name>/SKILL.md` |
| Plugin | `<plugin>/skills/<skill-name>/SKILL.md`, run as `/plugin-name:skill-name` |

Four common traps:

- **The file name.** We tested a folder with a lowercase `skill.md`. `skillpack skills validate` rejected it with `SKILL.md is missing or oversized` (exit 5). Use the exact name `SKILL.md`.
- **One level too deep.** Unzipping often gives `.claude/skills/deploy/deploy/SKILL.md`. `SKILL.md` must sit directly in the skill folder.
- **Subdirectories load late.** Claude Code reads `.claude/skills/` in the start directory and every parent up to the repo root. A `.claude/skills/` folder below where you started only loads once Claude reads or edits a file in that subdirectory. Run `/add-dir` with its path to load it sooner (v2.1.257 or later, per the docs).
- **`.agents/skills` is not a Claude Code location.** Codex and Cursor read it; Claude Code's docs don't list it.

New to the format? [What is SKILL.md?](/blog/what-is-skill-md) covers the folder layout.

## Cause 2: the frontmatter doesn't parse

This one's easy to miss because the skill still loads. Per the Claude Code docs, if the YAML doesn't parse, the body loads with empty metadata. `/skill-name` works, but Claude has no description to match, so it never picks the skill on its own.

Two rules from the docs:

- The frontmatter is only read when the opening `---` is the very first line. A blank line before it turns the whole file, markers included, into plain skill content.
- Field names must match exactly. Claude Code silently ignores a field it doesn't recognize, so `disable_model_invocation` (underscores) does nothing.

The most common YAML error is a colon inside an unquoted value. `description: Use when: the user asks about deploys` is not valid YAML. Wrap the value in quotes.

You can catch most of this before Claude Code sees the file. We broke skill folders on purpose and ran `skillpack skills validate ./<folder> --json` on each:

| What we broke | Message | Exit code |
| :- | :- | :- |
| No frontmatter at all | `SKILL.md needs YAML frontmatter` | 5 |
| Blank line before the opening `---` | `SKILL.md needs YAML frontmatter` | 5 |
| Unclosed quote in `description` | `invalid YAML frontmatter` | 5 |
| Unquoted colon in `description` | `invalid YAML frontmatter` | 5 |
| No `description` | `invalid skill name or description` | 5 |
| `description` of 1,025 characters | `invalid skill name or description` | 5 |
| Valid skill | `valid: true` | 0 |

A 1,024-character description passed. Claude Code has its own command for this, `claude plugin validate .claude/skills`, which the docs say finds `SKILL.md` files whose frontmatter doesn't parse (v2.1.233 or later). We didn't run it. To check skills on every pull request, see [how to check agent skills in CI](/blog/how-to-check-agent-skills-in-ci).

## Cause 3: the name is refused or doesn't match

The command name comes from the frontmatter `name`, or the folder name if there's none. Claude Code refuses some names, and the skill then doesn't load:

- A zero-width space, a control character or an icon-font glyph
- A no-break space, two spaces in a row, or a space at the start or end
- `<` or `>`
- A folder named `synced` or `anthropic-skills`, which are reserved for skills synced from claude.ai

The interactive session shows a startup notice when names were refused, and `claude --debug` logs them under `[names]`.

Other tools are stricter. Cursor's docs say `name` must be lowercase letters, numbers and hyphens, and must match the parent folder name. Codex requires both `name` and `description`. The Skillpack CLI rejected `name: Bad Name` and `name: Upper` (exit 5), but it accepted a skill named `other-name` in a folder called `mismatch` (exit 0). So a skill can pass validation and still break Cursor's rule. Keep the folder and the `name` identical and you avoid the question.

## Cause 4: the description is too vague

When a skill loads but never fires, this is usually why. Claude decides from each skill's name and description whether it fits the request, and only then loads the full `SKILL.md`.

A description like this almost never triggers:

```yaml
description: Helps with stuff.
```

This one works:

```yaml
description: Summarizes uncommitted git changes and flags risky edits. Use when the user asks what changed, wants a commit message, or asks to review their diff.
```

It says what the skill does, then when to use it, in phrases a person would type. The Claude Code docs say the same: use the keywords users naturally say. Codex's docs add: front-load the key use case, because descriptions get shortened.

Both tools shorten them:

- **Claude Code** caps each entry at 1,536 characters (description plus `when_to_use`). With many skills, the listing is trimmed to a budget of 1% of the context window, and the least-used skills lose their descriptions first. Run `/doctor` to see the listing's cost and `/skill-doctor` to find skills you never use.
- **Codex** keeps the initial skill list to 2% of the context window, or 8,000 characters if it doesn't know the window size. It shortens descriptions first and can drop skills from the list with a warning.

No validator judges wording: `skillpack skills validate` passed `Helps with stuff.` with exit 0. The real test is to ask for the task a few different ways and watch whether the skill fires. [How to create a Claude Code skill](/blog/how-to-create-a-claude-code-skill) walks through that loop.

Also check `paths`. If the frontmatter sets it, Claude Code only activates the skill for matching files inside its current working directory.

## Cause 5: invocation is switched off

Sometimes the skill is configured so it never fires on its own:

- **`disable-model-invocation: true`.** Claude can't invoke the skill, and its description isn't even in context. You have to type `/skill-name`. In `/skills` this shows as a "user-only" badge. That's the right setting for a deploy skill and the wrong one for a style guide.
- **`skillOverrides` in settings.** A value of `"user-invocable-only"` hides the skill from Claude, and `"off"` hides it everywhere. The `/skills` menu writes these to `.claude/settings.local.json` when you press Space on a skill, so a teammate can turn one off by accident.
- **Permission rules.** A deny rule such as `Skill(deploy *)` in your permission settings blocks that skill.

Codex has the same switch in `agents/openai.yaml`: `allow_implicit_invocation: false` stops implicit use, and `$skill-name` still works. If you're deciding which workflows should be manual, [Claude Code skills vs slash commands](/blog/claude-code-skills-vs-slash-commands) explains the trade-off.

## Cause 6: a duplicate wins

You edit the skill and Claude keeps following the old instructions. Usually another copy with the same name is winning. The Claude Code docs set the order:

| Same name in | Which one runs |
| :- | :- |
| Personal and project | Personal (`~/.claude/skills/`) |
| Enterprise and personal | Enterprise |
| A skill and `.claude/commands/` | The skill |
| A plugin and anything else | Both: the plugin one is `/plugin-name:skill-name` |
| Repo root and a nested folder | Both, the nested one as `/apps/web:deploy` |

So a project skill you're editing loses to an old copy in your home folder. Symlinks are safe: Claude Code loads a skill once even if several locations point at the same target.

Codex and Cursor handle duplicates their own way. Codex doesn't merge two skills with the same name, and both can show up in the selector. Cursor reads `.agents/skills`, `.cursor/skills`, `.claude/skills` and `.codex/skills`, so one skill copied into all of them is found several times. Its docs don't say how it handles that.

To list every copy on a machine, we ran `skillpack doctor` after installing the same skill at project scope and at user scope. It printed each copy with its path, its scope (`user` or `project`) and a status: `verified`, or `modified` for the copy we had edited by hand. Exit code 0. Running the same project install twice did not create a second folder: it reported the previous commit and kept one copy per target.

That `modified` copy is also why a reinstall can fail. After we added a line to `.claude/skills/webapp-testing/SKILL.md`, `skillpack install` stopped with `local customization detected; existing files preserved` (exit 9), even with `--force`. `skillpack sync --frozen` gave exit 9 too. Deleting the edited copy and running `skillpack sync --frozen` restored it from the shared copy (`restored: 1`, exit 0). If the edit was intentional, put it in the source skill and publish a new version instead.

```cta
title: "One version of each skill, everywhere"
text: "Create a free Skillpack workspace to publish your SKILL.md folders, install them into Claude Code and Codex with a lockfile, and see every copy with skillpack doctor."
primary: { label: "Create a free Skillpack workspace", href: /login }
secondary: { label: "How to install skills in Claude Code", href: /blog/how-to-install-skills-in-claude-code }
```

## Cause 7: Codex and Cursor read different folders

All three tools share the `SKILL.md` format, but each one reads its own folders.

| Tool | Project | Personal | Reload |
| :- | :- | :- | :- |
| Claude Code | `.claude/skills/` | `~/.claude/skills/` | Watches for changes |
| Codex | `.agents/skills/` from your directory up to the repo root | `~/.agents/skills/` | Detects changes; restart if an update doesn't show |
| Cursor | `.agents/skills/`, `.cursor/skills/`, plus `.claude/skills/` and `.codex/skills/` | `~/.agents/skills/`, `~/.cursor/skills/`, plus `~/.claude/skills/` and `~/.codex/skills/` | Discovers skills at startup |

A skill in `.claude/skills/` works in Claude Code and Cursor, not Codex. One in `.agents/skills/` works in Codex and Cursor, not Claude Code. More in [how to use skills in Codex](/blog/how-to-use-skills-in-codex) and [how to use skills in Cursor](/blog/how-to-use-skills-in-cursor).

Cursor Cloud Agents add one more trap: per Cursor's docs, they don't get `~/.agents/skills/` or unsynced local skills. Only `~/.cursor/skills/` syncs, and only once you turn that on.

Here's where Skillpack CLI 0.3.5 wrote files in our tests:

- `--scope project --tools claude-code,codex` (dry run): `.claude/skills/`, `.codex/skills/` and a shared copy in `.agents/skills/`, which is the folder Codex reads.
- `--scope project --tools claude-code`: `.claude/skills/` and `.agents/skills/`.
- `--scope user --tools claude-code,codex`: `~/.claude/skills/` and `~/.codex/skills/`.
- `--tools cursor`: exit 2, `unknown coding tool`. Cursor isn't a target in 0.3.5, but it reads the `.agents/skills/` and `.claude/skills/` copies anyway.

## Cause 8: the session hasn't picked up the change

Claude Code watches `~/.claude/skills/` and the project's `.claude/skills/`, and picks up added, edited or removed skills without a restart. Three exceptions, per the docs:

- If the top-level skills folder didn't exist when the session started, run `/reload-skills`.
- After renaming a skill in a folder Claude Code doesn't watch, restart the session.
- Bare mode doesn't watch skill folders at all.

Codex detects changes too, and its docs say to restart Codex if an update doesn't appear, and always after editing `~/.codex/config.toml`. Cursor's docs describe skill discovery at startup, so restart Cursor if a new skill doesn't show up under Customize, then Skills.

## A quick checklist

1. `SKILL.md`, exact name, directly inside a folder named after the skill.
2. The folder sits where the tool reads: `.claude/skills/` for Claude Code, `.agents/skills/` for Codex.
3. Frontmatter starts on line 1 and parses: `skillpack skills validate ./my-skill` exits 0.
4. `name` is lowercase with hyphens and matches the folder.
5. The description says what and when, in your team's words.
6. No `disable-model-invocation: true`, `skillOverrides` entry or deny rule you forgot.
7. No older copy in `~/.claude/skills/`: `skillpack doctor` lists every copy.
8. New folder or rename? `/reload-skills` or restart.

If your team keeps fixing the same skill on different laptops, a free [Skillpack workspace](/login) keeps one published version and installs it everywhere.

```faq
items:
  - question: "Why is my Claude Code skill not showing up in /skills?"
    answer: "Usually the path or the name. The skill must be a folder with a file named exactly SKILL.md, in ~/.claude/skills/ or the project's .claude/skills/. A flat .md file doesn't load. Run claude --debug to see refused names."
  - question: "Why does /skill-name work but Claude never uses the skill on its own?"
    answer: "Either the frontmatter didn't parse, so the skill has no description, or the description doesn't match how people ask. Also check for disable-model-invocation: true, shown as a user-only badge in /skills."
  - question: "Do I need to restart Claude Code after adding a skill?"
    answer: "Usually not. Claude Code watches its skill folders and picks up changes live. If the skills folder didn't exist when the session started, run /reload-skills."
  - question: "Which skill runs when the same name exists in my home folder and the project?"
    answer: "The personal one in ~/.claude/skills/. Claude Code ranks personal over project, so an old personal copy can hide the project skill you're editing."
  - question: "Why does my skill work in Claude Code but not in Codex?"
    answer: "Codex reads .agents/skills/ and ~/.agents/skills/, not .claude/skills/. Installing with skillpack install --tools claude-code,codex also writes a shared .agents/skills/ copy."
  - question: "How do I check a SKILL.md before Claude Code loads it?"
    answer: "Run skillpack skills validate on the folder. With CLI 0.3.5 it exited 5 on broken frontmatter, a missing description or an invalid name, and 0 on a valid skill. It doesn't judge whether the description is clear."
  - question: "Does Cursor load Claude Code skills?"
    answer: "Yes. Per Cursor's docs, it also loads .claude/skills/ and ~/.claude/skills/, along with .agents/skills/, .cursor/skills/ and the Codex folders."
```
