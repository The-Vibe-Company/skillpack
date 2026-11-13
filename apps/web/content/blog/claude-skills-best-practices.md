---
title: "Claude Skills Best Practices: Measure Every Change"
description: "Claude skills best practices start with an eval, not a line count. See what happens when features pile up with no gate, and how to measure every change."
slug: claude-skills-best-practices
date: 2026-11-13
dataCollected: 2026-11-13
tags: ["Claude Skills", "Agent Skills", "SKILL.md", "Skill evals", "SkillOpt", "Progressive disclosure"]
author: "Stan Girard"
authorRole: "co-founder of The Vibe Company, which builds Skillpack"
---

# What are Claude skills best practices?

Ask for Claude skills best practices and the first thing you usually get back is a number. Keep the SKILL.md body [under 500 lines](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices), move the detail into reference files, and let progressive disclosure load the rest when it's needed.

Now take a small skill that writes commit subjects. It never gets long. Across four versions its description stays within a few words of where it started, and every commit prompt keeps finding it. By the last version it contradicts its own original rules and has taken a changelog request away from the skill next door. A line counter would have waved all of it through.

Stan Girard, who co-founded the company behind Skillpack, has a blunt explanation. The problem, he says, isn't whether a skill is too long, it's that people don't measure what each change does to it. You write a skill, you call it finished, you add a feature, then another, and in his words "le skill il devient n'importe quoi": it turns into a mess, because nothing ever checked the value you wanted from it in the first place. So the short answer is a habit. Snapshot the skill, write the prompts that define its job, and accept a change only when it beats the previous version on them. When a change turns out to be a second job, give it a second skill.

## Most advice on Claude skills best practices starts with how long SKILL.md should be

The length advice is real, and the number is Anthropic's own. The same page says to keep references one level deep, each file linked directly from SKILL.md, and to split content out as the body approaches the limit. If the question that brought you here was how long should a SKILL.md be, that's the official answer.

The reasoning behind it is progressive disclosure. [Anthropic's Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) explains that at startup Claude pre-loads only each skill's name and description. It reads SKILL.md when the skill becomes relevant, and opens other files only as needed. So the body costs you context only once the skill triggers, and the description is the part that's always in play.

If you want the file format itself, there's a separate explainer on [what a SKILL.md file is and what goes in it](/blog/what-is-skill-md), and a [step-by-step guide to creating a Claude Code skill](/blog/how-to-create-a-claude-code-skill) if you'd rather build one first.

Further down, though, the page with the line limit says something a line counter can't help you with: "Build evaluations first." Then it adds, "There is not currently a built-in way to run these evaluations." So the docs that hand you the number also tell you the number comes second, and that the first thing is yours to build.

## So a notebook test added features one at a time and watched what moved

The test starts with a skill called writing-commit-subjects that does one job. Its contract is strict: "a single subject line only," "do not write a changelog," "do not end the subject with a period." Next to it sits a neighbor, writing-release-notes, whose description never changes.

Then the features arrive, each one reasonable on its own: v1 adds a three-paragraph explanation after the subject, v2 adds PR titles, labels and changelog entries, and v3 advertises release notes and "what shipped this week," and requires a trailing period.

After each version, ten prompts go through a router that sees only the two descriptions, because the description is what loads before SKILL.md does. The router scores the word overlap between the prompt and each description and picks the strictly higher score. Most of the prompts are commit requests, and the rest belong to release notes or to neither skill. A separate audit counts how many of the v0 rules each new version contradicts.

| Version | Commit prompts routed correctly | False triggers on the other prompts | Description length (words) | Contradictions with v0 |
|---|---|---|---|---|
| v0, commit subjects only | 6/6 | 1/4 | 39 | 0 |
| v1, plus an explanation | 6/6 | 1/4 | 48 | 1 |
| v2, plus PR titles, labels, changelog entries | 6/6 | 1/4 | 47 | 2 |
| v3, plus release notes and a trailing period | 6/6 | 3/4 | 48 | 3 |

## The original prompts kept matching while the contract and the boundary broke

Read the second column first, because it never moves. Every commit prompt lands on the commit skill in every version. If your only check is whether the skill still triggers on what it was built for, every version passes, and you ship v3 with a clear conscience.

The description length is just as calm. If length were the disease, this skill would be the healthy one.

The last column is where the damage shows. The explanation in v1 breaks the single-line rule. The changelog entries in v2 break the no-changelog rule. The trailing period in v3 breaks the rule about periods. The contract started eroding with the very first feature, two versions before the router noticed anything.

When the router finally does notice, it's a neighbor that pays. "What shipped this week? I need it for the changelog." went to the release-notes skill in every earlier version. In v3 it goes to commit subjects, 0.1944 against 0.1667, because the description now advertises those very words. (The other new v3 false trigger is a rebase question that won on a single shared word, "this," so don't read much into it.)

And then there's the first row. The tight, single-job v0 already false-triggered on "Draft the pull request description for this branch." Its description said, "Do not use for release notes, changelogs, or pull request descriptions," and a router that matches words reads an exclusion as vocabulary. The sentence written to keep that prompt out is the one that pulled it in. The only way to find that is to run prompts.

