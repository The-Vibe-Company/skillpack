---
title: "Agent Skills Open Standard vs Vendor Folders"
description: "The Agent Skills open standard is a portable SKILL.md folder. Compare where Claude Code, Codex and Cursor load skills from their own directories."
slug: agent-skills-open-standard-vs-vendor-folders
date: 2026-11-04
tags: ["Agent Skills", "SKILL.md", "Claude Code", "Codex", "Cursor", "Skillpack CLI"]
author: "Stan Girard"
authorRole: "co-founder of The Vibe Company, which builds Skillpack"
---

# Agent Skills open standard vs vendor folders

The [Agent Skills](https://agentskills.io/) open standard defines one package shape: a folder with a `SKILL.md` file. That package is portable. Claude Code, Codex and Cursor still look for it in their own directories. Where they look decides whether you write a skill once or three times.

Paths and progressive-disclosure wording below come from agentskills.io, Claude Code, Codex and Cursor docs scraped on November 4, 2026. CLI targets come from a Skillpack CLI 0.3.5 dry-run the same day. Skillpack is built by The Vibe Company; the CLI notes are install behavior, not a ranking.

```takeaways
title: Key Takeaways
items:
  - lead: "One package format, many discovery folders."
    text: "Agent Skills standardizes the SKILL.md folder. Each host still scans its own paths."
  - lead: "Progressive disclosure is part of the standard."
    text: "Discovery loads name and description. Activation loads full SKILL.md. Execution may open scripts or references."
  - lead: "Claude Code uses .claude/skills."
    text: "User skills live in ~/.claude/skills/. Project skills live in .claude/skills/."
  - lead: "Codex prefers .agents/skills."
    text: "Repo and user scopes use .agents/skills. The ADMIN scope uses /etc/codex/skills."
  - lead: "Cursor reads both shared and compat paths."
    text: "It loads .agents/skills and .cursor/skills, and also Claude and Codex folders for compatibility."
```

## What the open standard actually standardizes

Per [agentskills.io](https://agentskills.io/), a skill is a folder with a required `SKILL.md` (name and description at minimum) plus optional `scripts/`, `references/`, `assets/` and other files. The format was originally developed by Anthropic, released as an open standard, and reused across compatible agents. The full field list lives in the [specification](https://agentskills.io/specification).

Agents load skills through progressive disclosure, in three stages:

1. **Discovery.** At startup, the agent loads only name and description.
2. **Activation.** When a task matches, it reads the full `SKILL.md`.
3. **Execution.** It follows the instructions and may run bundled code or open referenced files.

That contract is what travels. New to the format? Start with [What is SKILL.md?](/blog/what-is-skill-md) and [how to create a Claude Code skill](/blog/how-to-create-a-claude-code-skill). For how skills compare to MCP, see [Agent Skills vs MCP](/blog/agent-skills-vs-mcp).

## What each host still decides: where to look

The open standard does not force one on-disk path. Each host keeps its own discovery roots. Docs checked on November 4, 2026:

| Host | Project / repo paths | User / machine paths | Notes |
| :- | :- | :- | :- |
| Claude Code | `.claude/skills/<skill-name>/` | `~/.claude/skills/<skill-name>/` | `SKILL.md` sits directly inside the skill folder ([Claude Code skills docs](https://code.claude.com/docs/en/skills)) |
| Codex | `$CWD/.agents/skills`, parent folders, `$REPO_ROOT/.agents/skills` | `$HOME/.agents/skills`; ADMIN `/etc/codex/skills` | Preferred discover path is `.agents/skills` ([Codex skills docs](https://developers.openai.com/codex/skills)) |
| Cursor | `.agents/skills/`, `.cursor/skills/` | `~/.agents/skills/`, `~/.cursor/skills/` | Also loads `.claude/skills/`, `.codex/skills/`, `~/.claude/skills/`, `~/.codex/skills/` for compatibility ([Cursor skills docs](https://cursor.com/docs/skills)) |

So "write once" means one `SKILL.md` package. "Install everywhere" still means put that package (or a copy) where each host scans.

Codex docs emphasize `.agents/skills`. Some Skillpack articles and the CLI still mention managed `.codex/skills` copies for installs. Treat `.codex/skills` as CLI or compatibility behavior, not as Codex's preferred discover path. Cursor's compatibility list is why a Claude-only copy can still appear in Cursor without a second authoring pass.

## Practical workflow: write once, place per host

1. Author the skill to the open format: folder + `SKILL.md` (+ optional `scripts/`, `references/`, `assets/`).
2. Keep the body short enough for activation. Put heavy detail in files the agent opens during execution.
3. Place or install the same folder into each host path you care about.
4. Dry-run before you write, so you see every target.

Manual placement works. It gets noisy once you keep Claude Code, Codex and Cursor copies by hand. Step-by-step host guides:

- [How to install skills in Claude Code](/blog/how-to-install-skills-in-claude-code)
- [How to use skills in Codex](/blog/how-to-use-skills-in-codex)
- [How to use skills in Cursor](/blog/how-to-use-skills-in-cursor)

Want concrete folders to study first? See [Claude skills examples](/blog/claude-skills-examples).

```cta
title: "Install the same skill folder across hosts"
text: "Use a free Skillpack workspace to lock versions and install into the shared .agents/skills copy plus host folders."
primary: { label: "Create a free Skillpack workspace", href: /login }
secondary: { label: "How to install skills in Claude Code", href: /blog/how-to-install-skills-in-claude-code }
```

## What Skillpack CLI 0.3.5 writes (factual note)

Default project installs write a shared `.agents/skills/<name>` copy plus host copies. A dry-run on November 4, 2026:

```sh
skillpack install github:anthropics/skills/skills/frontend-design --scope project --tools claude-code --dry-run
```

reported both:

- Target (shared, project): `.agents/skills/frontend-design`
- Target (claude-code, project): `.claude/skills/frontend-design`

So `--tools claude-code` is not Claude-only on disk. It still writes the shared `.agents/skills` copy and the `.claude/skills` copy. That shared folder is what Codex prefers and what Cursor lists as a first-class project path. Narrowing `--tools` changes which host-specific folders get a managed copy. In this CLI version it does not drop the shared project target.

When you want the same skill locked for a team, [create a free Skillpack workspace](/login), install, commit `.companion/skills.lock.json`, and sync on other machines.

## Open standard vs vendor folders: side by side

| Question | Open standard (agentskills.io) | Vendor folders |
| :- | :- | :- |
| What is portable? | The skill folder and `SKILL.md` contract | Nothing by itself; paths differ per host |
| Who defines loading stages? | Progressive disclosure (discovery → activation → execution) | Hosts implement discovery against their roots |
| Where does the file live? | Anywhere you put a valid skill folder | Claude: `.claude/skills`; Codex: `.agents/skills`; Cursor: `.agents/skills` and `.cursor/skills` (+ compat) |
| How do you reuse across products? | Author once to the spec | Copy or CLI-install into each host's folders |

```faq
items:
  - question: "What is the Agent Skills open standard?"
    answer: "A portable folder format centered on SKILL.md (name and description at minimum), with optional scripts/, references/ and assets/. It was originally developed by Anthropic and released as an open standard at agentskills.io."
  - question: "Does the open standard mean every host uses the same folder path?"
    answer: "No. The standard defines the package. Claude Code, Codex and Cursor still scan their own directories for those packages."
  - question: "Where does Claude Code load skills from?"
    answer: "User skills from ~/.claude/skills/<skill-name>/ and project skills from .claude/skills/<skill-name>/. SKILL.md must sit directly inside the skill folder."
  - question: "Where does Codex load skills from?"
    answer: "Primarily .agents/skills under the current working directory, parent folders and the repo root, plus $HOME/.agents/skills for the user and /etc/codex/skills for ADMIN. Codex docs emphasize .agents/skills over legacy .codex/skills."
  - question: "Where does Cursor load skills from?"
    answer: "Project: .agents/skills/ and .cursor/skills/. User: ~/.agents/skills/ and ~/.cursor/skills/. For compatibility it also loads .claude/skills/, .codex/skills/, ~/.claude/skills/ and ~/.codex/skills/."
  - question: "What does progressive disclosure mean for skills?"
    answer: "Discovery loads name and description, activation loads the full SKILL.md when the task matches, and execution may run scripts or open references only as needed."
  - question: "Does skillpack install --tools claude-code write only .claude/skills?"
    answer: "No. In Skillpack CLI 0.3.5, a project dry-run with --tools claude-code wrote both .agents/skills/<name> (shared) and .claude/skills/<name>."
```
