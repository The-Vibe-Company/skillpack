---
title: "Best Claude Code Skills for Marketing & SEO (2026)"
description: "The 7 most-installed Claude Code marketing and SEO skills in 2026: seo-audit, seo-geo, Addy Osmani's seo and more, with install commands."
slug: best-claude-code-skills-marketing-seo
date: 2026-11-05
tags: ["Claude Code", "Agent Skills", "Marketing", "SEO", "GEO", "AEO"]
author: "Stan Girard"
authorRole: "co-founder of The Vibe Company, which builds Skillpack"
layout: ranking
dataCollected: 2026-11-05
---

# Best Claude Code Skills for Marketing and SEO in 2026

The most-installed Claude Code skill for marketing and SEO is Corey Haines' **seo-audit**, with 246.6K installs on skills.sh. It runs a prioritized technical and on-page audit and ends with an action plan. Next come **seo-geo** for SEO plus generative-engine optimization, and Addy Osmani's **seo** skill from web-quality-skills. The other four cover Firecrawl-backed audits, a full SEO hub, AEO best practices and Anthropic's marketing SEO audit. Each entry below has a one-line install command you can share with your team.

```cta
title: "Install any skill on this page with one command, and share it with your team."
text: "`skillpack install github:coreyhaines31/marketingskills/skills/seo-audit` works without an account. Create a free Skillpack workspace to share skills across your organization."
primary: { label: "Create a free Skillpack workspace", href: /login }
```

```takeaways
title: Key Takeaways
items:
  - lead: "Marketing and SEO skills do different jobs."
    text: "Some audit a live site (seo-audit, firecrawl-seo-audit). Some teach technical SEO or AEO principles (Addy Osmani's seo, Sanity's seo-aeo-best-practices). One hub routes many SEO sub-skills (AgriciDaniel's seo)."
  - lead: "One skill per repository."
    text: "Corey Haines' marketingskills repo alone has copywriting, ai-seo and programmatic-seo above 150K installs. We kept seo-audit, the top install in that repo, and diversified the rest."
  - lead: "Some skills need an API or CLI."
    text: "firecrawl-seo-audit expects a Firecrawl API key. seo-geo ships scripts that can call DataForSEO. Without those, you still get the method; you lose the automated pulls."
  - lead: "Install counts are a snapshot."
    text: "Numbers below come from the skills.sh search API on November 5, 2026. They change every day."
  - lead: "A skill only helps a team if everyone runs the same version."
    text: "Pin the exact commit in a lockfile that lives in the repo."
```

## What marketing and SEO skills actually do

A Claude Code skill is a folder with a `SKILL.md` file. It holds instructions, and sometimes scripts or reference files, that the agent loads when a task matches the skill's description ([what is SKILL.md](/blog/what-is-skill-md)).

Claude Code can already fetch a page and guess at SEO advice. What it lacks is a method: which checks first, what counts as evidence, and when to stop inventing rankings. The skills below fill that gap.

**Audit skills** walk a site in a fixed order and return findings with impact, evidence and a fix.

**Principle skills** give the agent a checklist for metadata, structured data, EEAT or answer-engine readiness, without tying you to one vendor's crawl product.

**Hub skills** route a vague "help with SEO" request to the right sub-skill or command.

None of them is an MCP server by itself. A skill gives the agent know-how. An MCP server gives it access to a system ([Agent Skills vs MCP](/blog/agent-skills-vs-mcp)). Some entries below work better when an MCP or CLI is also connected; we say so in each card.

For the general top list, see [best Claude Code skills](/blog/best-claude-code-skills). For planning and testing rankings, see [planning](/blog/best-claude-code-skills-planning) and [testing](/blog/best-claude-code-skills-testing).

## How we ranked these skills

We looked at the most-installed skills on skills.sh whose main job is marketing or SEO for builders: audits, on-page and technical SEO, GEO/AEO, or marketing copy workflows that sit next to SEO. We kept one skill per repository and used four public criteria. All numbers were collected on November 5, 2026.

