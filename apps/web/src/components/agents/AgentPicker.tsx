"use client";

import { AGENT_IDS, AGENTS, type AgentId } from "@/lib/agents";
import { AgentLogo } from "./AgentLogo";

/** A tile per supported coding agent. Selection is a pressed toggle, one at a time. */
export function AgentPicker({
  value,
  onChange,
  label = "Choose your agent",
}: {
  value: AgentId;
  onChange: (id: AgentId) => void;
  label?: string;
}) {
  return (
    <div className="ls-choose" role="group" aria-label={label}>
      {AGENT_IDS.map((id) => {
        const info = AGENTS[id];
        const on = value === id;
        return (
          <button
            key={id}
            type="button"
            className={"atile" + (on ? " atile--on" : "")}
            aria-pressed={on}
            onClick={() => onChange(id)}
          >
            <AgentLogo id={id} />
            <span className="ls-tile__text">
              <span className="ls-tile__name">{info.name}</span>
              <span className="ls-tile__vendor mono">{info.vendor}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
