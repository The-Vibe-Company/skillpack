---
title: "Claude skill creator: let Claude write your skill for you"
description: "Claude skill creator in plain words: install Anthropic's skill-creator plugin, describe the job, get a working SKILL.md, then fix the two lines that matter."
slug: claude-skill-creator
date: 2026-11-25
tags: ["Claude Code", "Agent Skills", "SKILL.md", "Skill Creator"]
author: "Stan Girard"
authorRole: "co-founder of The Vibe Company, which builds Skillpack"
---

# Claude skill creator: let Claude write your skill for you

The laziest way to make a Claude skill is to ask Claude to make it. Anthropic even ships a skill for exactly this job, called `skill-creator`.

Install it in Claude Code with `/plugin install skill-creator@claude-plugins-official`, then say "help me make a skill for X." It asks you a few questions, writes the `SKILL.md`, and offers to test it. You don't touch YAML. Your only job is to read the result and fix the bits it got wrong, which is usually the description.

Below: the 5-minute version, then the two lines worth checking before you trust it.

Disclosure: Skillpack, the site you're reading, publishes and installs `SKILL.md` packages. Everything below comes from Anthropic's [skill-creator SKILL.md](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md) and the [Claude Code docs](https://code.claude.com/docs/en/skills) as they stood on November 25, 2026.

## What is the Claude skill creator?

It's a skill whose job is making other skills. Anthropic describes it as a way to "create new skills, modify and improve existing skills, and measure skill performance." You'll find it in Anthropic's [skills repo](https://github.com/anthropics/skills/tree/main/skills/skill-creator) and as a plugin in the official [Claude Code marketplace](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/skill-creator).

Think of it as a patient coworker who has read every skill guide so you don't have to. You bring the chore. It brings the folder.

## Install it in one command

In a Claude Code session, run:

```bash
/plugin install skill-creator@claude-plugins-official
```

Claude Code opens the `/plugin` panel on the plugin's details so you can look it over and pick a scope. Accept, and Claude Code reloads plugins when the panel closes. The official marketplace gets added the first time you open an interactive session, so there's nothing else to set up.

Prefer your terminal? Same thing, shell flavor:

```bash
claude plugin install skill-creator@claude-plugins-official
```

## Make your first skill in 5 minutes

Pick a chore you keep retyping. Release notes. A commit message format. "Summarize this PR like I'm the product manager."

1. **Ask.** Type something like: "Help me make a skill that turns my git diff into release notes." The skill kicks in on its own. You can also call it by name with `/skill-creator:skill-creator`, since plugin skills use `plugin-name:skill-name`.
2. **Answer the interview.** It asks what the skill should do, when it should kick in, what the output looks like, and whether you want test cases. Then it pokes at edge cases. Answer like you'd brief a new hire.
3. **Let it draft.** You get a folder with a `SKILL.md`: a name, a description, and the instructions. Bigger skills also get `scripts/`, `references/` or `assets/` folders.
4. **Test or skip.** It offers to run a few test prompts and show you the results. In a hurry? Its own instructions say that if you tell it "just vibe with me," it drops the formal evals.
5. **Save it where Claude looks.** `~/.claude/skills/<name>/SKILL.md` makes it yours in every project. `.claude/skills/<name>/SKILL.md` in a repo shares it with your team once you commit it.

That's it. The skill now loads by itself when a matching task shows up, or when you type `/<name>`.

## The two lines to fix before you trust it

The skill creator writes a good first draft. "Good first draft" still means you read it.

**Line 1: the description.** This is the only part Claude sees before it decides to load your skill. Fun detail: the skill creator writes descriptions on the "pushy" side on purpose, because its instructions note that Claude tends to "undertrigger" skills. Pushy is fine. Too broad is not. If your release-notes skill now fires every time you mention git, trim the trigger words.

**Line 2: the name.** It becomes the folder and the `/command` you type. `release-notes` beats `git-diff-to-user-facing-changelog-generator`. Your fingers will thank you.

While you're in there, glance at the length. The skill creator itself aims to keep `SKILL.md` under 500 lines and move the rest into reference files. If your skill for "write a commit message" is 400 lines, something got excited.

## Common mistakes (all very human)

- **Asking for a skill that does everything.** "A skill for my whole job" gets you a vague skill. One chore per skill.
- **Skipping the interview.** If you answer "whatever you think," you get whatever it thinks. Two concrete examples of good output beat ten adjectives.
- **Never testing the trigger.** Ask a question that should fire the skill, without naming it. If nothing happens, the description is the problem. The [skills not working guide](/blog/claude-code-skills-not-working) covers the rest.
- **Installing a stranger's skill blind.** Anthropic's marketplace README says to trust a plugin before you install it. The same goes for any `SKILL.md` you download. Read it first.

## Even lazier: record yourself instead

If typing feels like work, Claude for Mac can watch you do the task. In Cowork, "Record a skill" captures your screen, clicks and voice for about 10 minutes, then proposes a skill for you to save. Per Anthropic's [help center](https://support.claude.com/en/articles/12512198-how-to-create-custom-skills), it's available on Pro, Max, Ultra and Team plans, and not on Windows. Narrate while you go. Claude can't guess why you skipped step 3.

## When to write the skill by hand

Sometimes the skill creator is overkill. A five-line skill ("always write commit messages in this format") is faster to type yourself. The step-by-step guide to [creating a Claude Code skill](/blog/how-to-create-a-claude-code-skill) walks through the manual way, and [What is SKILL.md?](/blog/what-is-skill-md) explains every field.

Whichever way you build it, `skillpack skills validate ./my-skill` checks the name and description locally before you share it. Then the same folder installs in Claude Code, Codex and OpenCode.

Now go find that prompt you've typed 40 times this month. It's about to become a skill.
