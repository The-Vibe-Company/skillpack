---
title: "Codex Skills Not Loading? Fix .agents/skills Path Issues"
description: "Codex skill not showing up? Check .agents/skills vs .codex/skills, ~/.agents/skills, duplicate names, the skills budget and disabled skills, step by step."
slug: codex-skills-not-working
date: 2026-11-06
tags: ["Codex", "Agent Skills", "Troubleshooting", "SKILL.md", "Skillpack CLI"]
author: "Stan Girard"
authorRole: "co-founder of The Vibe Company, which builds Skillpack"
---

# Codex skills not loading? How to debug .agents/skills and .codex/skills

You put a skill in a folder and Codex doesn't list it, or it lists the same skill twice. Most of the time the cause is a path. Codex reads `.agents/skills`, while older guides and some tools still write to `.codex/skills`. Below: how to find every copy, which ones Codex reads, and how to clean up duplicates.

How we checked: the loading rules come from the [official Codex skills docs](https://developers.openai.com/codex/skills), read on November 6, 2026. The install paths come from Skillpack CLI 0.3.5, run the same day in a scratch repo and a scratch home folder (`skillpack self update --dry-run` reported 0.3.5 as current). We didn't run Codex itself for this guide, so what we say about Codex behavior comes from its docs, not from our own runs.

```takeaways
title: Key Takeaways
items:
  - lead: "Codex reads .agents/skills"
    text: "In a repo, it scans .agents/skills from your working directory up to the repo root. Personal skills go in ~/.agents/skills."
  - lead: "The current docs don't list .codex/skills"
    text: "That folder only appears in the docs for config.toml. A skill that sits only in .codex/skills is not in the documented skill locations."
  - lead: "Duplicates are not merged"
    text: "Two skills with the same name can both appear in the selector. Find every copy before you edit one."
  - lead: "Skillpack CLI 0.3.5 writes both folders"
    text: "A project install for Codex writes .agents/skills and .codex/skills. A user-scope install writes only ~/.codex/skills."
```

## First, check what Codex sees

Open Codex in the repo and run these checks. They come from the [Codex docs](https://developers.openai.com/codex/skills).

1. Run `/skills` or type `$`. Both list the skills Codex found.
2. If your skill isn't there, restart Codex. The docs say Codex detects skill changes automatically, and to restart if an update doesn't appear.
3. If it's listed twice, you have a duplicate. Jump to the duplicates section.
4. If it's listed but Codex never picks it, the problem is the description or the invocation setting, not the path. [Claude Code skills not working](/blog/claude-code-skills-not-working) covers the description rules, and most of them apply to Codex too.

| What you see | Likely cause | Go to |
| :- | :- | :- |
| Not in `/skills` | Wrong folder, or launched from the wrong directory | Where Codex looks |
| Listed twice | Same name in two locations | Find the duplicates |
| Listed, but an old version runs | A second copy with the same name | Find the duplicates |
| Missing, with a warning about the list | Too many skills for the budget | The skills budget |
| Was there, now gone | Disabled in config.toml | Disabled skills |

## Where Codex looks for skills

For repositories, the docs say Codex scans `.agents/skills` in every directory from your current working directory up to the repository root. These are the documented locations:

| Scope | Location |
| :- | :- |
| Repo | `$CWD/.agents/skills` |
| Repo | `$CWD/../.agents/skills` (a folder above where you launched Codex, inside a Git repository) |
| Repo | `$REPO_ROOT/.agents/skills` |
| User | `$HOME/.agents/skills` |
| Admin | `/etc/codex/skills` |
| System | Bundled with Codex (`skill-creator` and `skill-installer`) |

What that means in practice:

- **Launch directory matters.** A `.agents/skills` folder in a sibling directory is not on the path from your working directory up to the repo root, so it's not scanned. Launch Codex from inside the folder tree that holds the skill, or move the skill to the repo root.
- **The folder is a skill folder, not a file.** Each skill is a directory with a `SKILL.md` that has a `name` and a `description`. [What is SKILL.md?](/blog/what-is-skill-md) shows the layout.
- **Symlinks work.** The docs say Codex supports symlinked skill folders and follows the target, so one real folder can be linked into several places.

## Why the `.codex/skills` folder confuses people

`~/.codex/skills` was the personal skills folder in earlier Codex versions. The pull request that added `~/.agents/skills` ([openai/codex#10437](https://github.com/openai/codex/pull/10437), merged on February 3, 2026) says it loads personal skills from `$HOME/.agents/skills` "in addition to" the project `.agents/skills`, and keeps backwards compatibility with `~/.codex/skills` "for now until we fully deprecate".

The current docs table doesn't list `~/.codex/skills` at all, and for a repo it lists only `.agents/skills`. In the docs, the `.codex` folder shows up for configuration: `~/.codex/config.toml`, and a project `.codex/config.toml`. We didn't test whether the current Codex build still reads `~/.codex/skills`, so treat it as legacy and move personal skills to `~/.agents/skills`. A project-level `.codex/skills` is not in the docs table, so don't rely on it.

The same folder question exists across tools. [Agent Skills open standard vs vendor folders](/blog/agent-skills-open-standard-vs-vendor-folders) compares what each tool reads.

## Where Skillpack CLI writes for Codex

Skillpack CLI 0.3.5, run on November 6, 2026 with `anthropics/skills/skills/webapp-testing` as the test skill. Each install exited 0.

| Command | Folders written |
| :- | :- |
| `install --scope project` (default tools) | `.agents/skills/`, `.codex/skills/`, `.claude/skills/` |
| `install --scope project --tools codex` | `.agents/skills/` and `.codex/skills/` |
| `install --scope user --tools codex` | `~/.codex/skills/` only |
| `install --scope project --tools opencode` | `.agents/skills/` only |
| `install --scope user --tools opencode` | `~/.agents/skills/` only |

So a project install for Codex gives you the folder Codex reads plus a second copy in `.codex/skills`, which the docs don't list. That second copy is the usual source of a duplicate name when you scan by hand. And a user-scope Codex install lands in the legacy folder, not in `~/.agents/skills`.

On a fresh project, the `--tools opencode` rows are the way to get only the shared `.agents/skills` folders. `skillpack install --tools claude-code` in a project also writes `.agents/skills` next to `.claude/skills`, and no `.codex/skills` (retested on November 6, 2026). We track the path question as a product issue.

## Find the duplicates

Codex doesn't merge two skills with the same `name`. Both can appear in the selector, so you can't tell which one you're editing. List every copy, with its name, in the places Codex or the CLI may have written to:

```bash
for d in .agents/skills/*/ .codex/skills/*/ ~/.agents/skills/*/ ~/.codex/skills/*/; do
  [ -f "$d/SKILL.md" ] && echo "$(awk '/^name:/{print $2; exit}' "$d/SKILL.md")  $d"
done | sort
```

Our scratch repo, after a default project install and a user-scope Codex install, printed the same name from three folders:

```text
webapp-testing  .agents/skills/webapp-testing/
webapp-testing  .codex/skills/webapp-testing/
webapp-testing  /home/me/.codex/skills/webapp-testing/
```

The script reads an unquoted `name:` line, so it won't match a name written as `name: "x"`. If you installed with Skillpack, `skillpack doctor` lists the same copies with their path, scope (`user` or `project`) and status, and exits 0. In our run it showed the user copy and both project copies as `verified`.

## Clean up without losing the skill

Deleting a Skillpack-installed copy by hand doesn't stick. We removed `.codex/skills/webapp-testing` and ran `skillpack sync --frozen`: it restored the folder (`restored: 1`, `targets: 2`, exit 0), because the lockfile still lists that target.

A cleanup order that held up in our tests:

1. Keep one source of truth. Pick `.agents/skills/` for the repo and `~/.agents/skills/` for your machine, since those are the documented Codex paths.
2. To drop a `.codex/skills` copy from a Skillpack project, delete the folder and also remove its `codex` target entry from `.companion/skills.lock.json`. In our test, that ended with `skillpack sync --frozen` reporting `targets: 1` and `restored: 0`, and no `.codex` folder came back. Reinstalling with `--tools opencode --force` did not remove the entry, so the folder was restored again. Editing the lockfile by hand is our workaround, not a documented step.
3. If you edited a copy by hand, the CLI refuses to overwrite it. In our earlier tests, `skillpack install` stopped with `local customization detected; existing files preserved` (exit 9) even with `--force`. Put the edit in the source skill and publish a new version instead.
4. Run `skillpack sync --frozen` and the script above again. Each name should appear once.

To catch drift in code review instead of by hand, see [how to check agent skills in CI](/blog/how-to-check-agent-skills-in-ci).

```cta
title: "One copy of each skill, in the folder each agent reads"
text: "Create a free Skillpack workspace to publish your SKILL.md folders, install them for Codex and Claude Code with a lockfile, and list every copy with skillpack doctor."
primary: { label: "Create a free Skillpack workspace", href: /login }
secondary: { label: "How to use skills in Codex", href: /blog/how-to-use-skills-in-codex }
```

## The skills budget

If the folder is right and the skill is still missing, check the budget. Per the docs, the initial skills list uses at most 2% of the model's context window, or 8,000 characters when the window size is unknown. Codex shortens descriptions first. For large skill sets, it may omit some skills from the list and show a warning.

You can raise the limit with `skills.max_context_tokens`, up to 10,000 tokens. The budget applies only to the initial list. Once Codex picks a skill, it reads the full `SKILL.md`. Put the use case and trigger words at the start of each description so it survives shortening.

## Disabled skills

Codex can switch a skill off without deleting it. In `~/.codex/config.toml`, a `[[skills.config]]` entry with `enabled = false` hides a skill:

```toml
[[skills.config]]
path = "/path/to/skill/SKILL.md"
enabled = false
```

An entry uses one selector: an absolute `path` matches one `SKILL.md`, a `name` matches every skill with that name. When several entries match, the last one wins. So a `name` entry meant for one copy can disable all of them. Restart Codex after editing the file.

Two other switches stop a skill from firing on its own. `allow_implicit_invocation: false` in the skill's `agents/openai.yaml` blocks implicit use, and `$skill-name` still works. And in a trusted project `.codex/config.toml`, `[skills.bundled] enabled = false` turns off the bundled system skills for that project.

## A quick checklist

1. Run `/skills`. Restart Codex if a new skill is missing.
2. The skill is a folder with `SKILL.md`, `name` and `description`.
3. It sits in `.agents/skills` between your working directory and the repo root, or in `~/.agents/skills`.
4. No copy in `.codex/skills` that you mistake for the real one.
5. Each `name` appears once: run the script or `skillpack doctor`.
6. No `[[skills.config]]` entry with `enabled = false`.
7. Too many skills? Shorten descriptions or raise `skills.max_context_tokens`.

Setting up Codex from scratch instead? [Codex skills: how to install, use and create them](/blog/how-to-use-skills-in-codex) starts there. To keep one version across laptops, a free [Skillpack workspace](/login) publishes it once and installs it everywhere.

```faq
items:
  - question: "Where does Codex look for skills?"
    answer: "In a repo, Codex scans .agents/skills from your working directory up to the repo root. Personal skills go in ~/.agents/skills. Admin skills live in /etc/codex/skills, and Codex bundles skill-creator and skill-installer."
  - question: "Does Codex read .codex/skills?"
    answer: "The current docs don't list it as a skill location. An earlier pull request kept ~/.codex/skills working for backwards compatibility until a full deprecation. Use .agents/skills and ~/.agents/skills instead."
  - question: "Why does my Codex skill appear twice?"
    answer: "Two folders hold a skill with the same name. Codex doesn't merge them, so both can show in the selector. List every copy with a script or skillpack doctor and keep one."
  - question: "Do I need to restart Codex after adding a skill?"
    answer: "Usually not. The docs say Codex detects skill changes automatically. If an update doesn't appear, restart Codex, and always restart after editing ~/.codex/config.toml."
  - question: "Why did Skillpack write to .codex/skills?"
    answer: "In CLI 0.3.5, a project install for Codex writes .agents/skills and .codex/skills, and a user-scope install writes ~/.codex/skills. Installing with --tools opencode writes only the .agents/skills folders."
  - question: "Can I use a symlink to share one skill folder?"
    answer: "Yes. The Codex docs say Codex supports symlinked skill folders and follows the symlink target when scanning skill locations."
  - question: "How do I disable one Codex skill without deleting it?"
    answer: "Add a [[skills.config]] entry to ~/.codex/config.toml with the skill's absolute path and enabled = false, then restart Codex. A name selector disables every skill with that name."
```
