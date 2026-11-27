---
title: "Claude Code Plan Mode: 3 Ways In and When to Skip It"
description: "Claude Code plan mode in plain words: three ways to turn it on, the traps at the approval prompt, and when to skip the plan and grill the ticket instead."
slug: claude-code-plan-mode
date: 2026-11-27
tags: ["Claude Code", "Plan Mode", "Agent Skills"]
author: "Stan Girard"
authorRole: "co-founder of The Vibe Company, which builds Skillpack"
---

# Claude Code Plan Mode: 3 Ways In and When to Skip It

Claude Code plan mode hands you a tidy numbered plan before Claude touches a file. You skim it, nothing looks scary, and you approve anyway.

Plan mode tells Claude to research and propose changes without making them. Claude reads your files and writes a plan, but does not edit your source. Press `Shift+Tab` until the status bar shows `⏸ plan mode on`, then ask for your change.

Treat it as a checkpoint for human control, not a safety net. For a long time I asked for a plan before any code. Today I don't look at plans at all.

Disclosure: Skillpack, the site you're reading, publishes and installs `SKILL.md` packages. The facts here come from the [Claude Code permission modes docs](https://code.claude.com/docs/en/permission-modes) as they stood on November 27, 2026. That same day, `claude --help` on Claude Code 2.1.332 listed `plan` among the `--permission-mode` choices.

## What does plan mode actually do?

Plan mode makes Claude explore and propose, and edits stay blocked until you approve the plan. The docs sum up its best use as "Exploring a codebase before changing it".

Claude reads files and runs shell commands to explore, then writes a plan. Meanwhile, the status bar shows `⏸ plan mode on`. No pause sign? Then you're in another mode.

One catch: in an interactive terminal session where bypass permissions is available, don't rely on plan mode's blocks. A file edit or shell command Claude attempts during planning can run without prompting.

## Three ways to turn it on

You get a key, a prefix and a flag.

- Press `Shift+Tab` until the status bar shows `⏸ plan mode on`.
- Type `/plan add a dark mode toggle` to plan a single prompt.
- Start the whole session in plan mode with this flag:

```bash
claude --permission-mode plan
```

`Shift+Tab` cycles through the permission modes. From auto mode, the first press switches to `default`, then come `acceptEdits` and `plan`. In the status bar, `default` shows as `⏸ manual mode on`.

## What happens when the plan is ready?

Claude presents the plan and asks how to proceed. You get three choices:

- **Yes, and use auto mode.** If auto mode isn't available in your session, this option reads "Yes, auto-accept edits".
- **Yes, manually approve edits.** Approve, then review each edit.
- **No, keep planning.** Stay in plan mode and tell Claude what to change.

Learn one shortcut on that screen: `Ctrl+G`. It opens the proposed plan in your default text editor, so you can edit it directly before Claude proceeds. Delete the step you hate, then save.

Two traps wait here.

**Approving means go.** Approving a plan exits plan mode and switches the session to the mode you picked, so Claude starts editing. To plan again later, cycle back with `Shift+Tab` or prefix your next prompt with `/plan`.

**`Shift+Tab` changes jobs at the approval prompt.** With no approval prompt open, `Shift+Tab` leaves plan mode. At the approval prompt, it approves the plan. Want out? Press `Esc` first.

## Can plan mode be the default?

Yes. Set `defaultMode` to `plan` in the project's `.claude/settings.json`, and that project's terminal sessions start in plan mode.

```json
{
  "permissions": {
    "defaultMode": "plan"
  }
}
```

Conversations started by the VS Code extension don't read project settings for the starting mode. There, set `claudeCode.initialPermissionMode` to `plan` in your VS Code user settings.

The way Claude talks is a separate setting, covered in the guide to [output styles](/blog/claude-code-output-styles).

## When is plan mode worth it?

Plan mode is worth it when you want a human to look before the edits start. My example is a team new to agents, where seeing the plan before the edits can help people build trust. My warning: "Just don't mistake it for protection."

The sign to skip it is easy to spot. You skim, then you approve.

I've been there. I used to ask for a plan before any code and read it line by line. Then I skimmed. By the end, I scanned for the few words that would have worried me and approved. I approved because I had read it, not because I had checked it.

The mistake, when there is one, hides in what nobody decided beforehand, and rarely in the steps. I wrote skills to make plans faster and cheaper, and still skimmed them. So I stopped reading plans. The rest is in [my longer take on plan mode](https://www.thevibecompany.co/en/resources/articles/claude-code-plan-mode).

## What should you do instead of reading plans?

Settle the decisions on the ticket, before Claude plans anything. I spend that time with Grill Me, a skill by Matt Pocock.

You start it by typing `/grill-me`. The agent won't reach for it on its own. It interviews you in rounds and writes no files. Start it in a fresh conversation, and follow the [Grill Me docs](https://github.com/mattpocock/skills/blob/main/docs/productivity/grill-me.md) on one point: "Leave plan mode off. Plan mode makes the agent hurry to produce a plan, when you want it to keep asking questions."

In plan mode the agent proposes and you approve. With Grill Me, the agent asks and you decide.

Once the ticket is grilled, I find the AI smart enough to implement it almost every time. A plan would tell me nothing I hadn't already settled.

One warning from the same docs: answer "agreed" to every question and you come out with "a plan the agent wrote and you nodded at". Push back.

Grill Me sits on the list of [planning skills](/blog/best-claude-code-skills-planning), next to brainstorming and the PRD skills. New to skills? Start with [what a SKILL.md file is](/blog/what-is-skill-md), then browse the [best Claude Code skills](/blog/best-claude-code-skills).

```faq
items:
  - question: "Can Claude run commands in plan mode?"
    answer: "Yes, Claude runs shell commands to explore, and the first case that matches applies. With bypass permissions available in a terminal session, commands can run with no prompt at all. When auto mode is available and useAutoModeDuringPlan is on (the default), a classifier reviews them instead of prompting you. Otherwise, commands outside the built-in read-only set prompt for approval."
  - question: "Where are Claude Code plans saved?"
    answer: "Plan files live in ~/.claude/plans/, or in the plansDirectory you set."
  - question: "How do I leave plan mode?"
    answer: "With no approval prompt open, press Shift+Tab again. At the approval prompt, press Esc first, since Shift+Tab there approves the plan."
```

## Next step

Try plan mode once on a repo that scares you. Ask for something small and hit `Ctrl+G` to change one line of the plan. On your next ticket, open a fresh conversation, leave plan mode off, and type `/grill-me` first. Once a skill earns its place, [create a free Skillpack workspace](/login) to save it and share it with your team.
