---
title: "Best Claude Code Skills in 2026: 9 Ranked by Installs"
description: "The best Claude Code skills in 2026, ranked by skills.sh installs: find-skills, grill-me, agent-browser, frontend-design and more, with install commands."
slug: best-claude-code-skills
date: 2026-10-22
tags: ["Claude Code", "Agent Skills", "Skills List"]
author: "Stan Girard"
authorRole: "co-founder of The Vibe Company, which builds Skillpack"
layout: ranking
dataCollected: 2026-10-22
---

# The Best Claude Code Skills in 2026

The most-installed Claude Code skill in 2026 is Vercel's **find-skills**, with 3.98M installs on skills.sh. It helps the agent find other skills for you. Matt Pocock's **grill-me** comes next, then Vercel's **agent-browser**. This page ranks nine general-purpose skills, one per repository and one per job, from planning and browser automation to design, video, SEO and testing. Each one comes with a command to install it and share it with your team.

```cta
title: "Install any skill on this page with one command, and share it with your team."
text: "`skillpack install github:mattpocock/skills/skills/productivity/grill-me` works without an account. Create a free Skillpack workspace to share skills across your organization."
primary: { label: "Create a free Skillpack workspace", href: /login }
```

```takeaways
title: Key Takeaways
items:
  - lead: "Start with a process skill, not a pile of skills."
    text: "grill-me and brainstorming make the agent ask before it builds. That changes more of your results than any single domain skill."
  - lead: "Several top skills are thin wrappers around a CLI."
    text: "agent-browser, hyperframes and playwright-cli expect their own command-line tool to be installed. The skill only teaches the agent to drive it."
  - lead: "Some skills call other skills."
    text: "grill-me hands off to grilling, and brainstorming ends by calling writing-plans. Install the pair, or the shortcut does nothing."
  - lead: "High install counts aren't always real adoption."
    text: "We left out skills whose counts don't match their repository, like near-empty repos with a million installs."
  - lead: "A skill only helps a team if everyone runs the same version."
    text: "Pin the exact commit in a lockfile that lives in the repo."
```

## What a Claude Code skill is, in one paragraph

A Claude Code skill is a folder with a `SKILL.md` file. It holds instructions, and sometimes scripts or reference files. Claude Code only sees each skill's name and description at first, and loads the rest when a task matches ([what is SKILL.md](/blog/what-is-skill-md)). A skill teaches the agent how to do a job. An MCP server gives it access to a system ([Agent Skills vs MCP](/blog/agent-skills-vs-mcp)). None of the nine skills below needs an MCP server.

## How we ranked these skills

