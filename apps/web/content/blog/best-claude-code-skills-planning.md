---
title: "Best Claude Code Skills for Planning and Specs (2026)"
description: "The 7 most-installed Claude Code planning skills in 2026: grill-me, brainstorming, spec-driven development and PRD skills, with install commands."
slug: best-claude-code-skills-planning
date: 2026-10-28
tags: ["Claude Code", "Agent Skills", "Planning", "Specs", "PRD"]
author: "Stan Girard"
authorRole: "co-founder of The Vibe Company, which builds Skillpack"
layout: ranking
dataCollected: 2026-10-28
---

# Best Claude Code Skills for Planning in 2026

The most-installed Claude Code skill for planning is Matt Pocock's **grill-me**, with 1.45M installs on skills.sh. It makes the agent interview you about a plan until every decision is settled. Jesse Vincent's **brainstorming** skill from Superpowers comes second, with 408.5K installs, and it ends with a written design doc you approve before any code. The other five turn an idea into a spec, a PRD or a step-by-step plan. Each entry below has a one-line install command you can share with your team.

```cta
title: "Install any skill on this page with one command, and share it with your team."
text: "`skillpack install github:mattpocock/skills/skills/productivity/grilling` works without an account. Create a free Skillpack workspace to share skills across your organization."
primary: { label: "Create a free Skillpack workspace", href: /login }
```

```takeaways
title: Key Takeaways
items:
  - lead: "Planning skills do three different jobs."
    text: "Some question you until the idea is clear (grill-me, brainstorming, product-brainstorming). Some write the document (spec-driven-development, prd, create-prd). One turns an agreed scope into an implementation plan (ce-plan)."
  - lead: "grill-me is a short stub."
    text: "It calls another skill, grilling, from the same repository. Install both, or install grilling on its own."
  - lead: "The top two won't let the agent code first."
    text: "grill-me waits until you confirm a shared understanding. brainstorming won't start until you approve a design doc."
  - lead: "PRD skills differ in length."
    text: "phuryn's create-prd aims for one to two pages. GitHub's prd skill uses a fuller five-part schema with risks and a roadmap."
  - lead: "Plans only help if the whole team plans the same way."
    text: "Pin the exact commit in a lockfile that lives in the repo, so every developer's agent asks the same questions and writes the same kind of doc."
```

## What planning skills actually do

A Claude Code skill is a folder with a `SKILL.md` file. It holds instructions, and sometimes scripts or reference files, that the agent loads when a task matches the skill's description ([what is SKILL.md](/blog/what-is-skill-md)).

Claude Code already has a plan mode. What it lacks is a method. Left alone, an agent tends to guess what you meant, fill the gaps with its own assumptions, and start writing code early. The skills below slow that down.

**Interview skills** make the agent ask before it builds. They work through open decisions one round at a time and keep going until nothing is left assumed.

**Spec and PRD skills** give the agent a document to produce: objectives, scope, non-goals, success criteria and open questions. That document becomes the shared reference for you, your team and the agent.

**Plan skills** take an agreed scope and break it into ordered tasks, each with a way to check it's done.

None of them is an MCP server. A skill gives the agent know-how. An MCP server gives it access to a system ([Agent Skills vs MCP](/blog/agent-skills-vs-mcp)). If you want the plan carried out by separate agents, see [Claude Code subagents vs skills](/blog/claude-code-subagents-vs-skills).

## How we ranked these skills

We looked at the most-installed skills on skills.sh whose main job is planning: questioning an idea, writing a spec or PRD, or writing an implementation plan. We kept one skill per repository and used four public criteria. All numbers were collected on October 28, 2026.