1. **Adoption**: all-time installs reported by [skills.sh](https://skills.sh), the open leaderboard for Agent Skills, through its public search API.
2. **Maintainer**: who maintains the skill, and the GitHub stars of its repository. Stars count the whole repository, not the individual skill.
3. **License clarity**: whether the skill or its repository declares an open-source license.
4. **Scope fit**: whether the skill audits, teaches principles, or routes a broader SEO workflow.

Adoption sets the order. The other criteria are shown for every skill so you can weigh them yourself. We left out skills whose GitHub repository returns 404, signpost folders that no longer ship a real `SKILL.md`, and copies of the same skill republished under other accounts. Skillpack isn't ranked. The Vibe Company, the author's company, builds Skillpack, the open-source tool used here to install and share skills. It only appears in the install commands.

## The best Claude Code skills for marketing and SEO in 2026

Install counts change every day, so treat this as a snapshot from November 5, 2026. Each command below points at the skill's real folder on GitHub. We ran every one through the Skillpack CLI in dry-run mode on that date. Add `--scope project` to install it in the current repo for Claude Code, Codex and OpenCode. Add `--share-org` to publish a copy to your Skillpack organization.

```skill-card
rank: 1
name: seo-audit
maintainer: "Corey Haines"
bestFor: "a prioritized technical and on-page SEO audit"
source: { label: coreyhaines31/marketingskills, url: "https://github.com/coreyhaines31/marketingskills/tree/main/skills/seo-audit" }
repoStars: "58.6K"
installs:
  count: "246.6K"
  url: "https://skills.sh/coreyhaines31/marketingskills/seo-audit"
license:
  name: "MIT"
  note: "repository LICENSE"
focus: "Prioritized SEO audit"
install: "skillpack install github:coreyhaines31/marketingskills/skills/seo-audit --scope project"
description: |
  seo-audit is the most-installed marketing skill on skills.sh. It comes from Marketing Skills, Corey Haines' collection for marketers. It triggers on phrases like "why am I not ranking", "my traffic dropped" or "stuck on page 2".

  It audits in a fixed priority order: crawlability and indexation, technical foundations, on-page optimization, content quality, then authority. Every finding comes back with impact, evidence, fix and priority, ending in an action plan. If you keep a `.agents/product-marketing.md` file, it reads that first so it doesn't re-ask what it already knows.

  It's honest about its limits. It warns that `curl` and web fetches can miss JSON-LD added by JavaScript, and points you to the Rich Results Test for schema. It also treats fetched pages as untrusted data, a sensible guard against prompt injection. The same repository holds copywriting, ai-seo and programmatic-seo; we kept one skill per repository, so those stay off this ranking.
suitedFor: |
  founders and marketers who want a structured audit of their own site. Pair it with Search Console data for real traffic numbers.
```

```skill-card
rank: 2
name: seo-geo
maintainer: "resciencelab"
bestFor: "SEO plus GEO for AI search citations"
source: { label: resciencelab/opc-skills, url: "https://github.com/resciencelab/opc-skills/tree/main/skills/seo-geo" }
repoStars: "1.9K"
installs:
  count: "55.6K"
  url: "https://skills.sh/resciencelab/opc-skills/seo-geo"
license:
  name: "Apache 2.0"
  note: "repository LICENSE"
focus: "SEO + GEO workflow"
install: "skillpack install github:resciencelab/opc-skills/skills/seo-geo --scope project"
description: |
  seo-geo treats traditional SEO and generative-engine optimization as one workflow. It starts with a free technical check (title, meta, H1, robots, sitemap, load time), then covers schema, keyword research and AI-bot access in robots.txt.

  The Skillpack dry-run lists ten Python scripts in the folder, including keyword research, SERP analysis and DataForSEO helpers. Those scripts are optional. A basic audit runs without paid APIs. When you do wire credentials, the skill can pull domain and keyword data instead of guessing.

  The same skill also lives under `.agents/skills/seo-geo` in the repo. Both paths dry-run clean; the command above uses the `skills/` path.
suitedFor: |
  solopreneurs and small teams who care about Google rankings and citations in ChatGPT, Perplexity or AI Overviews.
```

```skill-card
rank: 3
name: seo
maintainer: "Addy Osmani"
bestFor: "Lighthouse-led technical SEO on real pages"
source: { label: addyosmani/web-quality-skills, url: "https://github.com/addyosmani/web-quality-skills/tree/main/skills/seo" }
repoStars: "3.0K"
installs:
  count: "53.9K"
  url: "https://skills.sh/addyosmani/web-quality-skills/seo"
license:
  name: "MIT"
  note: "declared in SKILL.md and the repository"
focus: "Evidence-led technical SEO"
install: "skillpack install github:addyosmani/web-quality-skills/skills/seo --scope project"
description: |
  Addy Osmani's seo skill sits in web-quality-skills, next to Core Web Vitals and related audits. It pushes an evidence-led workflow: run Lighthouse SEO when you can, then check headers, redirects, robots, sitemap coverage, canonicals and structured-data eligibility.

  It refuses to invent ranking-factor weights or promise traffic gains. A Lighthouse SEO score is framed as a useful subset of technical checks, not a prediction. Structured data checks cover syntax and eligibility signals, not guaranteed rich results.

  A reference file on structured data ships in the folder. Pair it with the Core Web Vitals skill from the same repository when page speed is part of the SEO story.
suitedFor: |
  engineers who already ship web apps and want SEO checks that match how they measure performance.
```

```skill-card
rank: 4
name: firecrawl-seo-audit
maintainer: "Firecrawl"
bestFor: "source-backed on-page audits via Firecrawl scrape"
source: { label: firecrawl/firecrawl-workflows, url: "https://github.com/firecrawl/firecrawl-workflows/tree/main/skills/firecrawl-seo-audit" }
repoStars: "217"
installs:
  count: "32.2K"
  url: "https://skills.sh/firecrawl/firecrawl-workflows/firecrawl-seo-audit"
license:
  name: "ISC"
  note: "declared in SKILL.md"
focus: "Firecrawl-backed audit"
install: "skillpack install github:firecrawl/firecrawl-workflows/skills/firecrawl-seo-audit --scope project"
description: |
  firecrawl-seo-audit is Firecrawl's workflow skill for on-page and technical SEO checks. It tells the agent to map and scrape pages, then inspect titles, meta descriptions, headings, canonicals, structured data and internal links, with evidence attached to each finding.

  The honest limit: it needs a `FIRECRAWL_API_KEY` and the Firecrawl CLI. Without that, the skill is instructions only. It also refuses to invent traffic, rankings or Core Web Vitals from scrape output. Repository stars are modest relative to installs, so weigh that when you compare maintainers.

  It is the clearest product-tied entry on this list. Keep it if your team already uses Firecrawl. Otherwise prefer seo-audit or Addy Osmani's seo.
suitedFor: |
  teams already on Firecrawl who want the agent to audit pages with the same scrape stack.
```

```skill-card
rank: 5
name: seo
maintainer: "AgriciDaniel"
bestFor: "a hub that routes many SEO sub-skills and agents"
source: { label: agricidaniel/claude-seo, url: "https://github.com/agricidaniel/claude-seo/tree/main/skills/seo" }
repoStars: "26.8K"
installs:
  count: "9.7K"
  url: "https://skills.sh/agricidaniel/claude-seo/seo"
license:
  name: "MIT"
  note: "declared in SKILL.md and the repository"
focus: "SEO command hub"
install: "skillpack install github:agricidaniel/claude-seo/skills/seo --scope project"
description: |
  This seo skill is the hub of AgriciDaniel's claude-seo collection. The repository packs dozens of focused `seo-*` skills and agents covering audits, schema, GEO, local SEO, content briefs and more. The hub skill is what we ranked, because the rule is one skill per repository.

  You invoke it with commands such as `/seo audit <url>` or `/seo page <url>`. It expects the collection's launcher scripts under the plugin root for full automation. A plain Skillpack install of this folder gives you the hub instructions; the richer workflow assumes the wider repo layout.

  Stars are high for the install count, which is the opposite pattern of several thin wrappers elsewhere on skills.sh.
suitedFor: |
  teams who want one entry point into a large SEO skill set, and are willing to install more than a single folder.
```

```skill-card
rank: 6
name: seo-aeo-best-practices
maintainer: "Sanity"
bestFor: "SEO and AEO principles when implementing pages"
source: { label: sanity-io/agent-toolkit, url: "https://github.com/sanity-io/agent-toolkit/tree/main/skills/seo-aeo-best-practices" }
repoStars: "196"
installs:
  count: "7.5K"
  url: "https://skills.sh/sanity-io/agent-toolkit/seo-aeo-best-practices"
license:
  name: "MIT"
  note: "repository LICENSE"
focus: "SEO + AEO checklist"
install: "skillpack install github:sanity-io/agent-toolkit/skills/seo-aeo-best-practices --scope project"
description: |
  Sanity's seo-aeo-best-practices skill is a compact principles pack. It covers metadata, Open Graph, sitemaps, robots.txt, hreflang, JSON-LD, EEAT and content shaped for AI answer surfaces.

  Four reference files sit in the folder: EEAT, structured data, technical SEO and AEO considerations. The skill tells the agent to open the one that matches the task, instead of loading everything at once.

  It lives in Sanity's agent-toolkit, but the guidance is mostly CMS-agnostic. Stars are low; treat installs as the stronger adoption signal here.
suitedFor: |
  builders implementing page SEO who want a short, citation-friendly checklist for both Google and answer engines.
```

```skill-card
rank: 7
name: seo-audit
maintainer: "Anthropic"
bestFor: "a marketer-facing audit with keyword and gap modes"
source: { label: anthropics/knowledge-work-plugins, url: "https://github.com/anthropics/knowledge-work-plugins/tree/main/marketing/skills/seo-audit" }
repoStars: "34.8K"
installs:
  count: "3.8K"
  url: "https://skills.sh/anthropics/knowledge-work-plugins/seo-audit"
license:
  name: "Apache 2.0"
  note: "repository LICENSE"
focus: "Full SEO audit modes"
install: "skillpack install github:anthropics/knowledge-work-plugins/marketing/skills/seo-audit --scope project"
description: |
  Anthropic's seo-audit lives in the marketing plugin of knowledge-work-plugins. It supports full site audit, keyword research, content gap analysis, technical SEO check and competitor comparison modes.

  Before it runs, it asks for the URL or topic, the audit type, optional target keywords and optional competitors. The output is a prioritized action plan split into quick wins and longer bets.

  Install counts are lower than the Corey Haines seo-audit. The repository stars are much higher. Pick this when you want Anthropic's marketing-plugin framing, or when you already use other skills from the same collection.
suitedFor: |
  marketers and PMs who want interview-first audits with clear modes, not only engineer-led Lighthouse checks.
```

A few skills just missed the list. Corey Haines' [copywriting](https://skills.sh/coreyhaines31/marketingskills/copywriting) (245.8K installs) and [ai-seo](https://skills.sh/coreyhaines31/marketingskills/ai-seo) (158.5K) are strong, but we kept one skill per repository. Ian Nuttall's [seo](https://skills.sh/iannuttall/seo/seo) (21.5K) dry-runs clean, yet its full value expects the seoskill.dev MCP or CLI with Search Console and analytics connectors. axelfreeman's marketing-mindset showed ~50K installs on skills.sh, but the GitHub repository returned 404 on November 5, 2026, so we dropped it. aaron-he-zhu's backlink-analyzer folder is now a signpost, not an installable skill.

## Side-by-side comparison

Ranked by adoption, with maintainer, license and scope shown for each skill. Data from skills.sh and GitHub, collected November 5, 2026. Stars are for each skill's whole GitHub repository.

```skill-comparison
```

```cta
title: "Agreed on how your team audits SEO?"
text: "Put your marketing and SEO skills in one Skillpack workspace and pin them to an exact commit in `.companion/skills.lock.json`, so every developer's agent runs the same checks."
primary: { label: "Start free", href: /login }
secondary: { label: "How to share Claude Code skills with your team", href: /blog/how-to-share-claude-code-skills-with-your-team }
```

## Which marketing or SEO skill fits your use case

```use-cases
rows:
  - useCase: "Prioritized audit of your own site"
    start: "seo-audit (Corey Haines)"
    add: "seo-aeo-best-practices"
    why: "Action plan first, then AEO checklist when you implement fixes"
  - useCase: "Rankings plus AI citations"
    start: "seo-geo"
    add: "seo-audit (Corey Haines)"
    why: "GEO workflow with optional APIs, backed by a classic audit"
  - useCase: "Engineer-led technical SEO"
    start: "seo (Addy Osmani)"
    add: "seo-audit (Anthropic)"
    why: "Lighthouse evidence, plus marketer-facing modes when needed"
  - useCase: "Already using Firecrawl"
    start: "firecrawl-seo-audit"
    add: "seo (Addy Osmani)"
    why: "Same scrape stack for evidence, plus vendor-neutral checks"
  - useCase: "One hub into many SEO workflows"
    start: "seo (AgriciDaniel)"
    add: "seo-geo"
    why: "Command router for the collection, plus GEO when AI search matters"
  - useCase: "Implementing metadata and schema"
    start: "seo-aeo-best-practices"
    add: "seo-audit (Corey Haines)"
    why: "Principles while you build, audit after you ship"
```

## How to install and share these skills with your team

Each command above installs a public GitHub folder with the Skillpack CLI, without an account. The CLI resolves the branch or tag to an exact commit, shows you the source and any executable files, and asks before copying anything. It never runs package scripts. With `--scope project`, the skill lands in `.agents/skills/`, which OpenCode reads, with managed copies in `.claude/skills/` for Claude Code and `.codex/skills/` for Codex. The exact commit is recorded in `.companion/skills.lock.json`. Commit that lockfile, and `skillpack sync --frozen` gives every teammate and every CI run the same files ([full install guide](/blog/how-to-install-skills-in-claude-code)).

Marketing audits drift when teammates run different skill versions. One person's agent asks five clarifying questions; another's invents keyword volumes. Pinning the commit keeps the method the same.

A skill can also be installed by hand: copy its folder into `.claude/skills/` in your repository, and Claude Code picks it up. Nothing records which commit you copied, though, so keeping teammates on the same version is up to you.

To share a skill with your organization, add `--share-org`. Once the CLI is signed in to your Skillpack workspace, it publishes a copy there and keeps the license and GitHub provenance. It refuses to overwrite an organization skill that already has the same name:

```bash
skillpack install github:coreyhaines31/marketingskills/skills/seo-audit --scope project --share-org
```

Skillpack is open source (MIT) and can run on your own infrastructure. For other use cases, see our rankings for [planning](/blog/best-claude-code-skills-planning), [testing](/blog/best-claude-code-skills-testing), [code review](/blog/best-claude-code-skills-code-review) and [frontend design](/blog/best-claude-code-skills-frontend-design), the [overall top Claude Code skills](/blog/best-claude-code-skills), or [write your own skill](/blog/how-to-create-a-claude-code-skill). New to the format? Read [what is SKILL.md](/blog/what-is-skill-md).

## FAQ

```faq
items:
  - question: "What is the best Claude Code skill for marketing or SEO?"
    answer: "By installs on skills.sh, it's Corey Haines' seo-audit, with 246.6K installs on November 5, 2026. It runs a prioritized technical and on-page audit and ends with an action plan."
  - question: "What's the difference between seo-audit and seo-geo?"
    answer: "seo-audit focuses on a classic prioritized SEO audit. seo-geo adds generative-engine optimization (citations in AI search) and optional scripts for keyword and SERP data."
  - question: "Do I need Firecrawl or DataForSEO to use these skills?"
    answer: "Only for some. firecrawl-seo-audit needs a Firecrawl API key. seo-geo can use DataForSEO scripts, but its basic audit runs without them. seo-audit, Addy Osmani's seo, Sanity's AEO skill and Anthropic's seo-audit work as instruction folders without those APIs."
  - question: "Are there Claude Code skills for copywriting too?"
    answer: "Yes. Corey Haines' marketingskills repo includes copywriting (245.8K installs) next to seo-audit. We kept one skill per repository on this page, so copywriting is linked in the just-missed section."
  - question: "How do I install a marketing or SEO skill in Claude Code?"
    answer: "Run `skillpack install github:owner/repo/path`, for example `skillpack install github:coreyhaines31/marketingskills/skills/seo-audit`. Add `--scope project` to install it in the current repository. You can also copy the skill's folder into `.claude/skills/` by hand."
  - question: "Do these skills work with Codex and Cursor?"
    answer: "They're plain `SKILL.md` folders, so they work in any agent that reads Agent Skills. See [how to use skills in Codex](/blog/how-to-use-skills-in-codex) and [how to use skills in Cursor](/blog/how-to-use-skills-in-cursor)."
  - question: "What licenses do these skills use?"
    answer: "Four declare MIT (seo-audit by Corey Haines, Addy Osmani's seo, AgriciDaniel's seo, Sanity's seo-aeo-best-practices). Two use Apache 2.0 (seo-geo, Anthropic's seo-audit). firecrawl-seo-audit declares ISC."
```

## Try Skillpack for free

Picking a marketing or SEO skill is half the job. The other half is getting every developer's agent to use the same one. Skillpack installs any public skill from GitHub with one command and pins the exact commit in a lockfile you can commit. It shares skills with your whole organization, with license and source kept. It's open source. [Create your free Skillpack workspace](/login) and share your first skill in a few minutes.

```cta
title: "Your team's skills, in one place."
primary: { label: "Sign up free for Skillpack", href: /login }
sticky: true
```
