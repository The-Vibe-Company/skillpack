---
title: "Claude Code Verification Skills: A pstack Install Notebook"
description: "Claude Code verification skills build the check your agent must pass. A pstack install notebook shows why the repo path fails and which sibling goes missing."
slug: claude-code-verification-skills
date: 2026-11-17
dataCollected: 2026-11-17
tags: ["Claude Code", "Agent Skills", "Verification", "pstack", "Formal Verification", "Skillpack CLI"]
author: "Stan Girard"
authorRole: "co-founder of The Vibe Company, which builds Skillpack"
---

# Which Claude Code verification skills actually land when you install pstack?

The first attempt to install Claude Code verification skills in this notebook ended on exit code 5, with a path copied straight from the official GitHub URL. The second attempt, one level up, failed with the same code for a completely different reason. The attempt that worked printed a clean success, and left a link pointing at a file that wasn't there.

Before the story, the answer you came for. A verification skill isn't a skill that writes tests for you, it's a skill that builds, inside your repo, the check your agent has to run before it says "done". The official ones are the five in [pstack](https://github.com/cursor/plugins/tree/main/pstack), the plugin by Lauren Tan ([@poteto](https://x.com/poteto)), whose [README](https://github.com/cursor/plugins/blob/main/pstack/README.md) says "these are the same skills i use every day to ship high quality code at Cursor".

So if you want a skill that writes unit tests or drives a browser, that's a different page, the [ranking of Claude Code skills for testing and TDD](/blog/best-claude-code-skills-testing). If you want the agent's work checked against the real app, or against a property tests rarely reach, you want pstack, and you want it installed as the plugin it is. The notebook found out why the hard way.

![The official pstack plugin keeps verification skills together; a single-folder install of the formal skill leaves statechart behind.](/images/blog/claude-code-verification-skills/pstack-plugin-keeps-siblings-together.png)

The figure gives away the ending: inside the plugin the skills sit side by side, and a folder pulled out alone loses its neighbor. Getting there took three attempts.

## Claude Code verification skills build a check for your repo and make it prove itself

Start with [create-verification-skill](https://github.com/cursor/plugins/blob/main/pstack/skills/create-verification-skill/SKILL.md), because it generates the project-local skill that drives the app the way a user does. It interviews the repo, not you, about how to run, drive, observe and isolate the app, and asks you only what the code can't answer. Then it writes a project-local skill, addressed to the next agent, that launches the app, drives a feature the way a user would, captures evidence and cleans up.

The word "verification" is earned right before handoff. The generator has to run its own output end to end and confirm the evidence still exists, because, in the SKILL.md's words, "A generated skill that was never executed is a draft, not a deliverable."

If that sounds like a QA skill, David Cramer ([@zeeg](https://x.com/zeeg/status/2122512673434894644)) agrees with you. The same day as this notebook he posted "alright i have lived w/ pstack for 24 hours" and called the verification skills basically what QA skills already did for him, only "more prescriptive". His advice if you have nothing like it: "put some kind of qa skill in your repo that the agent should call to test changes (not your test suite, like literal QA)."

That covers part of the set. The rest starts where QA stops. [create-formal-verification-skill](https://github.com/cursor/plugins/blob/main/pstack/skills/create-formal-verification-skill/SKILL.md) opens like this: "A test checks the cases that someone thought to write. Formal verification checks every case in a stated scope: every order of steps in a model, every input up to a bound, or every input." It picks the promise in your code where a break hurts users and tests rarely reach, and it defaults to TLA+ when the question is about events happening in a bad order. Its own standard is harsh: "A check that you have never seen fail proves nothing." So before handoff the generator breaks the property on a scratch change, and the new skill has to catch it.

Each generator has a maintain twin, because a check rots as the code moves. The formal one names the trap: a stale check keeps passing, and "That pass is the dangerous case, because it looks like a proof." Skills themselves drift the same way. The author's 13 November article, [Claude Skills Best Practices: Measure Every Change](/blog/claude-skills-best-practices), says people don't measure what each change does to a skill. Two public skills on GitHub aim at that gap: [Skill Creator](https://github.com/The-Vibe-Company/companion-skills/blob/main/skills/create-skill-tools/SKILL.md) and [Refine Skill](https://github.com/The-Vibe-Company/companion-skills/blob/main/skills/refine-skill-tools/SKILL.md), whose description says to improve a skill, "then prove that it produces better real-world outputs."

## The official pstack path fails twice, then the five skill folders install cleanly

The plugin manifest gives `github.com/cursor/plugins/tree/main/pstack` as pstack's homepage, so the natural move with a skill installer is to hand it that folder:

```
skillpack install github:cursor/plugins/pstack
```

Skillpack CLI answered "SKILL.md is missing or oversized" and exited 5. That folder is a plugin, and this plugin's root holds a manifest, a README and a `skills/` directory with [58 skill folders in it](https://github.com/cursor/plugins/tree/main/pstack/skills), but no SKILL.md of its own. (Here is [what a SKILL.md file is](/blog/what-is-skill-md), if the name is new to you.)

So the notebook went one level up and tried the whole repository, `github:cursor/plugins`. Same exit code, new message: "GitHub skill exceeds the file limit (2000 files)". The repo holds the plugin specification and every official plugin, far too much to swallow as one skill.

The third try went down a level, one skill folder at a time, for example `github:cursor/plugins/pstack/skills/statechart`. All five exited 0, each pinned in its lockfile to the same commit, [e1cc031](https://github.com/cursor/plugins/commit/e1cc03121a0e71129a4fb730d7c5528a0a3e43c8), after a plain warning in the plan: "This third-party skill has not been verified by Skillpack." Here is what each folder put on disk.

| Skill | Its job in one line | skills.sh installs (cursor/plugins listing, 17 Nov 2026) | What the single-folder install landed | Caveat |
|---|---|---|---|---|
| [create-verification-skill](https://github.com/cursor/plugins/blob/main/pstack/skills/create-verification-skill/SKILL.md) | Generates a project-local skill that drives your app the way a user does | [5,501](https://skills.sh/api/search?q=create-verification-skill) | SKILL.md plus a feature map example, 4 files in all | The official file writes the generated skill under `.cursor/skills/verify-<app>/` |
| [maintain-verification-skill](https://github.com/cursor/plugins/blob/main/pstack/skills/maintain-verification-skill/SKILL.md) | Upkeep loop for the skill the generator wrote | [5,030](https://skills.sh/api/search?q=maintain-verification-skill) | SKILL.md only | Has nothing to maintain until the generator has run |
| [create-formal-verification-skill](https://github.com/cursor/plugins/blob/main/pstack/skills/create-formal-verification-skill/SKILL.md) | Generates a skill that formally verifies the code where a bug costs the most and tests reach the least | [1,721](https://skills.sh/api/search?q=create-formal-verification-skill) | SKILL.md only | Links to `../statechart/SKILL.md`, which this install doesn't contain |
| [maintain-formal-verification-skill](https://github.com/cursor/plugins/blob/main/pstack/skills/maintain-formal-verification-skill/SKILL.md) | Brings the formal check back in line after the code changes | [1,543](https://skills.sh/api/search?q=maintain-formal-verification-skill) | SKILL.md only | Edits the verification, never product code unless you ask |
| [statechart](https://github.com/cursor/plugins/blob/main/pstack/skills/statechart/SKILL.md) | Checks a TLA+ model and draws it as a Mermaid statechart | [1,493](https://skills.sh/api/search?q=statechart) | SKILL.md, `references/render.md` and 406 files under `scripts/` | "The first run installs TLC and Java with mise and needs the network." |

Look at the last row. Four of these skills are markdown, instructions plus a few reference files in one case. The fifth landed [408 files](https://github.com/cursor/plugins/tree/main/pstack/skills/statechart), because statechart is a compiler with an executable entry point and its own test corpus. A folder name told you none of that.

The install counts are the official cursor/plugins listing only, because skills.sh also indexes community ports named pstack, with their own totals.

## The formal skill links to a sibling that a single-folder install leaves behind

The formal-only project looked finished: exit 0, one SKILL.md, a pinned commit. Then the notebook followed the links inside that file.

When the check is a TLA+ model, create-formal-verification-skill requires the skill it generates to tell the next agent to read every result with `/statechart`, and it links there as `../statechart/SKILL.md`. In the formal-only project that path resolves to `.claude/skills/statechart/SKILL.md`. The file doesn't exist. Nothing complained, since a markdown link to a missing neighbor isn't an install error.

Pasting statechart's usage into your generated skill won't patch it either. The SKILL.md forbids the generator from copying statechart commands, options or file paths, because they change between releases and machines.

Lauren Tan talks about the two as a pair. Her [8 November post](https://x.com/poteto/status/2119521036660314339) suggests a prompt that uses both and ends "both skills are in pstack". A [reply the next day](https://x.com/poteto/status/2119606813767385164) explains the division of labor: "that's what /statechart is for, it lets you visually verify that it's correct since only you know what your product is supposed to do."

statechart checks the model and draws it, and the drawing is how you confirm the model is your product. Without it, your agent gets instructions that point at a reader that isn't there.

## So install the plugin whole, or bring statechart along

The README's route for Claude Code keeps the siblings in one tree:

1. Run `/plugin marketplace add cursor/plugins`.
2. Run `/plugin install pstack@cursor-plugins`.
3. Run `/pstack:setup-pstack`, which writes your model choices to `~/.claude/rules/pstack-models.md`.

Claude Code prefixes plugin commands, which is why `/setup-pstack` gains a `pstack:` in front. It also leaves auto-update off for third-party marketplaces, so you stay on the version you installed until you enable it or run `claude plugin update pstack@cursor-plugins`. In Cursor the whole thing is `/add-plugin pstack`. The [official guide](https://github.com/cursor/plugins/blob/main/pstack/docs/guide/06-verify-and-ship.md) gives the reason to bother: "Verification is the slowest step in most agent work, because it's the step that usually waits on a human."

Maybe you'd rather pin single folders, which is another way to [install skills in Claude Code](/blog/how-to-install-skills-in-claude-code). Then treat the formal skill and statechart as one unit. The path the broken link wants, `.claude/skills/statechart/SKILL.md`, is exactly where a statechart install writes its SKILL.md, so the two folders belong in the same project.

Which brings back the three attempts from the top. The two that failed were the kind ones: loud, and over in a minute. The install that exited 0 is the one to worry about, and you can test for it right now. Run `ls .claude/skills/` in your repo. If create-formal-verification-skill is listed and statechart is missing, install the sibling before your agent's next proof.

```cta
title: "Pin the skills your agent depends on"
text: "In this notebook, Skillpack CLI installed each pstack skill folder into a project and recorded the source commit in a lockfile."
primary: { label: "Create a free Skillpack workspace", href: /login }
secondary: { label: "How to install skills in Claude Code", href: /blog/how-to-install-skills-in-claude-code }
```

Method: every result here comes from a single notebook run with Skillpack CLI 0.3.5 in throwaway projects, one skill folder per project, reading the official pstack files, the skills.sh search API and the X API, without running the Cursor or Claude Code plugin commands, TLA+ or any formal proof.

Disclosure: Skillpack is built by The Vibe Company, the author's company.
