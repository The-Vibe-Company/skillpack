"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/cds";
import { AGENTS, DEFAULT_AGENT, loadPreferredAgent, savePreferredAgent, type AgentId } from "@/lib/agents";
import { apiBase } from "@/lib/queries";
import { Icon } from "../Icon";
import { fillPrompt } from "../skills/prompts";
import { AgentPicker } from "./AgentPicker";

/**
 * The one "hand Skillpack to your coding agent" surface: pick the agent, copy its setup prompt.
 * Onboarding renders it as the last step, the local-skills install dialog renders it in a modal.
 * Callers own the connection status and the surrounding actions.
 */
export function ConnectAgentPanel({
  template,
  workspaceId,
  copyVariant = "primary",
}: {
  /** An unfilled prompt template from the Skillpack local-skill row. */
  template: string;
  workspaceId: string;
  copyVariant?: "primary" | "secondary";
}) {
  const [agent, setAgent] = useState<AgentId>(DEFAULT_AGENT);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const copiedTimer = useRef<number | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    setAgent(loadPreferredAgent());
    return () => {
      mounted.current = false;
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    };
  }, []);

  const agentName = AGENTS[agent].name;
  const prompt = useMemo(
    () => fillPrompt(template, apiBase(), workspaceId, agentName, agentName),
    [agentName, template, workspaceId],
  );

  const choose = useCallback((id: AgentId) => {
    setAgent(id);
    setCopied(false);
    savePreferredAgent(id);
  }, []);

  const copy = useCallback(async () => {
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(prompt);
    } catch {
      if (!mounted.current) return;
      setCopied(false);
      setCopyFailed(true);
      setPromptOpen(true);
      return;
    }
    if (!mounted.current) return;
    setCopyFailed(false);
    setCopied(true);
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => {
      copiedTimer.current = null;
      setCopied(false);
    }, 2000);
  }, [prompt]);

  return (
    <div className="cap">
      <AgentPicker value={agent} onChange={choose} />
      <div className="cap-prompt">
        <div className="cap-prompt__head">
          <span className="cap-prompt__label">Paste this into {agentName}</span>
          <Button
            type="button"
            variant={copyVariant}
            onClick={() => void copy()}
            iconLeft={<Icon name={copied ? "check" : "copy"} size={15} />}
          >
            {copied ? "Copied" : "Copy prompt"}
          </Button>
        </div>
        <details
          className="cap-prompt__details"
          open={promptOpen}
          onToggle={(event) => setPromptOpen(event.currentTarget.open)}
        >
          <summary className="cap-prompt__summary">
            <Icon name="chevron-right" size={14} className="cap-prompt__chev" />
            {promptOpen ? "Hide prompt" : "Show prompt"}
          </summary>
          <pre className="cap-prompt__text" tabIndex={0} aria-label={`Setup prompt for ${agentName}`}>
            {prompt}
          </pre>
        </details>
        {copyFailed ? (
          <p className="cap-prompt__warn" role="alert">
            <Icon name="alert-triangle" size={14} />
            Copy failed. Select the prompt and copy it manually.
          </p>
        ) : null}
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? `Prompt copied for ${agentName}.` : ""}
      </span>
    </div>
  );
}
