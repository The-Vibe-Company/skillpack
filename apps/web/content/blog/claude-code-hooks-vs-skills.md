---
title: "Claude Code Hooks vs Skills: Which One Do You Need?"
description: "Claude Code hooks vs skills in plain words: a skill is advice Claude can skip, a hook runs every time. When to use each, plus a 5-minute formatter hook."
slug: claude-code-hooks-vs-skills
date: 2026-11-24
tags: ["Claude Code", "Hooks", "Agent Skills", "SKILL.md"]
author: "Stan Girard"
authorRole: "co-founder of The Vibe Company, which builds Skillpack"
---

# Claude Code hooks vs skills: the coach and the bouncer

You wrote a skill that says "always run the formatter." Claude ran it twice, then forgot. Rude? A bit. Surprising? Nope.

Here's the short answer. A skill is a coach: it tells Claude how to do a job, and Claude decides when to use it. A hook is a bouncer: a shell command that Claude Code runs at a fixed moment, like right after a file edit, whether Claude feels like it or not. Anthropic's own [skills docs](https://code.claude.com/docs/en/skills) say it plainly: if Claude skipped a rule that must hold every time, move that rule into a hook.

Skills for know-how, hooks for "this must always happen." Below: the difference in plain words, then a hook you can add in 5 minutes.

Disclosure: Skillpack, the site you're reading, publishes and installs `SKILL.md` packages. The hook examples come from the [Claude Code hooks guide](https://code.claude.com/docs/en/hooks-guide) as it stood on November 24, 2026.

## What does a Claude Code skill do?

It teaches Claude a procedure. A skill is a folder with a `SKILL.md` file: a short frontmatter with a `name` and a `description`, then the instructions. Claude reads the description, and when your request matches, it loads the rest. You can also call it yourself with `/skill-name`.

The key word is "decides." That's great for judgment calls like "write release notes" or "review this diff." It's a weak spot for rules with zero exceptions. A model can always pick wrong.

New to the format? Start with [what SKILL.md is](/blog/what-is-skill-md) and [how to create a Claude Code skill](/blog/how-to-create-a-claude-code-skill).

## What does a Claude Code hook do?

It runs your command at a fixed point in Claude Code's life. Hooks are user-defined shell commands, and the docs promise "deterministic control": certain actions always happen instead of relying on the model to choose them.

You pick an event, like `PostToolUse` (after a tool runs), `PreToolUse` (before), `Notification` (Claude is waiting for you) or `SessionStart`. You add a `matcher` to narrow it down, say `Edit|Write` for file edits. Then you give the command. It all lives in a `hooks` block inside a settings file: `~/.claude/settings.json` for you, or `.claude/settings.json` in a project.

No prompt. No mood. The event fires, the command runs.

## Hooks vs skills: which one do you need?

Ask one question: is this a rule or a recipe?

- **Recipe? Use a skill.** How to write a migration, or your PR description template. Claude needs the context, and some judgment helps.
- **Rule? Use a hook.** Format every edited file, or never touch `.env`. You want it every single time, and nobody needs to think.

For rules that need a bit of judgment, the guide also covers prompt-based and agent-based hooks, which ask a Claude model to check a condition. Start with plain commands, though.

Gut check: annoyed when Claude skips it? Hook. Annoyed when Claude does it at the wrong moment? Skill.

## How do you add your first hook in 5 minutes?

Take the classic: auto-format after every edit. Put this in `.claude/settings.json` at your project root:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "f=$(jq -r '.tool_input.file_path') && npx prettier --write --ignore-unknown \"$f\""
          }
        ]
      }
    ]
  }
}
```

It runs only after the file-editing tools. The command pulls the edited file path out with `jq` and hands it to Prettier. You'll need `jq` installed (`brew install jq` on macOS, `apt-get install jq` on Debian and Ubuntu).

Then check it:

1. Type `/hooks` in Claude Code. Your hook shows up under `PostToolUse`.
2. Ask Claude to add a line with single quotes to a JavaScript file.
3. Open the file. With Prettier's defaults, the quotes are now double.

A working hook is silent. No chat message, just a tidy file. Already have a `hooks` key in that settings file? Add the new event next to the others instead of replacing the whole block.

Now delete the "always run the formatter" line from your skill. The bouncer has it covered.

## Can a hook block Claude?

Yes, and it's the fun part. A `PreToolUse` hook runs before the tool. If your script exits with code 2, the action is blocked, and the message your script writes to stderr goes back to Claude as feedback so it can try another way.

The guide's example blocks edits to `.env`, `package-lock.json` and anything in `.git/`. One honest catch from the same page: Claude can still change those files with shell commands, so pair the hook with deny rules in your permissions if it really matters.

## Can skills and hooks work together?

Yes. A skill's frontmatter can carry its own `hooks` field. Those hooks don't run until you or Claude invoke the skill, then stay registered until you leave the conversation. The [hooks reference](https://code.claude.com/docs/en/hooks) shows a skill that runs a security check before every Bash command once it's active.

So the coach can hire a bouncer for the shift. Perfect for a "deploy" skill that should never run without its safety check. For the other members of the gang, see [subagents vs skills](/blog/claude-code-subagents-vs-skills) and [skills vs slash commands vs plugins](/blog/claude-code-skills-vs-slash-commands).

```faq
items:
  - question: "What is the difference between Claude Code hooks and skills?"
    answer: "A skill is a set of instructions Claude loads when your request matches its description, so Claude decides when to use it. A hook is a shell command Claude Code runs automatically at a set event, such as after a file edit, so it happens every time."
  - question: "Where do Claude Code hooks go?"
    answer: "In a hooks block inside a settings file: ~/.claude/settings.json for all your projects, or .claude/settings.json in a project. A skill can also declare hooks in its frontmatter; they start when the skill is invoked."
  - question: "Why does Claude ignore my skill sometimes?"
    answer: "Claude chooses when to load a skill from its description. For a rule that must hold every time, Anthropic's docs suggest moving it into a hook, which Claude Code runs whether or not Claude follows the skill."
```

## Next step

Open your skills and look for the words "always" and "never." Each one is a hook waiting to happen. Move one rule today, keep the recipes in skills, and when those skills are worth sharing, [create a free Skillpack workspace](/login) so your whole team gets the same ones.
