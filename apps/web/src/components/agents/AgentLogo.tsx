import type { AgentId } from "@/lib/agents";
import { Icon } from "../Icon";

/** Anthropic mark, shown on the Claude Code tile. */
function ClaudeLogo() {
  return (
    <span className="ls-tile__logo" style={{ background: "#D97757" }} aria-hidden="true">
      <svg width="21" height="21" viewBox="0 0 24 24" fill="#fff">
        <g>
          <rect x="11.2" y="2" width="1.6" height="20" rx="0.8" />
          <rect x="11.2" y="2" width="1.6" height="20" rx="0.8" transform="rotate(36 12 12)" />
          <rect x="11.2" y="2" width="1.6" height="20" rx="0.8" transform="rotate(72 12 12)" />
          <rect x="11.2" y="2" width="1.6" height="20" rx="0.8" transform="rotate(108 12 12)" />
          <rect x="11.2" y="2" width="1.6" height="20" rx="0.8" transform="rotate(144 12 12)" />
        </g>
      </svg>
    </span>
  );
}

/** OpenAI mark, shown on the Codex tile. */
function CodexLogo() {
  return (
    <span className="ls-tile__logo" style={{ background: "#0b0b0d" }} aria-hidden="true">
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.5">
        <ellipse cx="12" cy="12" rx="9.2" ry="3.6" />
        <ellipse cx="12" cy="12" rx="9.2" ry="3.6" transform="rotate(60 12 12)" />
        <ellipse cx="12" cy="12" rx="9.2" ry="3.6" transform="rotate(120 12 12)" />
      </svg>
    </span>
  );
}

const ICON_TILES = {
  opencode: { background: "#365c7d", icon: "terminal" },
  "grok-bot": { background: "#2563eb", icon: "bot" },
  openclaw: { background: "#44546f", icon: "bot" },
  hermes: { background: "#5b4b7f", icon: "bot" },
} satisfies Record<Exclude<AgentId, "claude-code" | "codex">, { background: string; icon: string }>;

export function AgentLogo({ id }: { id: AgentId }) {
  if (id === "claude-code") return <ClaudeLogo />;
  if (id === "codex") return <CodexLogo />;
  const tile = ICON_TILES[id];
  return (
    <span className="ls-tile__logo" style={{ background: tile.background }} aria-hidden="true">
      <Icon name={tile.icon} size={18} style={{ color: "#fff" }} />
    </span>
  );
}
