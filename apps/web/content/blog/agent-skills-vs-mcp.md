---
title: "Agent Skills vs MCP: Context Cost Measured, When to Use Each"
description: "Agent Skills vs MCP, measured: what each puts in context at session start, what Claude Code actually loads, plus auth, trust, and when to use each one."
slug: agent-skills-vs-mcp
date: 2026-10-14
tags: ["Agent Skills", "MCP", "Claude Code"]
---

# Agent Skills vs MCP: context cost measured, and when to use each

Agent skills vs MCP comes down to access and method: an MCP server connects your agent to a system, and a skill teaches it the workflow your team expects. The usual tiebreaker is context, with MCP said to fill it and skills said to stay light. Skillpack measured that claim on November 12, 2026. GitHub MCP Server 2.1.0 with its default toolsets lists 46 tools whose definitions total 49,408 characters. By Skillpack's count, that is about 5 times the 9,616 characters of names and descriptions for all 19 skills in `anthropics/skills`. Claude Code skips most of that bill by default. Its [tool search](https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search) loads only tool names and server instructions at session start, and skills carry a context budget of their own.

- **Use MCP when** the agent has to reach a system it can't reach today: tickets, logs, a database, another app.
- **Use a skill when** the agent can already do the work but doesn't do it your way, such as following your team's [code review checklist](/blog/best-claude-code-skills-code-review).
- **Use both when** a server gives access and a skill teaches the workflow around it, the pairing [Anthropic described at the skills launch](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills).

## Agent Skill and MCP server, side by side

A skill is a folder with a `SKILL.md` file, and [What is SKILL.md?](/blog/what-is-skill-md) covers the full format.

| | Agent Skill | MCP server |
|---|---|---|
| What it gives the agent | Instructions, conventions, scripts and references for a task | Access to an outside system (tools, data, actions) |
| What it is | A folder with a `SKILL.md` file | A running server the agent connects to |
| Loaded at session start (Claude Code, defaults) | Each skill's name and description | Tool names and server instructions |
| Authentication | No auth field in the format | Optional; when supported, authorization servers MUST implement OAuth 2.1 |
| Trust | Anthropic: use skills only from trusted sources | Tools are arbitrary code execution; explicit user consent before each tool call |

## Context cost at session start, measured

Skillpack measured what each side puts in front of the model before any work starts. Each MCP server ran over stdio and answered `initialize` and `tools/list`. The count covers the compact JSON of each tool's `name`, `description` and `inputSchema`. Every figure is in characters. No tokenizer ran. Each server ran once, and the GitHub server got a dummy token. Skillpack ran 11 configurations of 9 servers, picked because they start without a live account, so the list does not stand for every MCP server.

| Configuration | Tools | Characters at session start |
|---|---|---|
| GitHub MCP Server 2.1.0, `--toolsets all` | 91 | 104,289 |
| GitHub MCP Server 2.1.0, default toolsets | 46 | 49,408 |
| chrome-devtools-mcp 1.13.0 | 33 | 30,285 |
| GitHub MCP Server 2.1.0, `--read-only` | 27 | 28,022 |
| `@playwright/mcp` 0.0.85 | 25 | 18,482 |
| Filesystem reference server 2.3.0 | 16 | 13,790 |
| Memory reference server 2.1.1 | 9 | 8,048 |
| Everything reference server 2.3.0 | 16 | 7,447 |
| mcp-server-git 2026.11.11 | 14 | 6,175 |
| mcp-server-time 2026.11.11 | 3 | 2,091 |
| mcp-server-fetch 2026.11.11 | 1 | 1,346 |
| 19 skills in `anthropics/skills`, name and description | 19 skills | 9,616 |

Divide 49,408 by 9,616 and the default GitHub setup comes out about 5 times heavier than the whole skill listing. The names of its 46 tools total only 734 characters, which by Skillpack's count is about 67 times smaller than the full definitions. Each skill's body weighs more than its listing entry. The median `SKILL.md` body in that repo runs 7,529 characters, and the agent reads it only when the skill activates. You can repeat the count on any server, since it needs only that server's `tools/list` response.

## Claude Code loads MCP tool names and instructions first

![In Claude Code, GitHub MCP and skills both load in stages: a short listing first, full text when needed. Detailed below.](/images/blog/agent-skills-vs-mcp/agent-skills-mcp-staged-loading.png)

