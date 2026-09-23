/**
 * The external coding agents Skillpack can hand its setup prompt to. Skillpack never launches them;
 * the member pastes the prompt, and the agent reports its display name back as the install agent.
 */
export const AGENT_IDS = ["claude-code", "codex", "opencode", "grok-bot", "openclaw", "hermes"] as const;

export type AgentId = (typeof AGENT_IDS)[number];

export const AGENTS = {
  "claude-code": { name: "Claude Code", vendor: "anthropic" },
  codex: { name: "Codex", vendor: "openai" },
  opencode: { name: "OpenCode", vendor: "opencode" },
  "grok-bot": { name: "Grok Bot (Cursor)", vendor: "cursor" },
  openclaw: { name: "OpenClaw", vendor: "openclaw" },
  hermes: { name: "Hermes", vendor: "nous-research" },
} satisfies Record<AgentId, { name: string; vendor: string }>;

export const DEFAULT_AGENT: AgentId = "claude-code";

const PREFERRED_AGENT_KEY = "skillpack:preferred-agent";

/** Resolve a stored or submitted value to a supported agent, if it names one. */
export function findAgentId(value: string | null): AgentId | null {
  return AGENT_IDS.find((id) => id === value) ?? null;
}

/** The agent this browser last picked. Call after mount only: the server render has no storage. */
export function loadPreferredAgent(): AgentId {
  try {
    return findAgentId(window.localStorage.getItem(PREFERRED_AGENT_KEY)) ?? DEFAULT_AGENT;
  } catch {
    return DEFAULT_AGENT;
  }
}

export function savePreferredAgent(id: AgentId): void {
  try {
    window.localStorage.setItem(PREFERRED_AGENT_KEY, id);
  } catch {
    /* private mode / storage disabled: the choice lasts for this page only */
  }
}
