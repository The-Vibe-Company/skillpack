---
title: "Claude Code Plan Mode: Make Claude Think Before It Types"
description: "Claude Code plan mode in plain words: three ways to turn it on, what the approval prompt offers, the Shift+Tab trap and the setting that makes it the default."
slug: claude-code-plan-mode
date: 2026-11-27
tags: ["Claude Code", "Plan Mode", "Agent Skills"]
author: "Stan Girard"
authorRole: "co-founder of The Vibe Company, which builds Skillpack"
---

# Claude Code Plan Mode: Make Claude Think Before It Types

You ask Claude Code for a small fix. Before your coffee cools, it has rewritten files you never mentioned.

Plan mode is the brake. It tells Claude to research and propose changes without making them. Claude reads your files and writes a plan, and it does not edit your source while it plans. Press `Shift+Tab` until the status bar shows `⏸ plan mode on`, then ask for the fix. You get a plan to read first.

Two traps wait at the end. Approving the plan starts the editing right away. And at the approval prompt, `Shift+Tab` approves the plan instead of leaving plan mode.

Disclosure: Skillpack, the site you're reading, publishes and installs `SKILL.md` packages. The facts here come from the [Claude Code permission modes docs](https://code.claude.com/docs/en/permission-modes) as they stood on November 27, 2026.

## What does plan mode actually do?

Plan mode makes Claude look before it leaps: it explores, then proposes, and edits stay blocked until you approve the plan. The docs sum up its best use as "Exploring a codebase before changing it".

In practice, Claude reads files and runs shell commands to explore. Then it writes a plan and stops to ask you what to do next. Your source stays as it was.

While the mode is active, the status bar shows `⏸ plan mode on`. No pause sign? Then you're in another mode.

One footnote. The docs carve out a single exception: interactive terminal sessions with bypass permissions available.

## Three ways to turn it on

Use `Shift+Tab` during a session, the `/plan` prefix for a single prompt, or a flag when you start Claude Code.

```text
Shift+Tab                        press until the status bar shows ⏸ plan mode on
/plan add a dark mode toggle     plan mode for a single prompt
claude --permission-mode plan    start the session in plan mode
```

`Shift+Tab` cycles through the permission modes. From auto mode, the first press switches to `default`, then come `acceptEdits` and `plan`. Keep pressing and watch the status bar.

The `/plan` prefix suits the day you want one careful answer in an otherwise fast session. The flag suits the scary repo, the one where you'd rather read before anything moves.

## What happens when the plan is ready?

Claude presents the plan and asks how to proceed. You get three choices:

- **Yes, and use auto mode.** Approve and start in auto mode. If auto mode isn't available in your session, this option reads "Yes, auto-accept edits".
- **Yes, manually approve edits.** Approve, then review each edit one by one.
- **No, keep planning.** Stay in plan mode and tell Claude what to change.

Now the best-kept shortcut on that screen: `Ctrl+G`. It opens the proposed plan in your default text editor, so you can edit it directly before Claude proceeds. Delete the step you hate, then save.

Then the two gotchas.

**Approving means go.** Approving a plan exits plan mode and switches the session to the mode you picked, so Claude starts editing. "Yes" is a green light. To plan again later, cycle back with `Shift+Tab` or prefix your next prompt with `/plan`.

**`Shift+Tab` changes jobs at the approval prompt.** With no approval prompt open, `Shift+Tab` leaves plan mode. At the approval prompt, it approves the plan. Want out? Press `Esc` first.

A small bonus: accepting a plan gives the session a generated title based on the plan, unless you already named it.

## Can plan mode be the default?

Yes. Set `defaultMode` to `plan` in the project's `.claude/settings.json`, and that project's terminal sessions start in plan mode.

```json
{
  "permissions": {
    "defaultMode": "plan"
  }
}
```

VS Code plays by its own rules. Conversations started by the VS Code extension don't read project settings for the starting mode. There, set `claudeCode.initialPermissionMode` to `plan` in your VS Code user settings.

Plan mode governs what Claude may do. The way Claude talks is a separate setting, covered in the guide to [output styles](/blog/claude-code-output-styles).

## Plan mode vs a planning skill: which one do you need?

Probably both, because they do different jobs. Plan mode decides when Claude plans: before it edits. A planning skill decides what the plan looks like.

Plan mode is a mode. A skill is a recipe. With one installed, every plan asks the same questions.

Take grill-me, which has the agent interview you about a plan until every decision is settled. Or brainstorming, which ends with a written design doc you approve before any code. Both sit on the list of [planning skills](/blog/best-claude-code-skills-planning), next to spec-driven-development and the PRD skills.

New to skills? Start with [what a SKILL.md file is](/blog/what-is-skill-md), then browse the [best Claude Code skills](/blog/best-claude-code-skills) for the rest of your day.

```faq
items:
  - question: "Can Claude run commands in plan mode?"
    answer: "Yes, Claude runs shell commands to explore. What happens to a command depends on your session. When auto mode is available and the useAutoModeDuringPlan setting is on, which it is by default, a classifier reviews commands instead of prompting you. Otherwise, commands outside the built-in read-only set prompt for approval."
  - question: "Where are Claude Code plans saved?"
    answer: "Plan files live in ~/.claude/plans/, or in the plansDirectory you set."
  - question: "How do I leave plan mode?"
    answer: "With no approval prompt open, press Shift+Tab again. At the approval prompt, press Esc first, since Shift+Tab there approves the plan."
```

## Next step

Open Claude Code, press `Shift+Tab` until you see `⏸ plan mode on`, and ask for something small. Read the plan. Hit `Ctrl+G` and change one line, just because you can. Once a planning skill earns its place in your routine, [create a free Skillpack workspace](/login) to save it and share it with your team.