1. **Adoption**: all-time installs reported by [skills.sh](https://skills.sh), the open leaderboard for Agent Skills, through its public search API.
2. **Maintainer**: who maintains the skill, and the GitHub stars of its repository. Stars count the whole repository, not the individual skill.
3. **License clarity**: whether the skill or its repository declares an open-source license.
4. **Scope fit**: whether the skill questions an idea, writes a document, or writes a task plan.

Adoption sets the order. The other criteria are shown for every skill so you can weigh them yourself. We left out skills written for a single product or framework, and copies of the same skill republished under other accounts. Skillpack isn't ranked. The Vibe Company, the author's company, builds Skillpack, the open-source tool used here to install and share skills. It only appears in the install commands.

## The best Claude Code skills for planning in 2026

Install counts change every day, so treat this as a snapshot from October 28, 2026. Each command below points at the skill's real folder on GitHub. We ran every one through the Skillpack CLI in dry-run mode on that date. Add `--scope project` to install it in the current repo for Claude Code, Codex and OpenCode. Add `--share-org` to publish a copy to your Skillpack organization.

```skill-card
rank: 1
name: grill-me
maintainer: "Matt Pocock"
bestFor: "stress-testing a plan before anyone writes code"
source: { label: mattpocock/skills, url: "https://github.com/mattpocock/skills/tree/main/skills/productivity/grilling" }
repoStars: "305.2K"
installs:
  count: "1.45M"
  url: "https://skills.sh/mattpocock/skills/grill-me"
license:
  name: "MIT"
  note: "repository LICENSE"
focus: "Relentless interview"
install: "skillpack install github:mattpocock/skills/skills/productivity/grilling --scope project"
description: |
  grill-me is the most-installed planning skill on skills.sh, but its `SKILL.md` is only a few lines long. It tells the agent to call another skill, grilling, from the same repository (1.0M installs). Its `disable-model-invocation: true` line means the agent never loads it on its own. You type it when you want it. Install grilling too, or install only grilling, as in the command above.

  grilling is where the method lives. The agent maps your plan as a tree of decisions. Each round, it asks every question it can ask without guessing an earlier answer, numbers them and gives its own recommended answer for each. You reply, the tree changes, and the next round starts. Facts it can find in your code or tools, it sends a sub-agent to look up. Decisions stay with you.

  The session ends only when every branch is visited and you confirm a shared understanding. That makes it slow on small tasks, which is the point.
suitedFor: |
  developers who know what they want in broad strokes and want the agent to find the questions they haven't answered yet.
```

```skill-card
rank: 2
name: brainstorming
maintainer: "Jesse Vincent (obra)"
bestFor: "turning a vague request into an approved design doc"
source: { label: obra/superpowers, url: "https://github.com/obra/superpowers/tree/main/skills/brainstorming" }
repoStars: "306.8K"
installs:
  count: "408.5K"
  url: "https://skills.sh/obra/superpowers/brainstorming"
license:
  name: "MIT"
  note: "repository LICENSE"
focus: "Design doc before code"
install: "skillpack install github:obra/superpowers/skills/brainstorming --scope project"
description: |
  This skill comes from Superpowers, Jesse Vincent's collection of workflow skills. Its description tells the agent to use it before any creative work, in software or not. The first step is a check: if everything needed is in the request, the agent just does the task. If something important is missing, it starts a conversation.

  Before writing any code, the agent must lay out the possible approaches and let you pick one, write a design doc (short or full), and get your approval. The doc is saved under `docs/superpowers/specs/` and committed. In an existing project, it reads the code and files you pointed at before asking anything.

  It can also open a browser tab to show mockups and diagrams. That "visual companion" runs a small local server, and the Skillpack CLI lists those scripts as executable files before copying anything. When the doc is approved, it hands off to [writing-plans](https://skills.sh/obra/superpowers/writing-plans) (286.4K installs), which turns the design into bite-sized tasks. Install both.
suitedFor: |
  teams who want a written, approved design for every non-trivial change, and a plan that follows from it.
```

```skill-card
rank: 3
name: spec-driven-development
maintainer: "Addy Osmani"
bestFor: "a spec, a plan and a task list, each reviewed by a human"
source: { label: addyosmani/agent-skills, url: "https://github.com/addyosmani/agent-skills/tree/main/skills/spec-driven-development" }
repoStars: "111.3K"
installs:
  count: "66.4K"
  url: "https://skills.sh/addyosmani/agent-skills/spec-driven-development"
license:
  name: "MIT"
  note: "repository LICENSE"
focus: "Gated spec workflow"
install: "skillpack install github:addyosmani/agent-skills/skills/spec-driven-development --scope project"
description: |
  Addy Osmani's skill runs four gated phases: specify, plan, tasks, implement. A human reviews each one before the next starts. It also says when to skip it: one-line fixes, typos and changes whose requirements are already clear.

  The spec template covers objective, tech stack, commands, project structure, code style, testing strategy, boundaries, success criteria and open questions. The plan goes to `tasks/plan.md` and the task list to `tasks/todo.md`. Each task gets acceptance criteria, a verification step and the files it touches, and no task should change more than about five files.

  It leans on other skills from the same repository. Task breakdown is delegated to [planning-and-task-breakdown](https://skills.sh/addyosmani/agent-skills/planning-and-task-breakdown) (65.7K installs), and implementation to its incremental and TDD skills. Install those too if you want the full flow.
suitedFor: |
  teams who want the spec, the plan and the tasks as files in the repo, with a review step between each.
```

```skill-card
rank: 4
name: prd
maintainer: "GitHub"
bestFor: "a complete PRD with user stories, technical specs and risks"
source: { label: github/awesome-copilot, url: "https://github.com/github/awesome-copilot/tree/main/skills/prd" }
repoStars: "40.5K"
installs:
  count: "24.1K"
  url: "https://skills.sh/github/awesome-copilot/prd"
license:
  name: "MIT"
  note: "declared in SKILL.md and the repository"
focus: "Full PRD schema"
install: "skillpack install github:github/awesome-copilot/skills/prd --scope project"
description: |
  This PRD skill comes from awesome-copilot, GitHub's community collection for Copilot. It's a plain `SKILL.md`, so it works in Claude Code too. Before writing anything, the agent must interview you about the core problem, success metrics and constraints such as budget, stack or deadline.

  The document follows a fixed five-part schema: executive summary, user experience and functionality, AI system requirements when they apply, technical specifications, and risks and roadmap. A quality section asks for measurable criteria and shows vague and concrete versions side by side.

  What sets it apart is the AI features section. If you're specifying an LLM-powered feature, it asks for the AI requirements and an evaluation plan. For a small change, the schema can feel heavy.
suitedFor: |
  product and engineering teams who want one long-form PRD that covers business goals and technical detail, including AI features.
```

```skill-card
rank: 5
name: create-prd
maintainer: "Paweł Huryn"
bestFor: "a lean, one-to-two-page PRD the team can read in minutes"
source: { label: phuryn/pm-skills, url: "https://github.com/phuryn/pm-skills/tree/main/pm-execution/skills/create-prd" }
repoStars: "27.5K"
installs:
  count: "10.8K"
  url: "https://skills.sh/phuryn/pm-skills/create-prd"
license:
  name: "MIT"
  note: "repository LICENSE"
focus: "Lean PRD"
install: "skillpack install github:phuryn/pm-skills/pm-execution/skills/create-prd --scope project"
description: |
  create-prd is part of Paweł Huryn's pm-skills, a collection for product managers. It's lean by default: about one to two pages, roughly 600 to 1,000 words. You get a longer version only if you ask for it.

  If the problem, the target users or the success metric is missing, the agent stops and asks up to three short questions, with no PRD in that reply. It can search the web for market and competitor context, and cites its sources. The template has eight sections, including market segments and a six-part value proposition based on jobs to be done.

  Its rules against padding are the part we liked most. No "TBD", no placeholder roles, and nothing invented. It can also review an existing PRD.
suitedFor: |
  product managers and founders who want a short PRD that gets a team to start, not a long spec.
```

```skill-card
rank: 6
name: product-brainstorming
maintainer: "Anthropic"
bestFor: "exploring a product problem before deciding what to build"
source: { label: anthropics/knowledge-work-plugins, url: "https://github.com/anthropics/knowledge-work-plugins/tree/main/product-management/skills/product-brainstorming" }
repoStars: "33.5K"
installs:
  count: "5.7K"
  url: "https://skills.sh/anthropics/knowledge-work-plugins/product-brainstorming"
license:
  name: "Apache 2.0"
  note: "repository LICENSE"
focus: "Product thinking partner"
install: "skillpack install github:anthropics/knowledge-work-plugins/product-management/skills/product-brainstorming --scope project"
description: |
  This skill is part of Anthropic's product management plugin in knowledge-work-plugins. It casts the agent as a sharp product thinking partner. The skill tells the agent to push back and bring unexpected angles, rather than churn out deliverables.

  It has four modes: problem exploration, solution ideation, assumption testing and strategy exploration. Each lists what to do and which questions to ask. It also describes frameworks the agent can pull in, including How Might We, jobs to be done, opportunity solution trees, first principles and SCAMPER.

  It sits one step earlier than the rest of this list. Use it to decide what's worth building. Then use a spec or PRD skill to write it down.
suitedFor: |
  product managers who want a sparring partner for an idea, before any spec or code exists.
```

```skill-card
rank: 7
name: ce-plan
maintainer: "Every"
bestFor: "turning agreed requirements into a durable implementation plan"
source: { label: everyinc/compound-engineering-plugin, url: "https://github.com/everyinc/compound-engineering-plugin/tree/main/skills/ce-plan" }
repoStars: "25.7K"
installs:
  count: "3.8K"
  url: "https://skills.sh/everyinc/compound-engineering-plugin/ce-plan"
license:
  name: "MIT"
  note: "repository LICENSE"
focus: "How, not what"
install: "skillpack install github:everyinc/compound-engineering-plugin/skills/ce-plan --scope project"
description: |
  ce-plan comes from Every's Compound Engineering plugin. It splits the work cleanly: `ce-brainstorm` decides what to build, `ce-plan` decides how, and `ce-work` carries it out. ce-plan never implements. It researches, decides and writes the plan.

  It first sizes the request. A small change gets a few sentences in chat, bounded work gets a short brief, and anything with real decisions or risk gets a full plan file. Authentication, payments, migrations and external contracts always get the full plan. It asks one question at a time.

  It's the most involved skill here. The `SKILL.md` sends the agent to several reference files in the folder, and the folder includes scripts that the Skillpack CLI lists as executable. It also assumes the rest of the plugin for the steps before and after.
suitedFor: |
  teams already using Compound Engineering, or anyone who wants plans sized to the risk of the change.
```

A few skills just missed the list. Warp's [write-product-spec](https://skills.sh/warpdotdev/common-skills/write-product-spec) (28.7K installs) is well written but describes specs for Warp itself. BMad's [bmad-brainstorming](https://skills.sh/bmad-code-org/bmad-method/bmad-brainstorming) (12.4K) expects the BMad method to be set up in the project. Matt Pocock's [to-prd](https://skills.sh/mattpocock/skills/to-prd) (351.6K) turns a conversation into a PRD, but we kept one skill per repository.

## Side-by-side comparison

Ranked by adoption, with maintainer, license and scope shown for each skill. Data from skills.sh and GitHub, collected October 28, 2026. Stars are for each skill's whole GitHub repository.

```skill-comparison
```

```cta
title: "Agreed on how your team plans?"
text: "Put your planning skills in one Skillpack workspace and pin them to an exact commit in `.companion/skills.lock.json`, so every developer's agent asks the same questions and writes the same docs."
primary: { label: "Start free", href: /login }
secondary: { label: "How to share Claude Code skills with your team", href: /blog/how-to-share-claude-code-skills-with-your-team }
```

## Which planning skill fits your use case

```use-cases
rows:
  - useCase: "A plan you want challenged before coding"
    start: "grill-me (with grilling)"
    add: "writing-plans"
    why: "Every decision settled, then turned into tasks"
  - useCase: "Every feature starts with an approved design"
    start: "brainstorming"
    add: "writing-plans"
    why: "Approaches, a design doc you approve, then a task plan"
  - useCase: "Spec, plan and tasks as files in the repo"
    start: "spec-driven-development"
    add: "planning-and-task-breakdown"
    why: "Gated phases with a review between each"
  - useCase: "A full PRD for an AI feature"
    start: "prd"
    add: "grill-me (with grilling)"
    why: "AI requirements and evals, with gaps found up front"
  - useCase: "A short PRD to get the team moving"
    start: "create-prd"
    add: "product-brainstorming"
    why: "One to two pages, after the idea has been pressure-tested"
  - useCase: "Plans sized to how risky the change is"
    start: "ce-plan"
    add: "brainstorming"
    why: "A few lines for small work, a full plan for risky work"
```

## How to install and share these skills with your team

Each command above installs a public GitHub folder with the Skillpack CLI, without an account. The CLI resolves the branch or tag to an exact commit, shows you the source and any executable files, and asks before copying anything. It never runs package scripts. With `--scope project`, the skill lands in `.agents/skills/`, which OpenCode reads, with managed copies in `.claude/skills/` for Claude Code and `.codex/skills/` for Codex. The exact commit is recorded in `.companion/skills.lock.json`. Commit that lockfile, and `skillpack sync --frozen` gives every teammate and every CI run the same files ([full install guide](/blog/how-to-install-skills-in-claude-code)).

Planning is where version drift shows up first. If one developer's agent asks five rounds of questions and another's jumps straight to code, your specs and plans stop looking alike, and reviews get harder.

A skill can also be installed by hand: copy its folder into `.claude/skills/` in your repository, and Claude Code picks it up. Nothing records which commit you copied, though, so keeping teammates on the same version is up to you.

To share a skill with your organization, add `--share-org`. Once the CLI is signed in to your Skillpack workspace, it publishes a copy there and keeps the license and GitHub provenance. It refuses to overwrite an organization skill that already has the same name:

```bash
skillpack install github:obra/superpowers/skills/brainstorming --scope project --share-org
```

Skillpack is open source (MIT) and can run on your own infrastructure. For other use cases, see our rankings for [testing](/blog/best-claude-code-skills-testing), [code review](/blog/best-claude-code-skills-code-review) and [frontend design](/blog/best-claude-code-skills-frontend-design), the [overall top Claude Code skills](/blog/best-claude-code-skills), or [write your own skill](/blog/how-to-create-a-claude-code-skill).

## FAQ

```faq
items:
  - question: "What is the best Claude Code skill for planning?"
    answer: "By installs on skills.sh, it's Matt Pocock's grill-me, with 1.45M installs on October 28, 2026. It interviews you about a plan until every decision is settled. Install it with grilling, the skill it calls."
  - question: "What's the difference between grill-me and brainstorming?"
    answer: "grill-me asks rounds of numbered questions with recommended answers until you confirm a shared understanding. brainstorming has the agent propose approaches, write a design doc and get your approval, then hands off to writing-plans."
  - question: "Is there a PRD skill for Claude Code?"
    answer: "Yes. GitHub's prd skill from awesome-copilot writes a full five-part PRD. Paweł Huryn's create-prd writes a lean one-to-two-page version. Both ask you questions before writing."
  - question: "Doesn't Claude Code already have a plan mode?"
    answer: "It does, and these skills work alongside it. Plan mode stops the agent from editing files. A planning skill gives it a method: which questions to ask, which document to write, and when it may start coding."
  - question: "How do I install a planning skill in Claude Code?"
    answer: "Run `skillpack install github:owner/repo/path`, for example `skillpack install github:obra/superpowers/skills/brainstorming`. Add `--scope project` to install it in the current repository. You can also copy the skill's folder into `.claude/skills/` by hand."
  - question: "Do these planning skills work with Codex and Cursor?"
    answer: "They're plain `SKILL.md` folders, so they work in any agent that reads Agent Skills. See [how to use skills in Codex](/blog/how-to-use-skills-in-codex) and [how to use skills in Cursor](/blog/how-to-use-skills-in-cursor)."
  - question: "What licenses do these skills use?"
    answer: "Six declare MIT and one, Anthropic's product-brainstorming, uses Apache 2.0 through its repository."
```

## Try Skillpack for free

Picking a planning skill is half the job. The other half is getting every developer's agent to use the same one. Skillpack installs any public skill from GitHub with one command and pins the exact commit in a lockfile you can commit. It shares skills with your whole organization, with license and source kept. It's open source. [Create your free Skillpack workspace](/login) and share your first skill in a few minutes.

```cta
title: "Your team's skills, in one place."
primary: { label: "Sign up free for Skillpack", href: /login }
sticky: true
```
