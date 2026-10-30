---
title: "How to Create a Claude Code Skill: Step-by-Step Guide (2026)"
description: "Build a working Claude Code skill: write SKILL.md, test that it triggers, add scripts and references, then validate it and reuse it in Codex."
slug: how-to-create-a-claude-code-skill
date: 2026-10-19
tags: ["Claude Code", "Agent Skills", "SKILL.md", "Skillpack CLI"]
author: "Stan Girard"
authorRole: "co-founder of The Vibe Company, which builds Skillpack"
---

# How to create a Claude Code skill

You probably have a prompt you keep retyping. "Write the release notes like last time." "Check the migration the way we always do." A skill turns that prompt into a folder Claude Code loads on its own when the task comes up, or when you type `/skill-name`.

This guide builds one real skill from start to finish: a `writing-release-notes` skill that turns merged pull requests into user-facing notes. You'll write it, test that it triggers, give it a script, and get it ready to share. If you want the theory first (what a skill is, every frontmatter field), read [What is SKILL.md?](/blog/what-is-skill-md). This page is the hands-on part.

```takeaways
title: Key Takeaways
items:
  - lead: "Start from a task you already repeat."
    text: "Write two or three test prompts before you write the skill, so you know what \"working\" means."
  - lead: "The description does the triggering."
    text: "Claude only sees the name and description until it decides to load the skill. Front-load the use case and the words people actually type."
  - lead: "Keep SKILL.md short."
    text: "Anthropic's docs say to stay under 500 lines and move details to files one level deep."
  - lead: "Test both ways."
    text: "Ask a matching question, then call /skill-name directly. Fix the description if the first one misses."
  - lead: "Validate before you share."
    text: "`skillpack skills validate ./my-skill` checks the name and description locally, then the same folder installs in Claude Code, Codex and OpenCode."
```

## Step 1: pick a task worth a skill

Good first skills are boring. They're the instructions you already give in code review or paste into Slack:

- a release notes or changelog format
- a commit message convention
- a checklist for database migrations
- how your team writes tests

A skill fits when the steps are mostly the same each time and the agent keeps getting one detail wrong. If the task needs live access to a system, like your issue tracker, a skill alone won't do it. Pair it with an MCP server ([Agent Skills vs MCP](/blog/agent-skills-vs-mcp) covers the split). And if the job is self-contained and mostly produces output you'll never read again, a separate worker may be the better home for it ([subagents vs skills](/blog/claude-code-subagents-vs-skills) covers the choice).

Before writing anything, write down three prompts you'd expect to trigger the skill, and what a good answer looks like. Anthropic's [best practices for skills](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/best-practices) recommend exactly this: build the evaluations first, then write just enough instructions to pass them. There's no built-in runner for these checks, so a short list in a text file is enough.

For our example:

1. "Write release notes for everything merged since the last tag."
2. "What shipped this week? I need it for the changelog."
3. "/writing-release-notes v2.4.0"

A good answer groups changes into New, Improved and Fixed, uses plain words, and skips internal refactors.

## Step 2: create the folder