## What holds is measuring every change, and splitting the skill when it stops being one job

Microsoft Research describes the same drift Stan does. Its [SkillOpt blog post](https://www.microsoft.com/en-us/research/blog/skillopt-agent-skills-as-trainable-parameters/) says "skills tend to grow longer and drift with each rewrite, and a revision that seems perfectly reasonable can quietly degrade real task performance."

SkillOpt's answer is a gate. In [Microsoft's SkillOpt paper](https://arxiv.org/abs/2605.23904), the skill file is trainable state outside a frozen model: an optimizer proposes bounded edits, and a candidate is accepted only if it scores strictly higher on a held-out validation split. Ties are rejected. What survives is small. Across six case studies, the blog reports a median final skill of roughly 920 tokens, with only one to four edits accepted into each file. On OfficeQA, with GPT-5.5 in direct chat, the score went from 33.1 to 72.1 on a single accepted edit.

Skill Creator brings that discipline to the skills you maintain yourself. If you are interested in Stan's Skill Creator, you can [contact Stan](https://cal.com/stangirard/thevibecompany). The public package, `create-skill-tools` in [The Vibe Company's companion-skills repository](https://github.com/The-Vibe-Company/companion-skills), tells you to edit one target file per iteration when possible, keep the edit bounded, and compare against a snapshot of the previous version as well as against no skill. It accepts only strict improvements on held-out or previously unused prompts, rejects ties and logs the rejected edits. It also says to test the description as a routing surface, which is the exact spot where v3 lost the changelog prompt.

That package's own SKILL.md body runs 494 lines, 6 under Anthropic's limit, with the deeper material in reference files. The line rule and the measuring habit get along fine. Only one of them would have caught v3.

The other half of Stan's method is the split. Skill Creator's rule is that every recurring kind of work should have exactly one obvious owner. If people naturally ask for a complete outcome, it's probably an owner skill. If it's a reusable step inside several outcomes, it's probably a capability that owners call. Implementation detail stays a script, a reference or a local project rule (the comparison of [SKILL.md, AGENTS.md and CLAUDE.md](/blog/skill-md-vs-agents-md-vs-claude-md) covers where those rules live). By that test, the changelog entries in v2 never belonged in a commit skill: a release-notes skill already owned that outcome. Neighbors then get an explicit handoff, a plain "For X, see Y," so they don't overlap silently.

So keep the number from the first paragraph. It's good advice. Then open the skill you edited most recently and, before the next feature goes in, do this:

1. Copy the current SKILL.md to a snapshot.
2. Write a few prompts that define the value you wanted, with the output each should produce, plus a couple that belong to neighboring skills. [Anthropic's own example](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) uses three scenarios.
3. Run them against the snapshot. That's your baseline.
4. Make the change, and keep it only if it strictly beats the baseline on prompts you held back while editing. A tie is a no.
5. If the change only passes by taking a neighbor's prompt or breaking a rule of the contract, it's a second job. Give it its own skill and a handoff line.

Once those prompts exist, the guide to [checking agent skills in CI](/blog/how-to-check-agent-skills-in-ci) is the next read, so the gate doesn't depend on anyone's memory.

Run that loop on the commit skill and the argument happens at v1, when a required explanation meets "a single subject line only," long before a changelog request goes missing. The line count would have looked fine either way. It looked fine in v3 too.

*Method: the notebook test ran on 13 November 2026 with a lexical router (Jaccard overlap of word tokens, description field only) as a reproducible stand-in for Claude's real skill selection, and no agent was run, so it measured no pass rates for generated commit messages.*

*Disclosure: Skillpack is built by The Vibe Company, the author's company.*

```cta
title: "Try the measuring habit on your next skill"
text: "If you are interested in Stan's Skill Creator, you can [contact Stan](https://cal.com/stangirard/thevibecompany). Or start with the step-by-step guide to building a skill."
primary: { label: "Create a free Skillpack workspace", href: /login }
secondary: { label: "Read the step-by-step skill guide", href: /blog/how-to-create-a-claude-code-skill }
```

```faq
items:
  - question: "How long should a SKILL.md be?"
    answer: "Anthropic's Agent Skills overview budgets the instructions that load when a skill triggers at under 5k tokens, and its best-practices page sets a separate line limit for the SKILL.md body. As the body nears that limit, split content into reference files linked directly from SKILL.md. Length is the easy check, though: a skill can stay short and still drift, so measure each change against a baseline as well."
  - question: "What is progressive disclosure in Claude skills?"
    answer: "Progressive disclosure means Claude loads a skill in stages. According to Anthropic's Agent Skills overview, only the name and description are always loaded, at about 100 tokens per skill, while the SKILL.md instructions load when the skill triggers and other resources load only when accessed. Scripts can run without being loaded, so only their output enters context."
  - question: "How do you know a skill change is actually an improvement?"
    answer: "Compare it to a snapshot of the previous version on prompts you held back while editing, and keep it only if it scores strictly higher. That is the acceptance gate in Microsoft's SkillOpt, which rejects ties, and Stan Girard's Skill Creator applies the same rule. Anthropic's docs say there is no built-in way to run these evaluations, so you build your own."
```
