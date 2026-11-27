---
title: "seo skills claude: what six GitHub repos really install"
description: "A seo skills claude search returns starred GitHub repos that look alike. An install notebook shows what each one is and what a one-folder install copies."
slug: seo-geo-skill-packs-claude-code
date: 2026-11-16
dataCollected: 2026-11-16
tags: ["Claude Code", "Agent Skills", "SEO", "GEO", "MCP", "Skillpack"]
author: "Stan Girard"
authorRole: "co-founder of The Vibe Company, which builds Skillpack"
---

# What does a "seo skills claude" search actually put in your repo?

A search for seo skills claude drops you on GitHub, in front of repos whose star counts run into the tens of thousands and whose pitches sound alike: SEO, inside Claude Code, one install away.

So the obvious move is to pick the biggest number and install it. A notebook test on 16 November 2026 installed six of those repos instead of trusting the count, and one install died on an error before copying a single file. Another went through without a complaint and left behind a skill whose only instruction was to go read a file that hadn't come along.

The short answer: these repos are different kinds of software. [claude-seo](https://github.com/AgriciDaniel/claude-seo) is a plugin pack, [geo-seo-claude](https://github.com/zubair-trabzada/geo-seo-claude) is a skill toolkit that builds its own Python environment, [open-seo](https://github.com/every-app/open-seo) is a full SEO application, [notfair-plugin](https://github.com/nowork-studio/notfair-plugin) is a plugin where a SKILL.md can be a pointer to a workflow stored elsewhere, [seo-skills](https://github.com/RomeoSEO/seo-skills) is a folder of plain markdown skills, and [mcp-gsc](https://github.com/AminForou/mcp-gsc) is an MCP server. Which is why the way you install matters as much as the repo you pick. Copy one folder out of a pack that expects its neighbors and you get the label without the contents.

The figure below sorts them into four kinds. The notebook shows where each one bites.

![Star counts hide four kinds of SEO repo: a plugin pack, a skill toolkit, a full app, and an MCP server.](/images/blog/seo-geo-skill-packs-claude-code/what-a-starred-seo-repo-actually-is.png)

## The repos behind a seo skills claude search are different kinds of software

Start with the install that failed, because it's the clearest case. Pointed at a repo root, a dry run of `skillpack install github:AminForou/mcp-gsc` answered `SKILL.md is missing or oversized` and exited 5. There is no SKILL.md at that root to find. The README's first heading says what the repo is in plain words, "Google Search Console MCP Server for SEOs", and the comparison of [how agent skills and MCP servers differ](/blog/agent-skills-vs-mcp) covers the distinction.

The repo does ship a few skills in a `skills/` folder, and installing one of them (`seo-weekly-report`) worked. But each of those skills tells the agent to call the server's tools, `list_properties` for example, and the server needs Google credentials first. With none configured, the notebook's call to the auth function raised an error that begins "Authentication failed. Please either:". So the skill is a recipe, and the kitchen is a separate install.

OpenSEO is the same idea at a larger scale. GitHub describes it as an "Open source alternative to Semrush and Ahrefs", the [README](https://github.com/every-app/open-seo/blob/main/README.md) prices a hosted version at $10 a month, and self-hosting needs a DataForSEO API key. Its skills are, in the README's words, "reusable workflows that guide your agent through SEO tasks using the MCP". They are the remote control. The app is the television.

claude-seo sits in the middle. It installs as a Claude Code plugin through the plugin marketplace, or through a clone and an `install.sh` that copies skills, agents and extensions, then creates an isolated Python runtime. The README adds that `/seo setup` installs a headless browser.

And then there is RomeoSEO's seo-skills, the repo with the fewest stars in the table and the one where the notebook has the least to report: its `install.sh` wrote every skill it listed, as markdown, into the folder it was given.

| Repo | What it is | Stars (16 Nov 2026) | SKILL.md files found | Official install | What a one-folder Skillpack install landed | Caveat |
|---|---|---|---|---|---|---|
| [claude-seo](https://github.com/AgriciDaniel/claude-seo) | Plugin pack: skills, agents, extensions | 29,850 | 40, extension copies included | Claude Code plugin marketplace, or clone and `install.sh` | `seo-audit` installed, and took that name in the project | Full setup adds a Python runtime and a headless browser |
| [geo-seo-claude](https://github.com/zubair-trabzada/geo-seo-claude) | Skill toolkit with scripts and a local venv | 11,710 | 16, the sub-skills plus a `geo` orchestrator | `install.sh`, by curl or from a clone | `geo-audit`: SKILL.md only | Scripts, venv and agents come only from the installer |
| [open-seo](https://github.com/every-app/open-seo) | SEO app with an MCP server and a skills plugin | 27,872 | 12 in `plugins/openseo/skills/` | Hosted or self-hosted app, then the [skills setup docs](https://openseo.so/docs/skills/setup) | `seo-audit`: SKILL.md only, in a fresh project | The skill tells the agent to stop if OpenSEO isn't connected |
| [notfair-plugin](https://github.com/nowork-studio/notfair-plugin) | Plugin for SEO, GEO and marketing skills | 4,213 | 45 | `/plugin marketplace add`, then `/plugin install` | `seo-analysis`: a pointer SKILL.md, no workflow file | The workflow lives outside `skills/` |
| [seo-skills](https://github.com/RomeoSEO/seo-skills) | Plain markdown skill pack | 8 | 50 | Clone and `install.sh`, or the plugin marketplace | `seo-start-here` installed | The GitHub description still says 48 |
| [mcp-gsc](https://github.com/AminForou/mcp-gsc) | MCP server for Google Search Console | 2,211 | 4 | Google API credentials, then the MCP client config | Repo root refused; `seo-weekly-report` installed | Skills call MCP tools that need credentials |

The counts printed on the tin drift too. GitHub's description of claude-seo promises 26 sub-skills while the [plugin manifest](https://github.com/AgriciDaniel/claude-seo/blob/main/.claude-plugin/plugin.json) in the same repo says 29. The [geo-seo-claude README](https://github.com/zubair-trabzada/geo-seo-claude/blob/main/README.md) announces "13 specialized sub-skills" and then lists 14 folders right underneath. Repos move faster than their descriptions, so the tree is the thing to count.

If popularity is what you're after, the [ranking of marketing and SEO skills by skills.sh installs](/blog/best-claude-code-skills-marketing-seo) already covers it. The notebook asks what lands on disk.

## A one-folder install can succeed and still leave most of the pack on GitHub

Say your search was closer to geo seo claude and you ended up on geo-seo-claude. You see a `skills/geo-audit` folder, you install that folder, and the command exits 0 with status "installed". What sits in `.claude/skills/geo-audit/` afterwards is one file: SKILL.md.

Now run the repo's own [`install.sh`](https://github.com/zubair-trabzada/geo-seo-claude/blob/main/install.sh) in a clean home directory. It installs 15 sub-skills and the subagents, creates a venv at `~/.claude/skills/geo/.venv`, pulls in the Python dependencies and pins the script shebangs to that venv. The README asks for Python 3.10 or newer.

Same repo, same morning, and a completely different object on disk. With the full install, the notebook could run the pack's citability scorer against example.com and get JSON back: a score of 30, grade F, label "Poor Citability". The grade is beside the point. After the one-folder install there is no scorer to run, no schema templates, no sibling sub-skills, no agents.

## The cleanest install of the morning landed a note pointing at a file that wasn't there

NotFair is where it gets strange, because nothing failed.

Installing `skills/seo-analysis` from notfair-plugin went through cleanly. The folder that landed holds a single [SKILL.md of 643 bytes](https://github.com/nowork-studio/notfair-plugin/blob/main/skills/seo-analysis/SKILL.md), and its body says: "Read `../../seo/seo-analysis/WORKFLOW.md` completely, then follow it as the active workflow."

In the repo, that [WORKFLOW.md](https://github.com/nowork-studio/notfair-plugin/blob/main/seo/seo-analysis/WORKFLOW.md) exists and weighs 17,653 bytes. In the project, the path leads nowhere, because `skills/` and `seo/` are neighbors on GitHub and only the first one made the trip. If you know [what a SKILL.md file is supposed to carry](/blog/what-is-skill-md), you expect the instructions. This one carries a forwarding address.

NotFair's documented install is the plugin marketplace route, with `/plugin install notfair@nowork-studio`. The trap is treating a plugin like a loose folder.

OpenSEO's `seo-audit` skill is just as dependent and more upfront about it. Installed alone in a fresh project, it is one SKILL.md, and that file tells the agent: "If OpenSEO is not connected, stop and ask the user to connect it."

It needed a fresh project for a reason. In the first one, claude-seo's `seo-audit` was already installed, so Skillpack refused [OpenSEO's skill of the same name](https://github.com/every-app/open-seo/tree/main/plugins/openseo/skills/seo-audit) with `skill name belongs to another source; remove that installation explicitly or choose another scope` and exit 6. Two packs claim one slug, and a project holds one of them.

## So open the skill folder before you install it, and let the star count wait

A star is a vote for a whole repository, and an install writes one folder into one project. So before you install any Claude Code SEO skill, open its folder on GitHub. If SKILL.md is the only file in it, read it and look for anything that leaves the folder: a path that climbs with `../`, a script it expects to run, an MCP tool it expects to call. Find one, and the repo's own installer is the right door, whether that's the plugin marketplace or an `install.sh`. For anything MCP, set up the server and its credentials first.

If the folder stands on its own, a one-folder install is the right tool, and the [guide to installing skills in Claude Code](/blog/how-to-install-skills-in-claude-code) walks through it. Adding `--dry-run --scope project --tools claude-code --yes` to a `skillpack install` prints the target folders before anything gets written. Keep in mind that a dry run tells you where files will go. Only the folder tells you which files exist.

Then go back to those star counts with a better question than which is biggest. And if one of these repos already went into a project of yours on the strength of its stars, run `ls -R .claude/skills` there now. A folder holding a lone SKILL.md is the one to open first.

*Method: a single notebook session on an isolated Linux machine with Skillpack CLI 0.3.5, shallow clones of each default branch, no Google or paid API credentials and no Claude Code CLI on the machine, so no plugin marketplace install and no `/seo` or `/geo` command ran, claude-seo's `install.sh` was read without being run to completion, and the star counts are GitHub API reads from that morning. Disclosure: Skillpack is built by The Vibe Company, the author's company.*

```cta
title: "See where a skill will land before it lands."
text: "`skillpack install github:owner/repo/skills/name --dry-run` prints its target folders and writes nothing. Create a free Skillpack workspace to share the skills that pass your check."
primary: { label: "Create a free Skillpack workspace", href: /login }
secondary: { label: "Read the guide to installing skills in Claude Code", href: /blog/how-to-install-skills-in-claude-code }
```