A skill is a folder with a `SKILL.md` file inside. Where you put it decides who gets it ([Claude Code docs](https://code.claude.com/docs/en/skills)):

| Location | Path | Who gets it |
|---|---|---|
| Personal | `~/.claude/skills/<name>/SKILL.md` | You, in every project on this machine |
| Project | `.claude/skills/<name>/SKILL.md` | Everyone working in the repo, once committed |

Start personal while you iterate, then move it to the project when it works:

```sh
mkdir -p ~/.claude/skills/writing-release-notes
```

Keep the folder name and the skill `name` identical. Claude.ai and the Agent Skills format require them to match, and it keeps the `/` command predictable.

## Step 3: write a minimal SKILL.md

Two parts: YAML frontmatter between `---` lines, then the instructions in Markdown.

```md
---
name: writing-release-notes
description: Writes user-facing release notes from pull requests merged since the last git tag. Use when the user asks for release notes, a changelog entry, or what shipped in a release.
---

# Writing release notes

1. Find the last tag with `git describe --tags --abbrev=0`.
   If the user passed a version, use it as the release title.
2. List merged pull requests since that tag with
   `git log <tag>..HEAD --merges --oneline`.
3. Group the changes under three headings: New, Improved, Fixed.
4. Write one line per change, in plain words, for users, not developers.
5. Skip internal refactors, dependency bumps and CI changes.
6. End with a one-sentence summary of the release.

If there's no tag yet, say so and ask which commit to start from.
```

A few rules that matter here:

- **`name`**: lowercase letters, numbers and hyphens, 64 characters max. Anthropic's docs also list "anthropic" and "claude" as reserved words, so skip names like `claude-release-notes`.
- **`description`**: what the skill does and when to use it, written in the third person ("Writes…", not "I can help you…"). The spec caps it at 1,024 characters.
- **Numbered steps** beat long paragraphs. The agent follows them in order and you can see which step went wrong.

## Step 4: test that it triggers

Claude Code watches the skills folders, so a new or edited `SKILL.md` is picked up in the current session. One catch from the docs: if `~/.claude/skills` didn't exist when the session started, run `/reload-skills` once.

Then run your three prompts:

1. Ask "Write release notes for everything merged since the last tag." Claude should say it's using `writing-release-notes`.
2. Ask the vaguer one: "What shipped this week?"
3. Call it directly: `/writing-release-notes v2.4.0`.

If the direct call works but the questions don't trigger it, the problem is almost always the description. Claude only sees the name and description of each skill until it decides to load one, then it reads the full file. So:

- Put the main use case first. Claude Code truncates the description in its skill list at 1,536 characters, and Codex shortens descriptions when many skills are installed ([Codex docs](https://developers.openai.com/codex/skills)).
- Use the words people actually type: "release notes", "changelog", "what shipped".
- Say what the skill doesn't do if it keeps firing on the wrong requests.

Edit, save, ask again. That loop is most of the work.

## Step 5: move details out of SKILL.md

Your skill will grow: an example of good notes, a style guide, maybe a script. Claude reads the whole `SKILL.md` every time the skill loads, so anything it only needs sometimes belongs in a separate file. Anthropic's docs suggest keeping `SKILL.md` under 500 lines and linking reference files directly from it, one level deep, not file to file to file.

```text
writing-release-notes/
├── SKILL.md
├── references/
│   └── style-guide.md
└── scripts/
    └── merged_prs.sh
```

Then point to each file at the step where it's needed:

```md
2. Run `scripts/merged_prs.sh <tag>` to list merged pull requests
   with their titles and labels.
4. Follow the tone rules in `references/style-guide.md`.
```

A script is worth it when the step is fiddly and the same every time, like parsing `git log` output. The agent runs it instead of rebuilding the command, which is faster and more consistent.

Claude Code also has a shortcut called dynamic context injection: a line like `` !`git describe --tags --abbrev=0` `` in `SKILL.md` runs before Claude reads the skill, and the output replaces the line. It's handy, but it's a Claude Code feature. If the skill must also work in Codex or OpenCode, write it as a step the agent runs instead.

## Step 6: decide who can trigger it

By default, both you and Claude can invoke a skill. Two frontmatter fields change that in Claude Code:

| Field | Effect | Use it for |
|---|---|---|
| `disable-model-invocation: true` | Only you can run it, with `/name` | Anything with side effects: deploys, commits, sending messages |
| `user-invocable: false` | Only Claude can load it; hidden from the `/` menu | Background knowledge, like how a legacy system works |

Release notes are harmless to draft, so leave the default. A `publishing-release` skill that pushes a tag should have `disable-model-invocation: true`. As the docs put it, you don't want Claude deciding to deploy because your code looks ready.

There's also `allowed-tools`, which pre-approves tools for the turn that invokes the skill. Be careful with it in shared repos: Claude Code's docs warn that a project skill's `allowed-tools` applies even in folders you haven't trusted, so review it like code.

Already have prompts in `.claude/commands/`? [Here is how they compare to skills and how to move them](/blog/claude-code-skills-vs-slash-commands).

## Step 7: make it work in Codex and OpenCode too

The `SKILL.md` format isn't Claude Code-only. Codex reads the same files: it requires `name` and `description`, scans `.agents/skills` from your working directory up to the repo root, and uses `$HOME/.agents/skills` for personal skills ([Codex docs](https://developers.openai.com/codex/skills)). You call a skill there with `$writing-release-notes` or `/skills`. More in [our Codex skills guide](/blog/how-to-use-skills-in-codex).

To keep a skill portable:

- Stick to `name` and `description` for anything that matters. Fields like `disable-model-invocation` are Claude Code settings. Codex does the same thing with `allow_implicit_invocation: false` in an optional `agents/openai.yaml` file inside the skill.
- Avoid dynamic context injection (see step 5).
- Refer to bundled files with relative paths, like `scripts/merged_prs.sh`.

The annoying part is the folders: `.claude/skills` for Claude Code, `.agents/skills` for Codex. Copying the skill into both by hand works until someone edits one copy.

## Step 8: validate and share it

Once the three test prompts pass, check the folder and get it to the people who need it. With the Skillpack CLI:

```sh
skillpack skills validate ./writing-release-notes
```

Validation runs locally. A bad name or a missing description fails with `invalid skill name or description` and a nonzero exit, so you can run it in CI. Full checks happen on the server when you publish.

From there you have three routes:

- **Keep it in one repo.** Commit `.claude/skills/writing-release-notes/` and you're done. For a repo-specific skill, that's the right call.
- **Install it from GitHub.** If the skill lives in a public repo, anyone can run `skillpack install github:<owner>/<repo>/<path> --scope project`. Project installs write the skill to `.agents/skills` with managed copies for Claude Code and Codex, plus a `.companion/skills.lock.json` lockfile to commit.
- **Publish it to your team.** `skillpack skills publish ./writing-release-notes --scope org` publishes a version to your organization. Teammates install it with one command, `skillpack sync --frozen` checks in CI that every copy matches the lockfile, and `skillpack update` brings in new versions without overwriting local edits.

[How to share Claude Code skills with your team](/blog/how-to-share-claude-code-skills-with-your-team) compares these options in more detail, including Claude Code plugins and claude.ai provisioning.

```cta
title: "Wrote a skill your whole team should use?"
text: "Publish it to a free Skillpack workspace and install the same version in Claude Code, Codex and OpenCode, on every laptop and in CI."
primary: { label: "Create a free Skillpack workspace", href: /login }
secondary: { label: "How to share skills with your team", href: /blog/how-to-share-claude-code-skills-with-your-team }
```

## Common mistakes

- **A vague description.** "Helps with releases" won't trigger on "what shipped this week". Name the task and the trigger words.
- **One giant SKILL.md.** Long reference material slows every load. Move it to `references/`.
- **References that link to references.** Keep every file one hop from `SKILL.md`.
- **Two skills for the same request.** If two skills match "write release notes", you'll get different answers on different days. Merge them or narrow one.
- **Personal-only skills the team relies on.** A skill in `~/.claude/skills/` doesn't reach teammates or CI. Commit it or publish it.

## Before you copy someone else's skill

Writing your own isn't always the fastest route. For common jobs, plenty of public skills already exist. We compared the most-installed ones for [code review](/blog/best-claude-code-skills-code-review) and [frontend design](/blog/best-claude-code-skills-frontend-design), plus [the best Claude Code skills overall](/blog/best-claude-code-skills). Read any third-party skill before installing it, scripts and `allowed-tools` included, the same way you'd read a new dependency.

```faq
items:
  - question: "How do I create a skill in Claude Code?"
    answer: "Create a folder in `~/.claude/skills/` (personal) or `.claude/skills/` (project), add a `SKILL.md` file with `name` and `description` in YAML frontmatter, and write the instructions below it. Claude Code picks it up in the current session; run `/reload-skills` if the skills folder didn't exist when the session started."
  - question: "Do I need to restart Claude Code after editing a skill?"
    answer: "No. Claude Code watches its skills folders and picks up changes to `SKILL.md` during the session. The exception is a top-level skills folder created after the session started: run `/reload-skills` for that one."
  - question: "Why doesn't my skill trigger automatically?"
    answer: "Usually the description. Claude only sees the name and description until it loads a skill, so put the main use case first and include the words people actually type. Test by calling `/skill-name` directly: if that works, the instructions are fine and the description needs work."
  - question: "How long should a SKILL.md be?"
    answer: "Anthropic's docs recommend keeping it under 500 lines. Move examples, style guides and long references into separate files that SKILL.md links to directly."
  - question: "Can the same skill work in Claude Code and Codex?"
    answer: "Yes, if it sticks to the shared format: `name`, `description` and Markdown instructions. Claude Code reads `.claude/skills`, Codex reads `.agents/skills`. Skillpack project installs write both from one command."
  - question: "How do I check a skill before sharing it?"
    answer: "Run your test prompts, then `skillpack skills validate ./my-skill` to check the name and description locally. It exits nonzero on an invalid skill, so it also works as a CI step."
```

## Keep going

Pick the prompt you retyped most this week and turn it into a skill today. Once it works for you, [create a free Skillpack workspace](/login) and publish it so your whole team runs the same version.