Claude Code [turns on MCP tool search by default](https://code.claude.com/docs/en/mcp#configure-tool-search). Only tool names and server instructions load at session start, and Claude Code pulls a tool's full definition when it needs it. For GitHub's default toolsets, that comes down to the 734 characters of tool names plus 1,802 characters of server instructions, 2,536 in all, and the 49,408 characters of all 46 definitions are a ceiling, reached only if Claude Code ends up loading every one of them, since it pulls them tool by tool. Tool search stays off when you set `ENABLE_TOOL_SEARCH=false` or `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`, and in a HIPAA configuration. On models earlier than Claude Opus 4, Claude Sonnet 4 and Claude Haiku 4.5 (Claude Opus 4.5 and Sonnet 4.5 on Google Cloud's Agent Platform), Claude Code loads all MCP tools upfront. Microsoft Foundry hosted on Azure doesn't support tool search.

Anthropic described the older cost in [a post dated November 24, 2025](https://www.anthropic.com/engineering/advanced-tool-use). Before tool search, the GitHub server alone took 35 tools and about 26K tokens, according to that post. Five servers added up to 58 tools and about 55K tokens before the conversation even started. Those are Anthropic's figures from that date, in tokens, and they don't come from this test. Treat them as history.

So the claim that MCP fills your context describes upfront loading. In Claude Code with default settings, both sides load in stages, a short listing first (tool names and server instructions on the MCP side). This point holds for Claude Code only, since the Codex, Cursor and OpenCode docs read for this article don't describe deferred tools.

## Skills have a context budget too

Claude Code [caps its skill listing](https://code.claude.com/docs/en/skills) at 1% of the model's context window. When the listing overflows, Claude Code drops descriptions starting with the skills you invoke least. It also truncates each skill's combined description and `when_to_use` text at 1,536 characters. [Codex](https://developers.openai.com/codex/skills) gives its initial skill list at most 2% of the context window, or 8,000 characters when it doesn't know the window size. After compaction, Claude Code re-attaches each invoked skill with its first 5,000 tokens, and those skills share a budget of 25,000 tokens. Run `/doctor` to see what your listing costs.

The [Agent Skills spec](https://agentskills.io/specification) sets its own limits. A description can run to 1,024 characters, and the spec says to keep the main `SKILL.md` under 500 lines. Anthropic's `claude-api` skill has a 1,068-character description. By Skillpack's count, that is over the spec's limit and still under Claude Code's 1,536-character cap.

## MCP and skills split on auth and trust

The [MCP spec dated 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) makes authorization optional for MCP implementations. When a server supports it, authorization servers MUST implement OAuth 2.1, and MCP servers MUST implement OAuth 2.0 Protected Resource Metadata (RFC 9728). The Agent Skills frontmatter lists `name`, `description`, `license`, `compatibility`, `metadata` and an experimental `allowed-tools`, and none of them is an auth field. So a skill that calls an API relies on access the agent already has: a logged-in CLI, an environment variable or an authenticated MCP tool.

Trust follows the same line. Both sides carry risk. [Anthropic tells you](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) to use skills only from trusted sources, those you created yourself or obtained from Anthropic. Its docs warn that a malicious skill could lead to data exfiltration or unauthorized system access. The [MCP spec](https://modelcontextprotocol.io/specification/2026-07-28) says tools represent arbitrary code execution, and hosts must obtain explicit user consent before invoking any tool.

## Skills over MCP: a server can now ship its skills

MCP has an official [Skills extension](https://modelcontextprotocol.io/extensions/skills/overview), `io.modelcontextprotocol/skills`, that lets a server expose workflow instructions and their supporting files. Its proposal, [SEP-2640](https://modelcontextprotocol.io/seps/2640-skills-extension), has Final status and dates from April 23, 2026. The skill keeps the Agent Skills format, and the extension defines only the transport. A manifest MUST include `SKILL.md` and every supporting file, each with its URI, SHA-256 digest and byte size. Reading `SKILL.md` through `resources/read` doesn't activate the skill. The host sends it through its own skill loader, with checks and user consent where required.

The SEP starts from a plain problem. A server and the skill that teaches an agent to use it each have their own version, discovery and install today. SDK and host support is still in progress. Client support stays thin. The [official client matrix](https://modelcontextprotocol.io/extensions/client-matrix), read on November 12, 2026, marks ChatGPT, fast-agent and MCP Inspector as Partial for Skills and checks MCPJam, mcpc and Glean. It shows no Skills support for Claude Code or Cursor. So an MCP server can now carry its own skills, yet in Claude Code and Cursor, as of November 12, 2026, skills still live as files.

## Where skills and MCP servers live in each tool

Claude Code, Codex, Cursor and OpenCode each read skills and MCP servers from their own places.

| Tool | Skills folder | MCP server config |
|---|---|---|
| Claude Code | `.claude/skills/` (project), `~/.claude/skills/` (personal) | `claude mcp add`, `.mcp.json` (project) or `~/.claude.json` |
| Codex | `.agents/skills` in every folder up to the repo root, plus `$HOME/.agents/skills` | `~/.codex/config.toml`, or `.codex/config.toml` in a trusted project |
| Cursor | `.agents/skills/` and `.cursor/skills/`, plus the Claude and Codex folders | `.cursor/mcp.json`, or `~/.cursor/mcp.json` for all projects |
| OpenCode | `.opencode/skills/<skill-id>`, plus `.claude/skills` and `.agents/skills` | `opencode.json`, under `mcp` |

In Claude Code, adding a remote server takes one command:

```sh
claude mcp add --transport http notion https://mcp.notion.com/mcp
```

[OpenCode's docs](https://opencode.ai/docs/mcp-servers) add a warning: MCP tools consume model context, so add only the servers you need.

## Sharing skills across a team

Skills are files, and copies drift between laptops, repos and chats. The [Skillpack CLI](https://github.com/The-Vibe-Company/skillpack/blob/0388e368073cb795fe60eee0afc8d8cb2d929412/docs/skillpack-cli.md) installs a skill for several agents in one command:

```sh
skillpack install <slug> --scope project --tools claude-code,codex,opencode
```

A project install writes to `.agents/skills` and keeps relative paths in `.companion/skills.lock.json`. Commit that lock file, and `skillpack sync --frozen` restores the same skills for every teammate. Skillpack also exposes an authenticated MCP endpoint at `/mcp`, plus an anonymous, read-only `/mcp/public` endpoint for public catalogue skills. An approved external coding agent can read and write skills through scoped permissions. For the details, see [How to install skills in Claude Code](/blog/how-to-install-skills-in-claude-code) and [How to share Claude Code skills with your team](/blog/how-to-share-claude-code-skills-with-your-team).

## Context cost only: task quality not tested

Skillpack's comparison measured context cost at session start and did not test task quality. No agent ran a task with either side. The counts are in characters, so they give no exact token figures. Clients other than Claude Code, Codex, Cursor and OpenCode stay out of scope, and so do servers that need a live account. GitHub MCP Server ran with a dummy token (`dummy-not-a-token`), because its `tools/list` doesn't contact the GitHub API.

## Skill or MCP server: pick by what you need

- If the agent must reach a system it can't see today, add an MCP server.
- If you keep pasting the same instructions into prompts, write a skill.
- If each user has to sign in, pick MCP, whose spec builds authorization on OAuth 2.1.
- If a result is large, let a skill script do the work, because [only the script's output](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) enters the context.
- If you use MCP for large results in Claude Code, know its limits. Claude Code [warns above 10,000 tokens](https://code.claude.com/docs/en/mcp#mcp-output-limits-and-warnings) of tool output, caps it at 25,000 tokens by default (`MAX_MCP_OUTPUT_TOKENS`) and saves text results over 50,000 characters to a file.
- If you install many skills, check the listing budget with `/doctor`.
- If you need a server and its instructions, use both, or Skills over MCP once your client supports it.

```faq
items:
  - question: "Is a skill a replacement for MCP?"
    answer: "No. A skill can't give an agent access to a system it can't reach. It tells the agent how to use access it already has, such as a logged-in CLI, an environment variable or an authenticated MCP tool. With the Skills extension, an MCP server can also ship its own skills next to its tools."
  - question: "Can a skill call an MCP tool?"
    answer: "Yes, when the agent already has that tool. A skill's instructions can tell the agent to use any tool it can reach, including one from an MCP server you configured separately. Under SEP-2640, the server itself can ship the skill, though the official matrix of November 12, 2026 lists neither Claude Code nor Cursor as supporting it."
  - question: "Which one costs more context?"
    answer: "It depends on the client. In Skillpack's count on November 12, 2026, the default GitHub MCP Server definitions took 49,408 characters, and the names and descriptions of 19 Anthropic skills took 9,616. Claude Code's tool search loads tool names and server instructions first, and its skill listing gets 1% of the context window."
  - question: "Do Codex, Cursor and OpenCode support both?"
    answer: "Yes. Codex, Cursor and OpenCode all read SKILL.md skills and connect to MCP servers, each from the folders and config files in the table above. Only the Claude Code docs describe deferring MCP tool definitions by default, so the context math can differ in the other tools."
```

[Sign up on Skillpack](/login) to install, version and share skills with your team.
