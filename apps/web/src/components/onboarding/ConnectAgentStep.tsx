"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GettingStartedState, LocalSkillRow } from "@skillpack/contracts";
import { ConnectAgentPanel } from "@/components/agents/ConnectAgentPanel";
import { Button, StatusDot } from "@/components/cds";
import { Icon } from "@/components/Icon";
import { gettingStartedTemplate } from "@/components/skills/prompts";
import { fetchGettingStarted, fetchLocalSkills } from "@/lib/queries";
import { REQUIRED_LOCAL_SKILL_KEY } from "@/lib/skillpackSkillGate";
import { StepHeading } from "./StepHeading";

const POLL_MS = 3000;
const FAILURES_BEFORE_WARNING = 3;

type Setup =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; skill: LocalSkillRow; template: string };

function findSkillpackSkill(rows: LocalSkillRow[]): LocalSkillRow | null {
  return rows.find((row) => row.key === REQUIRED_LOCAL_SKILL_KEY) ?? rows.find((row) => row.key === "companion") ?? null;
}

/**
 * Watch for the agent's install report. The Skillpack skill records `companion_install` when the
 * agent calls back, so the getting-started state is the connection signal. Polls only while the
 * tab is visible and stops once connected.
 */
function useAgentConnection(workspaceId: string, initial: GettingStartedState | null) {
  const [connected, setConnected] = useState(Boolean(initial?.companion_installed_at));
  const [failures, setFailures] = useState(0);
  const sequence = useRef(0);

  useEffect(() => {
    if (initial?.companion_installed_at) setConnected(true);
  }, [initial]);

  const check = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const state = await fetchGettingStarted(workspaceId);
      if (request !== sequence.current) return;
      setFailures(0);
      if (state.companion_installed_at) setConnected(true);
    } catch {
      if (request === sequence.current) setFailures((count) => count + 1);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (connected) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, POLL_MS);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      sequence.current += 1; // drop any response still in flight
      window.clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [check, connected]);

  return { connected, unreachable: failures >= FAILURES_BEFORE_WARNING };
}

export function ConnectAgentStep({
  workspaceId,
  workspaceName,
  invitedCount,
  onFinish,
}: {
  workspaceId: string;
  workspaceName: string;
  invitedCount: number | null;
  onFinish: () => void;
}) {
  const [setup, setSetup] = useState<Setup>({ status: "loading" });
  const [initialState, setInitialState] = useState<GettingStartedState | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { connected, unreachable } = useAgentConnection(workspaceId, initialState);

  useEffect(() => {
    let cancelled = false;
    setSetup({ status: "loading" });
    Promise.all([fetchLocalSkills(workspaceId), fetchGettingStarted(workspaceId).catch(() => null)])
      .then(([rows, state]) => {
        if (cancelled) return;
        const skill = findSkillpackSkill(rows);
        if (!skill) {
          setSetup({ status: "error" });
          return;
        }
        // The prompt is chosen once so its text does not change under the member mid-copy.
        setInitialState(state);
        setSetup({ status: "ready", skill, template: gettingStartedTemplate(skill, Boolean(state?.companion_installed_at)) });
      })
      .catch(() => {
        if (!cancelled) setSetup({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, workspaceId]);

  return (
    <div>
      <StepHeading title="Connect your coding agent" focusOnMount>
        Your agent installs the Skillpack skill for <strong>{workspaceName}</strong>. Approve access when it asks.
      </StepHeading>

      {invitedCount ? (
        <p className="ob-done">
          <Icon name="check" size={14} />
          {invitedCount === 1 ? "Invited 1 person." : `Invited ${invitedCount} people.`}
        </p>
      ) : null}

      <div className="ob-body">
        {setup.status === "loading" ? (
          <div className="ob-placeholder" aria-busy="true">
            <span className="ob-placeholder__row" />
            <span className="ob-placeholder__row" />
            <span className="ob-placeholder__row ob-placeholder__row--short" />
            <span className="sr-only">Loading the setup prompt</span>
          </div>
        ) : setup.status === "error" ? (
          <div className="ob-error ob-error--block" role="alert">
            Couldn&rsquo;t load the setup prompt.
            <button type="button" className="ob-textbtn" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
          </div>
        ) : (
          <ConnectAgentPanel
            template={setup.template}
            workspaceId={workspaceId}
            copyVariant={connected ? "secondary" : "primary"}
          />
        )}

        <div className={`ob-status${connected ? " is-ok" : ""}`} role="status" aria-live="polite">
          <StatusDot status={connected ? "ok" : "unknown"} label={connected ? "Connected" : "Waiting for your agent"} />
          <span className="ob-status__desc">
            {connected
              ? "Skillpack skill installed. Your agent continues with your local skills."
              : unreachable
                ? "Can't reach Skillpack right now. Still retrying."
                : "Updates when your agent reports the install."}
          </span>
        </div>
      </div>

      <div className="ob-foot">
        <span className="ob-spacer" />
        {connected ? (
          <Button type="button" variant="primary" size="lg" onClick={onFinish} iconLeft={<Icon name="arrow-right" />}>
            Open Skillpack
          </Button>
        ) : (
          <Button type="button" variant="ghost" size="lg" onClick={onFinish}>
            Skip for now
          </Button>
        )}
      </div>
    </div>
  );
}
