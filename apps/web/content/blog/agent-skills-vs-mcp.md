---
title: "Agent Skills vs MCP: Differences and When to Use Each"
description: "Agent Skills teach an agent how to do a task. MCP connects it to tools and data. How they differ and when to use each in Claude Code, Codex and OpenCode."
slug: agent-skills-vs-mcp
date: 2026-10-14
tags: ["Agent Skills", "MCP", "Claude Code"]
---

# Agent Skills vs MCP: what's the difference and when to use each

Agent Skills and the Model Context Protocol (MCP) both came out of Anthropic, and both make coding agents more useful. But they solve different problems. MCP gives an agent access to a system. A skill tells the agent how your team wants the work done.

Short version: MCP is the connection, a skill is the know-how.

## What MCP is

MCP is an open protocol Anthropic released on November 25, 2024 as "a universal, open standard for connecting AI systems with data sources" ([Anthropic](https://www.anthropic.com/news/model-context-protocol)). An MCP server exposes tools, data or actions. The agent is the client. It calls the server to read a ticket, query a database or open a pull request.

In Claude Code, you add a server with a command like this:

```sh
claude mcp add --transport http notion https://mcp.notion.com/mcp
```

Source: [Claude Code docs, MCP](https://code.claude.com/docs/en/mcp). Codex and OpenCode support MCP servers too ([Codex](https://developers.openai.com/codex/mcp), [OpenCode](https://opencode.ai/docs/mcp-servers)).

## What an Agent Skill is

Anthropic introduced Agent Skills on October 16, 2025 and published them as an open standard on December 18, 2025 ([Anthropic engineering](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills), [agentskills.io](https://agentskills.io/home)). A skill is a folder with a `SKILL.md` file: a name and a description in the frontmatter, then instructions, plus optional scripts and reference files. See [What is SKILL.md?](/blog/what-is-skill-md) for the full format.

Skills load in stages. At first, the agent only sees each skill's name and description. It reads the full `SKILL.md` when a task matches, and opens the bundled files only if it needs them. When a skill runs a script, the code stays out of context and only the output goes in ([Claude docs, Agent Skills](https://docs.claude.com/en/docs/agents-and-tools/agent-skills)). Codex and OpenCode read the same `SKILL.md` format ([Codex](https://developers.openai.com/codex/skills), [OpenCode](https://opencode.ai/docs/skills)).

## Side by side

| | MCP server | Agent Skill |
|---|---|---|
| What it gives the agent | Access to an outside system (tools, data, actions) | Instructions, conventions, scripts and references for a task |
| What it is | A running server the agent connects to | A folder with a `SKILL.md` file |
| Answers the question | "Can the agent reach it?" | "Does the agent know how we do it?" |
| Where it lives | Local process or remote URL | `~/.claude/skills/`, `.claude/skills/` or the equivalent for your agent |
| How it's loaded | Configured per agent (`claude mcp add`, config file) | Name and description first, full content on demand |
| Typical example | GitHub, Linear, Postgres, Sentry | "How we write release notes", "Our migration checklist" |

## When to use MCP

Use an MCP server when the agent needs to reach something it can't reach today:

- live data: tickets, logs, metrics, a database;
- actions in another app: create an issue, post a message, deploy;
- anything that needs authentication against a third-party service.

If the agent can't see the system at all, better instructions won't help. You need MCP.

## When to use a skill

Use a skill when the agent can already do the work but doesn't do it your way:

- a repeatable process: release notes, code review checklist, incident write-up;
- team conventions: naming, folder layout, commit format;
- a script that should run the same way every time;
- reference material the agent should open only when relevant.

If you keep pasting the same instructions into prompts, turn them into a skill.

## Using both together

Most real setups use both. Anthropic pointed this out at launch: it plans to explore how skills can "complement Model Context Protocol (MCP) servers by teaching agents more complex workflows that involve external tools and software" ([Anthropic engineering](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)).

A typical example: a Linear MCP server lets the agent read and update issues. A `triage` skill tells it which labels to use, how to judge priority and what to write in the comment. The server handles access, the skill handles method.

Skillpack works the same way. Skills are `SKILL.md` packages, and the Skills Hub also runs an MCP server. After you approve the connection, a connected agent can search, read and publish your team's skills, and record installs.

## Sharing skills across a team

An MCP server is configured once and everyone connects to it. Skills are files. They get copied between laptops, repos and chats, and the versions drift.

[Skillpack](https://skillpack.app) is an open-source Skills Hub built for this. You install a skill with one command:

```sh
skillpack install <slug> --scope project --tools claude-code,codex,opencode
```

The skill lands in the repo for all three agents, and its version and sha256 checksum go into `.companion/skills.lock.json`. Commit that file, and `skillpack sync --frozen` gives every teammate and every CI run the same skills. Step by step: [How to install skills in Claude Code](/blog/how-to-install-skills-in-claude-code). For the full team setup, see [How to share Claude Code skills with your team](/blog/how-to-share-claude-code-skills-with-your-team). Not sure which skills to start with? Here are [the most-installed Claude Code skills](/blog/best-claude-code-skills), ranked.

```faq
items:
  - question: "Is a skill a replacement for MCP?"
    answer: "No. A skill can't give an agent access to a system it can't reach. What it can do is tell the agent how to use the access it already has."
  - question: "Can a skill call an MCP tool?"
    answer: "A skill's instructions can tell the agent to use a tool it already has, including one from an MCP server. The server still has to be configured separately."
  - question: "Which one costs more context?"
    answer: "Skills are built to stay light: only the name and description are loaded until the skill is needed."
  - question: "Do Codex and OpenCode support both?"
    answer: "Yes. Both support MCP servers and SKILL.md skills (links above)."
```

## Get started

[Sign up on Skillpack](https://skillpack.app/login) to version your skills, share them with your team and install them in Claude Code, Codex and OpenCode.