We started from the all-time leaderboard on [skills.sh](https://skills.sh), the open directory for Agent Skills, on October 22, 2026. Then we applied five filters, in this order:

1. **One skill per repository.** Otherwise a single author fills the list. Matt Pocock alone has 16 skills above 750K installs.
2. **One skill per job.** Design, video and code review each have a dedicated ranking page, so they get one entry here.
3. **Works in any project.** We skipped skills that only make sense with one vendor's product or one framework, such as Lark, Azure, Supabase or React.
4. **Believable numbers.** We dropped skills whose installs don't match their repository, and skill copies published under several accounts.
5. **Installs with one command.** Every skill below was installed with the Skillpack CLI from its GitHub folder.

Adoption then sets the order. Stars, license and last activity are shown for each skill so you can weigh them yourself. Skillpack isn't ranked. The Vibe Company, the author's company, builds Skillpack, the open-source tool used here to install and share skills, and it only appears in the install commands.

## The best Claude Code skills in 2026

Install counts change every day, so treat this as a snapshot from October 22, 2026. Each command points at the skill's real folder on GitHub. Add `--scope project` to install it in the current repo for Claude Code, Codex and OpenCode, and `--share-org` to publish a copy to your Skillpack organization.

```skill-card
rank: 1
name: find-skills
maintainer: "Vercel"
bestFor: "finding an existing skill before you write one"
source: { label: vercel-labs/skills, url: "https://github.com/vercel-labs/skills/tree/main/skills/find-skills" }
repoStars: "36.0K"
installs:
  count: "3.98M"
  url: "https://skills.sh/vercel-labs/skills/find-skills"
license:
  name: "MIT"
  note: "repository LICENSE"
focus: "Skill discovery"
install: "skillpack install github:vercel-labs/skills/skills/find-skills --scope project"
description: |
  find-skills turns the agent into a skill scout. Ask "how do I do X" or "is there a skill for X", and it checks the skills.sh leaderboard first. Then it searches with `npx skills find <query>`, from Vercel's Skills CLI.

  The useful part is its quality bar. Before recommending anything, the agent checks three things. Installs: prefer 1K+, be careful under 100. Source: official publishers first. Stars: be skeptical of repositories under 100. It then shows you the skill, its installs, the command and a skills.sh link.

  Know what it does next. If you say yes, it installs with `npx skills add <owner/repo@skill> -g -y`, which is global and skips the confirmation prompt. If you'd rather review a skill before it lands, ask the agent to stop at the recommendation.
suitedFor: |
  anyone who wants the agent to look for an existing skill before writing one from scratch. Less useful if your team only installs skills it has already reviewed.
```

```skill-card
rank: 2
name: grill-me
maintainer: "Matt Pocock"
bestFor: "stress-testing a plan before any code is written"
source: { label: mattpocock/skills, url: "https://github.com/mattpocock/skills/tree/main/skills/productivity/grill-me" }
repoStars: "300.2K"
installs:
  count: "1.41M"
  url: "https://skills.sh/mattpocock/skills/grill-me"
license:
  name: "MIT"
  note: "repository LICENSE"
focus: "Planning interview"
install: "skillpack install github:mattpocock/skills/skills/productivity/grill-me --scope project"
description: |
  grill-me is "a relentless interview to sharpen a plan or design". You call it with `/grill-me`, since it sets `disable-model-invocation: true` and Claude never runs it on its own.

  The folder is a one-line shortcut. Its only instruction is to call another skill, **grilling**, from the same repository. So install both, or the command has nothing to run: `skillpack install github:mattpocock/skills/skills/productivity/grilling --scope project`.

  grilling is where the method lives. The agent maps your plan as a design tree. Each round, it asks every question that can be settled now, numbered, with its recommended answer. Questions are worded so that "yes" accepts the recommendation. Facts it can look up itself, it sends a sub-agent to find. It doesn't act until you agree the tree is fully explored.
suitedFor: |
  developers who keep getting a fast, confident build of the wrong thing. It costs a few minutes of questions per feature, which is the point.
```

```skill-card
rank: 3
name: agent-browser
maintainer: "Vercel"
bestFor: "letting the agent drive a real browser"
source: { label: vercel-labs/agent-browser, url: "https://github.com/vercel-labs/agent-browser/tree/main/skills/agent-browser" }
repoStars: "44.4K"
installs:
  count: "1.21M"
  url: "https://skills.sh/vercel-labs/agent-browser/agent-browser"
license:
  name: "Apache 2.0"
  note: "repository LICENSE"
focus: "Browser automation"
install: "skillpack install github:vercel-labs/agent-browser/skills/agent-browser --scope project"
description: |
  agent-browser lets the agent open pages, fill forms, click, take screenshots and pull data from websites. It drives Chrome or Chromium over the DevTools protocol, through a Rust CLI with no Playwright or Puppeteer dependency. Pages come back as accessibility-tree snapshots with short element refs like `@e3`.

  The skill itself is a stub. It tells the agent to install the CLI (`npm i -g agent-browser && agent-browser install`) and then load the real instructions from it with `agent-browser skills get core`. Vercel's reasoning is that the CLI serves guides that always match the installed version. Extra guides cover Electron apps, Slack, exploratory QA and cloud browsers.

  Two things to know. Its frontmatter pre-approves `agent-browser` commands through `allowed-tools`. Its description also tells the agent to prefer it over any built-in browser tool, so it will take over browsing tasks once installed.
suitedFor: |
  teams that want the agent to check its own work in a browser, reproduce bugs or automate web chores. You need Node.js to install the CLI.
```

```skill-card
rank: 4
name: hyperframes
maintainer: "HeyGen"
bestFor: "turning a brief, a URL or a PR into a video"
source: { label: heygen-com/hyperframes, url: "https://github.com/heygen-com/hyperframes/tree/main/skills/hyperframes" }
repoStars: "69.4K"
installs:
  count: "1.14M"
  url: "https://skills.sh/heygen-com/hyperframes/hyperframes"
license:
  name: "Apache 2.0"
  note: "repository LICENSE"
focus: "Video from HTML"
install: "skillpack install github:heygen-com/hyperframes/skills/hyperframes --scope project"
description: |
  HyperFrames is HeyGen's open-source framework for rendering video from HTML, and this skill is its front door. It calls itself the "mandatory entry point" for any request to make, edit, animate or render a video. Its sister skill hyperframes-cli has slightly more installs (1.18M), but it's the reference for the CLI, so we list the entry point.

  For a new video, it runs a short intent interview and writes a `BRIEF.md`. It then routes to one of ten workflows, from product launch videos and explainers to captions, PR-to-video and Remotion ports.

  It depends on the HyperFrames CLI, which installs each workflow with `npx hyperframes skills update <workflow>`. Your Skillpack lockfile doesn't track those workflow files. The folder also ships Node scripts, which the Skillpack CLI lists before it copies anything.
suitedFor: |
  marketers and developers who want finished videos from a prompt or a website. For Remotion, GSAP and motion design skills, see [the video and motion design ranking](/blog/best-claude-code-skills-video-motion-design).
```

```skill-card
rank: 5
name: frontend-design
maintainer: "Anthropic"
bestFor: "UI that doesn't look AI-generated"
source: { label: anthropics/skills, url: "https://github.com/anthropics/skills/tree/main/skills/frontend-design" }
repoStars: "182.8K"
installs:
  count: "1.02M"
  url: "https://skills.sh/anthropics/skills/frontend-design"
license:
  name: "Apache 2.0"
  note: "LICENSE.txt in the skill folder; the repository has no top-level license"
focus: "Visual design direction"
install: "skillpack install github:anthropics/skills/skills/frontend-design --scope project"
description: |
  frontend-design is Anthropic's answer to generic, templated UI. It casts Claude as the design lead of a studio whose client "has already rejected proposals that felt cliché or templated". It asks for deliberate choices about palette, typography and layout.

  The rules are specific. The agent identifies the product and audience before designing, keeps line lengths under 80 characters, and avoids the usual tells of a generated page. Those include accenting one word in a headline, all-caps labels, and numbered markers on content that isn't a sequence. It then plans, builds and critiques its own work against the brief.

  It's a direction skill, not a component library or a checklist. It won't pick your design system for you.
suitedFor: |
  anyone building a new UI or reshaping one that feels bland. We compared seven design skills in [the frontend design ranking](/blog/best-claude-code-skills-frontend-design).
```

```skill-card
rank: 6
name: caveman
maintainer: "Julius Brussee"
bestFor: "shorter answers that keep every technical detail"
source: { label: juliusbrussee/caveman, url: "https://github.com/juliusbrussee/caveman/tree/main/skills/caveman" }
repoStars: "114.2K"
installs:
  count: "586.2K"
  url: "https://skills.sh/juliusbrussee/caveman/caveman"
license:
  name: "Apache 2.0"
  note: "repository LICENSE"
focus: "Terse output style"
install: "skillpack install github:juliusbrussee/caveman/skills/caveman --scope project"
description: |
  caveman changes how the agent talks, not what it does. Its description sums it up: "answer first, fluff gone, every technical fact kept". Turn it on with `/caveman` or "be brief", and it stays on for the session until you say "stop caveman" or "normal mode".

  The name oversells the gimmick. The rules ban greetings, recaps, hedging and filler words, and cap sentences at 20 words. They also forbid dropping "not", "never" or "only", and keep code, commands, paths and errors verbatim. It switches back to full sentences for security warnings, irreversible actions and questions to you.

  Anything written outside the chat stays in normal prose: code, comments, commits, docs and PRs. The `/caveman ultra` and `/caveman wenyan` modes point to other skills in the same repository, which this folder doesn't include.
suitedFor: |
  developers who read the agent's output in a terminal all day and want less to scroll through. Skip it if you want explanations aimed at beginners.
```

```skill-card
rank: 7
name: brainstorming
maintainer: "Jesse Vincent (obra)"
bestFor: "agreeing on a design before the agent builds"
source: { label: obra/superpowers, url: "https://github.com/obra/superpowers/tree/main/skills/brainstorming" }
repoStars: "303.3K"
installs:
  count: "401.3K"
  url: "https://skills.sh/obra/superpowers/brainstorming"
license:
  name: "MIT"
  note: "repository LICENSE"
focus: "Design-first workflow"
install: "skillpack install github:obra/superpowers/skills/brainstorming --scope project"
description: |
  brainstorming is the first step of Superpowers, Jesse Vincent's development methodology. Its description says the agent "MUST use this before any creative work". Its premise is that the agent's idea of what you want "is usually thinner than it feels".

  The agent reads the code and anything you pointed at before its first question. It then asks about the one thing your request leaves open and lays out two or three approaches for you to pick from. Next comes a design doc, short for a small change and full for a project. Nothing gets built until you approve that doc, which it saves under `docs/superpowers/specs/`.

  It's part of a chain. Once the design is approved, it calls the `writing-plans` skill from the same repository, so install that too or use the whole Superpowers set. The folder also ships a small local server for an optional visual companion, which the Skillpack CLI lists as executable files.
suitedFor: |
  teams who want a written design for every feature. It overlaps with grill-me, so most people pick one of the two.
```

```skill-card
rank: 8
name: seo-audit
maintainer: "Corey Haines"
bestFor: "a prioritized technical and on-page SEO audit"
source: { label: coreyhaines31/marketingskills, url: "https://github.com/coreyhaines31/marketingskills/tree/main/skills/seo-audit" }
repoStars: "55.9K"
installs:
  count: "234.2K"
  url: "https://skills.sh/coreyhaines31/marketingskills/seo-audit"
license:
  name: "MIT"
  note: "repository LICENSE"
focus: "SEO audit"
install: "skillpack install github:coreyhaines31/marketingskills/skills/seo-audit --scope project"
description: |
  seo-audit is the most-installed skill from Marketing Skills, Corey Haines' collection for marketers. It triggers on phrases like "why am I not ranking", "my traffic dropped" or "stuck on page 2".

  It audits in a fixed priority order: crawlability and indexation, technical foundations, on-page optimization, content quality, then authority. Every finding comes back with its impact, evidence, fix and priority, ending in an action plan. It reads a `.agents/product-marketing.md` file first if you have one, so it doesn't ask what it already knows.

  It's honest about its limits. It warns that `curl` and web fetches can miss JSON-LD added by JavaScript, and sends you to the Rich Results Test for schema. It also treats fetched pages as untrusted data, a sensible guard against prompt injection.
suitedFor: |
  founders and marketers who want a structured audit of their own site. Pair it with Search Console data for real traffic numbers.
```

```skill-card
rank: 9
name: playwright-cli
maintainer: "Microsoft"
bestFor: "browser testing with Playwright, token-light"
source: { label: microsoft/playwright-cli, url: "https://github.com/microsoft/playwright-cli/tree/main/skills/playwright-cli" }
repoStars: "14.5K"
installs:
  count: "192.7K"
  url: "https://skills.sh/microsoft/playwright-cli/playwright-cli"
license:
  name: "Apache 2.0"
  note: "repository LICENSE"
focus: "Playwright from the CLI"
install: "skillpack install github:microsoft/playwright-cli/skills/playwright-cli --scope project"
description: |
  playwright-cli is Microsoft's skill for the Playwright CLI. The agent opens a browser, navigates, clicks and fills elements by ref, and works with tabs, storage, network and DevTools from short commands.

  Microsoft's README explains why it exists next to Playwright MCP. CLI calls are more token-efficient, since the agent doesn't load large tool schemas or full accessibility trees. MCP stays the better fit for long, stateful sessions like self-healing tests.

  You need Node.js 18 or newer and the CLI itself (`npm install -g @playwright/cli@latest`). Its frontmatter pre-approves `playwright-cli` and `npx playwright` commands through `allowed-tools`.
suitedFor: |
  teams that already use Playwright for tests and want the agent to work in the same tool. If you don't, agent-browser covers similar ground.
```

A few skills just missed the list. leonxlnx's [design-taste-frontend](https://skills.sh/leonxlnx/taste-skill/design-taste-frontend) (656.0K installs) and Next Level Builder's [ui-ux-pro-max](https://skills.sh/nextlevelbuilder/ui-ux-pro-max-skill/ui-ux-pro-max) (408.6K) are strong design picks, but design already has its entry. Vercel's [vercel-react-best-practices](https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices) (827.4K) only applies to React. Remotion's [remotion-best-practices](https://skills.sh/remotion-dev/skills/remotion-best-practices) (660.6K) is covered in the video ranking. For code review, see [the code review ranking](/blog/best-claude-code-skills-code-review).

We also left out two skills with around a million installs each, from repositories with about 20 GitHub stars. Same for AI video and image skills copied under several accounts. Those counts don't look like real adoption.

## Side-by-side comparison

Ranked by adoption, with maintainer, license and scope shown for each skill. Data from skills.sh and GitHub, collected October 22, 2026. Stars are for each skill's whole GitHub repository.

```skill-comparison
```

```cta
title: "Picked your starter set?"
text: "Put your team's skills in one Skillpack workspace and pin them to an exact commit in `.companion/skills.lock.json`, so every developer, laptop and CI run uses the same ones."
primary: { label: "Start free", href: /login }
secondary: { label: "How to share Claude Code skills with your team", href: /blog/how-to-share-claude-code-skills-with-your-team }
```

## Which skill fits your use case

```use-cases
rows:
  - useCase: "The agent builds the wrong thing"
    start: "grill-me"
    add: "brainstorming"
    why: "Questions before code, then a written design if the work is big"
  - useCase: "Checking UI changes in a browser"
    start: "agent-browser"
    add: "playwright-cli"
    why: "Quick manual checks, plus Playwright if your tests already use it"
  - useCase: "A new landing page or app UI"
    start: "frontend-design"
    add: "agent-browser"
    why: "A clear visual direction, then a look at the result in a real browser"
  - useCase: "Launch videos and explainers"
    start: "hyperframes"
    add: "frontend-design"
    why: "A full video workflow, with the same visual care as your site"
  - useCase: "Long sessions with too much text"
    start: "caveman"
    add: "grill-me"
    why: "Short answers, and short numbered questions when it needs input"
  - useCase: "Organic traffic for your product"
    start: "seo-audit"
    add: "find-skills"
    why: "A prioritized audit, then other marketing skills when you need them"
```

## How to install and share these skills with your team

Each command above installs a public GitHub folder with the Skillpack CLI, without an account. The CLI resolves the branch to an exact commit and shows you the source and any executable files. It asks before copying anything and never runs package scripts. With `--scope project`, the skill lands in `.agents/skills/`, which OpenCode reads, with managed copies in `.claude/skills/` for Claude Code and `.codex/skills/` for Codex. The commit goes into `.companion/skills.lock.json`. Commit that lockfile, and `skillpack sync --frozen` gives every teammate and every CI run the same files ([full install guide](/blog/how-to-install-skills-in-claude-code)).

These skills aren't Claude Code-only. The same folders work in Codex, which reads `SKILL.md` too ([Codex skills guide](/blog/how-to-use-skills-in-codex)).

A skill can also be installed by hand: copy its folder into `.claude/skills/` in your repository, and Claude Code picks it up. Nothing records which commit you copied, though, so keeping teammates on the same version is up to you.

To share a skill with your organization, add `--share-org`. Once the CLI is signed in to your Skillpack workspace, it publishes a copy there and keeps the license and GitHub provenance. It refuses to overwrite an organization skill that already has the same name:

```bash
skillpack install github:mattpocock/skills/skills/productivity/grill-me --scope project --share-org
```

Can't find a skill for your job? [Write your own](/blog/how-to-create-a-claude-code-skill). Skillpack is open source (MIT) and can run on your own infrastructure.

## FAQ

```faq
items:
  - question: "What are the best Claude Code skills?"
    answer: "By installs on skills.sh on October 22, 2026, the top general-purpose skills are find-skills (3.98M), grill-me (1.41M), agent-browser (1.21M), hyperframes (1.14M) and frontend-design (1.02M). The best set for you depends on your work: planning, browser checks, design, video, SEO or testing."
  - question: "How do I install a Claude Code skill?"
    answer: "Run `skillpack install github:owner/repo/path`, for example `skillpack install github:anthropics/skills/skills/frontend-design`. Add `--scope project` to install it in the current repository. You can also copy the skill's folder into `.claude/skills/` by hand."
  - question: "Where can I find Claude Code skills?"
    answer: "skills.sh lists public Agent Skills with install counts. Most skills live in GitHub repositories as folders with a `SKILL.md` file, such as anthropics/skills, mattpocock/skills or obra/superpowers. The find-skills skill can also search for you."
  - question: "How many skills should I install?"
    answer: "Fewer than you think. Claude Code shows every installed skill's description to the model, so a long list costs context and can make the wrong skill trigger. Start with two or three that match work you do every week."
  - question: "Are Claude Code skills safe to install?"
    answer: "Treat them like a new dependency. Read the `SKILL.md`, any scripts and the `allowed-tools` field, which pre-approves commands. agent-browser, playwright-cli and frontend-design come from Vercel, Microsoft and Anthropic. Four of the nine skills here come from individual developers."
  - question: "Do these skills work in Codex?"
    answer: "Yes. Codex reads the same `SKILL.md` format. A Skillpack project install writes the skill for Claude Code, Codex and OpenCode in one command. Skills that rely on Claude Code-only fields, like `disable-model-invocation`, may behave differently."
  - question: "How do I keep the same skills across my team?"
    answer: "Pin them to an exact commit in a lockfile committed to the repo, and share them through one workspace. See [how to share Claude Code skills with your team](/blog/how-to-share-claude-code-skills-with-your-team)."
```

## Try Skillpack for free

Once you've picked your starter set, the next step is making sure everyone uses the same one. Skillpack installs any public skill from GitHub with one command and pins the exact commit in a lockfile you can commit. It shares skills with your whole organization, with license and source kept. It's open source. [Create your free Skillpack workspace](/login) and share your first skill in a few minutes.

```cta
title: "Your team's skills, in one place."
primary: { label: "Sign up free for Skillpack", href: /login }
sticky: true
```
