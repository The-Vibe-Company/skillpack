---
title: "Cursor Rules vs Skills: When to Use Each (2026)"
description: "Cursor rules vs skills: how each one loads, when to pick a rule or a skill, how to migrate rules with /migrate-to-skills, and how to share both."
slug: cursor-rules-vs-skills
date: 2026-11-10
tags: ["Cursor", "Cursor Rules", "Agent Skills", "SKILL.md", "Comparison"]
author: "Stan Girard"
authorRole: "co-founder of The Vibe Company, which builds Skillpack"
---

# Cursor rules vs skills: when to use each

Short answer: a Cursor rule is short guidance added to the agent's context. Depending on its settings, it applies every time, for matching files, or when the agent finds it relevant. A Cursor skill is a folder with a `SKILL.md` file that holds a step-by-step procedure. Its full instructions load only when the task needs them, or when you call it with `/`. Use a rule for a constraint ("named exports only"). Use a skill for a workflow ("cut a release").

How we checked: Cursor's behavior comes from the official docs for [rules](https://cursor.com/docs/rules) and [skills](https://cursor.com/docs/skills). We also read Cursor's help pages on [rules](https://cursor.com/help/customization/rules) and [skills](https://cursor.com/help/customization/skills), all read on November 10, 2026. We didn't measure how often the agent follows either one. The Skillpack commands below were run with Skillpack CLI 0.3.5 on the same day. Disclosure: we build [Skillpack](https://skillpack.app), which installs and shares skills. It doesn't manage Cursor rules, so this isn't a ranking.

```takeaways
title: Key Takeaways
items:
  - lead: "Rules are context, skills are procedures."
    text: "Cursor's help page puts it simply: use a rule when a short instruction is enough, and a skill when the agent needs a detailed, repeatable process."
  - lead: "A rule's frontmatter decides when it loads."
    text: "alwaysApply, globs and description combine into four modes: always, matching files, agent decides, or only when you @-mention it."
  - lead: "Project rules must be .mdc files."
    text: "A plain .md file in .cursor/rules is ignored. Use AGENTS.md if you want plain Markdown."
  - lead: "/migrate-to-skills only converts some rules."
    text: "Rules set to Apply Intelligently become skills. Always-on rules, glob rules and user rules stay as they are."
  - lead: "Skills travel further than rules."
    text: "A SKILL.md works in any agent that supports the Agent Skills standard. Rules are a Cursor format."
```

## Cursor rules vs skills at a glance

| | Cursor rules | Cursor skills |
| :- | :- | :- |
| What it is | Persistent instructions for the agent | A packaged workflow: `SKILL.md` plus optional scripts, references and assets |
| File | `.mdc` file in `.cursor/rules/` (or `AGENTS.md`) | Folder with a `SKILL.md` in `.cursor/skills/` or `.agents/skills/` |
| Frontmatter | `description`, `globs`, `alwaysApply` | `name` and `description` required, plus optional `paths` and `disable-model-invocation` |
| When it loads | Every chat, on matching files, when the agent finds it relevant, or on `@` mention | Agent picks it when relevant, or you call `/skill-name` |
| Typical length | A few lines to a few hundred (Cursor suggests under 500) | Often longer, with step-by-step instructions |
| Ships scripts | No, a rule is one file, but it can point at files with `@path` | Yes, a `scripts/` folder the agent can run |
| Team sharing | Commit to git, Team Rules (Team and Enterprise), plugins | Commit to git, publish to a team marketplace, plugins, or a CLI |
| Portability | `.mdc` rules are a Cursor format | Works in agents that follow the [Agent Skills standard](https://agentskills.io) |

Cursor's skills help page sums it up in its own table: rules are "short coding guidelines and constraints", skills are "multi-step workflows and procedures".

## What Cursor rules are

Rules give the agent persistent context. Cursor's docs explain why they exist: models don't keep memory between completions. So when a rule applies, its contents go in at the start of the model context. Cursor has four kinds:

- **Project rules** live in `.cursor/rules/`, are version-controlled, and are scoped to your codebase.
- **User rules** are global preferences you set in Customize, then Rules. They sync with your Cursor account.
- **Team Rules** are managed from the Cursor dashboard on Team and Enterprise plans.
- **`AGENTS.md`** is plain Markdown in the project root or any subfolder, a simpler alternative to `.cursor/rules`.

### How a project rule decides when to load

Each project rule is an `.mdc` file with three frontmatter fields. The [rules docs](https://cursor.com/docs/rules) spell out how they combine:

| `alwaysApply` | `description` | `globs` | What happens |
| :- | :- | :- | :- |
| `true` | ignored | ignored | Included in every chat session |
| `false` | any | set | Attached when a matching file is in context |
| `false` | set | not set | The agent reads the description and pulls the rule in when relevant |
| `false` | not set | not set | Included only when you `@`-mention it, like `@my-rule` |

In the editor these show up as Always Apply, Apply to Specific Files, Apply Intelligently and Apply Manually. A rule scoped to React components looks like this:

```md
---
globs: src/components/**/*.tsx
alwaysApply: false
---

- Use named exports, not default exports
- Co-locate styles in a module CSS file next to the component
```

Three details catch people out:

- **The extension matters.** Project rules must use `.mdc`. Cursor ignores a plain `.md` file in `.cursor/rules/`, because it has no frontmatter to say when it applies.
- **`@file` mentions are not inlined.** A rule that says "read `@migration-template.sql`" tells the agent where to look. The agent opens the file with its tools when it needs it. Anything that must always be in context has to sit in the rule body.
- **`CLAUDE.md` is always on.** Cursor reads `CLAUDE.md` like `AGENTS.md`, and applies it to every conversation whatever its frontmatter says. For conditional guidance, use a project rule. We cover how those root files relate to `SKILL.md` in [CLAUDE.md vs AGENTS.md vs SKILL.md](/blog/skill-md-vs-agents-md-vs-claude-md).

When rules conflict, Cursor applies them in the order Team Rules, then Project Rules, then User Rules, and earlier sources win. The old `.cursorrules` file in the project root is legacy. Cursor's help page says it "will be deprecated" and shows how to move it into an Always Apply rule.

## What Cursor skills are

A skill is a folder with a `SKILL.md` file that teaches the agent one task. It can also carry `scripts/`, `references/` and `assets/`. Cursor follows the open Agent Skills standard, the same `SKILL.md` format Claude Code and Codex read. Our [Cursor skills guide](/blog/how-to-use-skills-in-cursor) covers folders, invocation and Cloud Agents in detail, so here is only what matters for the comparison.

Cursor discovers skills when it starts and shows the agent the available ones. The agent decides when a skill is relevant, and the docs describe skills as loading resources "on demand, keeping context usage efficient". You can also run one yourself by typing `/` and its name. That call attaches the skill to one message.

Two frontmatter fields bring skills closer to rules:

- **`paths`** limits a skill to files matching glob patterns, much like a rule's `globs`. Cursor still accepts the legacy `globs` field on skills, but new skills should use `paths`.
- **`disable-model-invocation: true`** stops the agent from picking the skill on its own. It then only runs when you type `/skill-name`, like an old slash command. We compare skills and commands in [Claude Code skills vs slash commands](/blog/claude-code-skills-vs-slash-commands).

If the `SKILL.md` format itself is new to you, [What is SKILL.md?](/blog/what-is-skill-md) goes through every field.

## How each one loads, and why it matters

This is the real difference. A rule that applies is included in the prompt as written. An Always Apply rule is in every chat, whether the task needs it or not. That's why Cursor's best practices say to keep rules under 500 lines and split large ones. They also advise against copying whole style guides or listing commands the agent already knows.

A skill costs much less until it's used. The agent sees what skills exist, then reads the full instructions and any reference files only when it decides one fits. So a long release checklist works better as a skill than as an Always Apply rule.

The trade-off runs the other way for reliability. An Always Apply rule is always there. A skill depends on the agent matching your request to its description, unless you call it with `/`. If something must never be skipped, like "never edit files in `dist/`", keep it in a rule.

## When to use a rule and when to use a skill

Ask these questions about the instruction you're about to write:

1. **Is it one or two sentences?** Write a rule. "Use zod for all API validation" doesn't need a folder.
2. **Must it apply to every edit, even when nobody thinks of it?** Rule, set to Always Apply or scoped with `globs`.
3. **Is it a sequence of steps with a clear start and end?** Skill. "Run tests, build, deploy to staging, check the health endpoint" is the example Cursor uses.
4. **Does it need a script, a template or a long reference doc?** Skill. Rules can only point at files. Skills can ship them.
5. **Should it only run when someone asks for it?** Skill with `disable-model-invocation: true`. A deploy or a database migration belongs here.
6. **Will teammates use Claude Code or Codex too?** Prefer a skill. The same folder works there, while `.mdc` rules are a Cursor format.

Most repos end up with both: a handful of short rules for conventions, and a few skills for the jobs people repeat every week.

## The same instruction, written both ways

Say your team keeps pasting a release-notes procedure into chat. Written as an Apply Intelligently rule, it lives in `.cursor/rules/release-notes.mdc`:

```md
---
description: How to write user-facing release notes from merged PRs
alwaysApply: false
---

1. List PRs merged since the last tag.
2. Group them under New, Improved and Fixed.
3. One plain sentence per change.
```

As a skill, it moves to `.cursor/skills/release-notes/SKILL.md` and gets a name, a sharper description and a scope:

```md
---
name: release-notes
description: Write user-facing release notes from merged pull requests. Use when asked for release notes, a changelog entry or "what shipped". Do not use for commit messages.
paths: "CHANGELOG.md, docs/releases/**"
disable-model-invocation: true
---

1. List PRs merged since the last tag with `git log --merges <last-tag>..HEAD`.
2. Group them under New, Improved and Fixed. Skip refactors and dependency bumps.
3. Write one plain sentence per change, from the user's point of view.
```

The skill version can grow. Add a `scripts/list-merged-prs.sh` and a `references/style.md` with examples, and none of it touches context until the skill runs. The `name` must match the folder name and use lowercase letters, numbers and hyphens only.

We checked both files with the Skillpack CLI. `skillpack skills validate ./release-notes` returned `valid: true`, with the Cursor-specific `paths` and `disable-model-invocation` fields in place. Pointed at `.cursor/rules/`, the same command failed with "SKILL.md is missing or oversized" (exit code 5). A rule folder isn't a skill package, so it has to be converted first.

## How to migrate Cursor rules to skills

Cursor ships a built-in `/migrate-to-skills` skill, available since Cursor 2.4. Type it in Agent chat and the agent finds eligible rules and commands, converts them, and writes the results to `.cursor/skills/` for you to review. Per the [skills docs](https://cursor.com/docs/skills), it converts:

- **Dynamic rules:** rules set to Apply Intelligently, meaning `alwaysApply: false` (or unset) and no `globs`. They become standard skills.
- **Slash commands:** user and workspace commands become skills with `disable-model-invocation: true`, so they still only run when called.

It leaves alone rules with `alwaysApply: true`, rules with `globs`, and user rules, which aren't stored on the file system. That's the right call. Those rules have explicit triggers that skills don't copy exactly.

To convert a single rule by hand, type `/create-skill` and ask the agent to "turn `@my-rule` into a skill". Review the result, then delete the old rule if you no longer need it. Before you commit a migrated skill, check three things:

- The description says when to use the skill, not only what it does. The agent reads it to decide.
- Steps that only made sense as always-on context ("prefer composition") go back into a short rule.
- `skillpack skills validate ./<skill-folder>` passes, if you plan to share the skill outside Cursor.

## How to share rules and skills with your team

Both start in git. Commit `.cursor/rules/` and the team gets your project rules. Commit `.cursor/skills/` or `.agents/skills/` and the team gets your project skills. Cursor's docs also point to repo skills for automations and self-hosted workers. After that, the options differ.

**For rules**, Team and Enterprise plans have Team Rules, set in the dashboard. Admins can enforce a rule so members can't switch it off, and Team Rules support glob patterns. Rules from another repository arrive through a plugin. You import the repo in Customize, and it needs a `.cursor-plugin/marketplace.json`.

**For skills**, Cursor offers two routes on Teams and Enterprise. You can publish a personal skill from `~/.cursor/skills/` to the team's Default marketplace (Customize, then Skills, then Publish), and teammates install it from there. You can also install plugins that bundle skills. Personal skills only reach Cloud Agents if you turn on Sync Skills for Cloud Agents, and `~/.agents/skills/` never syncs.

**Across agents and repos**, a CLI that pins versions helps. Skillpack is the tool we build, so weigh this paragraph accordingly. It has no `cursor` target: `--tools cursor` returned "unknown coding tool" in our test. Cursor reads `.agents/skills`, so `--tools opencode` is the way to go:

```sh
skillpack install github:anthropics/skills/skills/frontend-design \
  --scope project --tools opencode --yes
```

That wrote `.agents/skills/frontend-design/` and a `.companion/skills.lock.json` with the exact commit. Before copying, the CLI printed the source commit, "Executable files: none" and a warning that Skillpack only copies files and never runs package scripts. We then deleted the skill folder and ran `skillpack sync --frozen`. It restored the folder (`restored: 1`) and left the lockfile unchanged. Commit both, and every laptop and CI run gets the same skill. Our guides on [sharing skills with your team](/blog/how-to-share-claude-code-skills-with-your-team) and [checking skills in CI](/blog/how-to-check-agent-skills-in-ci) go further.

```cta
title: "Share your team's skills across Cursor, Claude Code and Codex"
text: "Create a free Skillpack workspace to publish your skills and install the same pinned version on every laptop and in CI."
primary: { label: "Create a free Skillpack workspace", href: /login }
secondary: { label: "Cursor skills guide", href: /blog/how-to-use-skills-in-cursor }
```

## Common mistakes with Cursor rules and skills

- **A `.md` file in `.cursor/rules/`.** Cursor ignores it. Rename it to `.mdc` and add frontmatter, or move the content to `AGENTS.md`.
- **An Apply Intelligently rule with no description.** The agent has nothing to match against. Cursor's FAQ tells you to check this when a rule doesn't apply.
- **A giant Always Apply rule.** It lands in every chat. Move the procedure into a skill and keep the rule to the constraints.
- **Expecting `@file` contents in the prompt.** They aren't inlined. Paste must-have content into the rule body.
- **Two rules with the same filename.** Cursor identifies rules by full path, so both apply if their conditions match.
- **A skill that never triggers.** Rewrite its description with the words you actually type, or call it with `/` to confirm it loads.
- **A migrated skill that lost its scope.** If the rule had `globs`, `/migrate-to-skills` skips it. If you convert it by hand, add `paths` to keep the same file scope.

```faq
items:
  - question: "What is the difference between Cursor rules and skills?"
    answer: "Rules are short, persistent instructions added to the agent's context always, for matching files, when relevant, or when @-mentioned. Skills are folders with a SKILL.md that hold multi-step procedures and optional scripts, loaded when the agent finds them relevant or when you call /skill-name."
  - question: "Where are Cursor rules stored?"
    answer: "Project rules are .mdc files in .cursor/rules/ in your repo. User rules set in Customize are stored on your Cursor account, and rule files in ~/.cursor/rules stay on your machine. Team Rules live on Cursor's servers and are managed from the team dashboard."
  - question: "Should I use a rule or a skill in Cursor?"
    answer: "Use a rule for a short constraint that must apply every time, like a naming convention. Use a skill for a repeatable process with steps, scripts or reference files, like deploying or writing release notes. Many teams use both."
  - question: "How do I convert Cursor rules to skills?"
    answer: "Type /migrate-to-skills in Agent chat. It converts rules set to Apply Intelligently and slash commands into skills in .cursor/skills/. Always-on rules, rules with globs and user rules are not migrated. For one rule, ask /create-skill to turn @my-rule into a skill."
  - question: "Do Cursor rules load into every chat?"
    answer: "Only rules with alwaysApply: true. A rule with globs loads when a matching file is in context. A rule with only a description loads when the agent finds it relevant, and a rule with neither loads when you @-mention it. CLAUDE.md is applied to every conversation."
  - question: "Are .cursorrules files still supported?"
    answer: "Cursor's help page calls .cursorrules legacy and says it will be deprecated. To migrate, create a new rule, paste the content, set it to Always Apply to keep the old behavior, then delete .cursorrules."
  - question: "Can I use Cursor rules in Claude Code or Codex?"
    answer: "Cursor treats .mdc rules as its own format: in plugins, rules belong to Cursor Plugins only, while skills are also part of the open Agent Plugins standard. For instructions that travel, use a SKILL.md, which Cursor, Claude Code and Codex read, or a plain AGENTS.md."
```

## Next step

Open `.cursor/rules/` and sort what's there. Short constraints stay as rules. Anything with steps becomes a skill, through `/migrate-to-skills` or by hand. Is a skill worth sharing with people who also use Claude Code or Codex? [Create a free Skillpack workspace](/login) and install the same pinned version for everyone.
