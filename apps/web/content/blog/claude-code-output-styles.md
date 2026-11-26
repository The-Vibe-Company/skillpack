---
title: "Claude Code output styles: pick yours in 5 minutes"
description: "Claude Code output styles in plain words: what Concise, Proactive, Explanatory and Learning change, and how to switch or write your own in 5 minutes."
slug: claude-code-output-styles
date: 2026-11-26
tags: ["Claude Code", "Output Styles", "Agent Skills"]
author: "Stan Girard"
authorRole: "co-founder of The Vibe Company, which builds Skillpack"
---

# Claude Code output styles: pick yours in 5 minutes

You asked Claude Code a yes-or-no question. You got a warm-up paragraph before the answer and a recap after it.

There's a setting for that. An output style is a set of instructions that shapes Claude's tone and response format for every response in a session. Type `/output-style concise` and replies lead with the result. Claude Code includes four built-in styles besides Default, and you can write your own in a small Markdown file.

Below: how to pick one and switch, then a custom style to copy.

Disclosure: Skillpack, the site you're reading, publishes and installs `SKILL.md` packages. The facts here come from the [Claude Code output styles docs](https://code.claude.com/docs/en/output-styles) as they stood on November 26, 2026.

## What are Claude Code output styles?

An output style is a set of instructions that sets Claude's role, tone and response format for a whole session. You pick it once and stop typing "shorter, please" in every prompt.

Default means no style is selected. Claude then works from Claude Code's standard software engineering instructions. The four others are Proactive, Concise, Explanatory and Learning.

One limit to know. Styles apply to the main conversation and to forks. Other [subagents](/blog/claude-code-subagents-vs-skills) run their own system prompt, so your style doesn't change them.

## Which built-in style should you pick?

Pick by what bugs you about Default. Too wordy? Concise. Too many questions? Proactive. The last two explain the why.

- **Default: "it's fine."** No style selected, standard instructions. Stay here if nothing annoys you.
- **Proactive: "just do it."** Claude starts work right away and makes reasonable assumptions on routine decisions instead of asking. It doesn't switch to plan mode unless you ask. It still checks with you before deleting data or changing a shared or production system. Your permission mode stays as it was, so permission prompts still appear.
- **Concise: "get to the point."** Responses lead with the result and leave out the preamble, narration and recaps. A simple question gets one to three sentences. The engineering work matches Default. Claude still writes in full when you ask for detail, and for error reports, failing tests, security warnings and confirmations of destructive actions. It requires Claude Code v2.1.237 or later.
- **Explanatory: "tell me why."** Same work as Default, plus short `Insight` blocks of two or three points on why Claude made its choices.
- **Learning: "teach me."** You get the `Insight` blocks too. Claude also leaves small pieces of code for you to write, marked with a `TODO(human)` comment, then stops and waits until you say you're done. Yes, homework.

## How do you switch styles?

Type `/output-style` and a name, for example `/output-style concise`. Run it with no argument and it lists the styles and marks the current one.

Prefer menus? Run `/config`, then choose Output style. In the VS Code extension, open the `/` menu and choose Output styles. The command and the menus save your choice to `.claude/settings.local.json`.

Switch mid-session and the new style applies from your next message. That's the behaviour since v2.1.251. Older versions needed `/clear` or a new session.

You can also write it into a settings file yourself:

```json
{
  "outputStyle": "Explanatory"
}
```

Here's the sneaky part. That value is case-sensitive: `Proactive`, `Concise`, `Explanatory`, `Learning`. Write `explanatory` and you silently get Default. No error, no hint. The `/output-style` command ignores case, so the trap only bites in the file.

Want one style in all your projects? Set `outputStyle` in `~/.claude/settings.json`. A project's own settings win over it.

## How do you make your own style in 5 minutes?

Create a Markdown file in `~/.claude/output-styles` (just for you) or `.claude/output-styles` (for a project). Frontmatter goes on top, instructions go below.

Here's an example file to adapt, saved as `~/.claude/output-styles/explain-like-im-new.md`:

```markdown
---
name: Explain like I'm new
description: Plain words, one step at a time
keep-coding-instructions: true
---

Explain each change in plain words, one step at a time.
When you use a technical term, define it in one short sentence.
```

What those lines do:

- `name` is optional. Without it, the file name becomes the style name.
- `description` says what the style is for.
- `keep-coding-instructions: true` keeps Claude Code's built-in software engineering instructions. The default is `false`, so leave the line in if Claude should code the way it did before.

Two gotchas. A misspelled field is ignored without an error, so check your spelling. And in the terminal, Claude Code reads style files when it starts. Created or edited one during a session? Restart Claude Code, then switch to your style.

If it still looks ignored, you have company: a GitHub issue titled "Custom Output Style Completely Ignored by CLI" sits on page one of the search results. Start with the exact name and the restart.

## Output style vs skill vs hook: which one do you need?

A style shapes every reply in a session. Skills and hooks are its cousins, with different jobs.

- **Output style:** how Claude responds, all session long.
- **Skill:** instructions for one kind of task, loaded when you invoke it or the task matches. See [what SKILL.md is](/blog/what-is-skill-md).
- **Hook:** something that must happen every time, like formatting after each edit or blocking a command. See [hooks vs skills](/blog/claude-code-hooks-vs-skills).

The docs are blunt about it: an output style is an instruction, not a guarantee. And what Claude should know about your project belongs in [CLAUDE.md](/blog/skill-md-vs-agents-md-vs-claude-md).

```faq
items:
  - question: "Why is my Claude Code output style ignored?"
    answer: "Check the outputStyle value in your settings file first: it is case-sensitive, and a name that doesn't match exactly gives you Default. In the terminal, restart Claude Code after creating or editing a style file. Subagents other than forks run their own system prompt, so a style doesn't change them."
  - question: "Does an output style cost more tokens?"
    answer: "A style's instructions add input tokens, and prompt caching reduces that after the first request. Explanatory and Learning give longer replies by design. Concise gives shorter ones."
  - question: "What does Learning mode do in Claude Code?"
    answer: "The Learning output style adds Insight blocks that explain Claude's choices and leaves small pieces of code for you to write, marked with a TODO(human) comment. Claude then stops and waits until you say you're done."
```

## Next step

Open Claude Code and type `/output-style`. Try Concise for a day. If you miss the explanations, switch back with the same command. And when your best instructions turn out to be task recipes instead, put them in skills and [create a free Skillpack workspace](/login) to share them.
