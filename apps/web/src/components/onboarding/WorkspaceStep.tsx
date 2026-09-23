"use client";

import { type FormEvent } from "react";
import { Avatar, hashColor, initialsOf } from "@/components/branding";
import { Button } from "@/components/cds";
import type { OnboardingMatchedOrg } from "@/lib/onboarding";
import { StepError, StepHeading } from "./StepHeading";

export type WorkspaceMode = "create" | "join";

export function WorkspaceStep({
  mode,
  onModeChange,
  name,
  onNameChange,
  workspaceName,
  onWorkspaceNameChange,
  logoSrc,
  domain,
  matchedOrgs,
  selectedOrgId,
  onSelectOrg,
  busy,
  error,
  focusHeading,
  onSubmit,
}: {
  mode: WorkspaceMode;
  onModeChange: (mode: WorkspaceMode) => void;
  name: string;
  onNameChange: (value: string) => void;
  workspaceName: string;
  onWorkspaceNameChange: (value: string) => void;
  logoSrc: string | null;
  /** The member's corporate email domain, or null for personal addresses. */
  domain: string | null;
  matchedOrgs: OnboardingMatchedOrg[];
  selectedOrgId: string | null;
  onSelectOrg: (id: string) => void;
  busy: boolean;
  error: string | null;
  focusHeading: boolean;
  onSubmit: () => void;
}) {
  const joining = mode === "join" && matchedOrgs.length > 0;
  const selected = matchedOrgs.find((org) => org.id === selectedOrgId) ?? matchedOrgs[0] ?? null;
  const canSubmit = name.trim().length > 0 && (joining ? selected !== null : workspaceName.trim().length > 0);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canSubmit && !busy) onSubmit();
  };

  return (
    <form className="ob-step" onSubmit={submit} noValidate>
      {joining ? (
        <StepHeading title="Join a workspace" focusOnMount={focusHeading}>
          {matchedOrgs.length > 1 ? "These workspaces accept" : "This workspace accepts"} verified{" "}
          <span className="mono">@{selected?.domain ?? domain}</span> addresses.
        </StepHeading>
      ) : (
        <StepHeading title="Create your workspace" focusOnMount={focusHeading}>
          Members, skills, and agent access live in a workspace.
        </StepHeading>
      )}

      <div className="ob-body">
        <div className="ob-field">
          <label className="ob-field__label" htmlFor="ob-name">Your name</label>
          <input
            id="ob-name"
            className="ob-input"
            autoComplete="name"
            autoFocus={!focusHeading && !name}
            value={name}
            placeholder="Alex Rivera"
            disabled={busy}
            onChange={(event) => onNameChange(event.target.value)}
          />
        </div>

        {joining ? (
          <fieldset className="ob-orglist" disabled={busy}>
            <legend className="ob-field__label">Workspace</legend>
            <div className="ob-orglist__rows">
              {matchedOrgs.map((org) => (
                <label className={`ob-orgrow${org.id === selected?.id ? " is-sel" : ""}`} key={org.id}>
                  <input
                    type="radio"
                    name="ob-org"
                    className="ob-orgrow__radio"
                    checked={org.id === selected?.id}
                    onChange={() => onSelectOrg(org.id)}
                  />
                  <Avatar size="sm" color={hashColor(org.name)} initial={initialsOf(org.name)} />
                  <span className="ob-orgrow__meta">
                    <span className="ob-orgrow__name">{org.name}</span>
                    <span className="ob-orgrow__domain mono">{org.domain}</span>
                  </span>
                  <span className="ob-orgrow__count">
                    {org.memberCount} {org.memberCount === 1 ? "member" : "members"}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <div className="ob-field">
            <label className="ob-field__label" htmlFor="ob-workspace">Workspace name</label>
            <div className="ob-namerow">
              <Avatar
                size="md"
                color={hashColor(workspaceName.trim() || "Workspace")}
                initial={initialsOf(workspaceName || "W")}
                src={logoSrc ?? undefined}
              />
              <input
                id="ob-workspace"
                className="ob-input"
                autoComplete="organization"
                autoFocus={!focusHeading && !!name}
                value={workspaceName}
                placeholder="Acme"
                maxLength={120}
                disabled={busy}
                onChange={(event) => onWorkspaceNameChange(event.target.value)}
              />
            </div>
            <span className="ob-field__hint">
              {logoSrc && domain ? `Logo from ${domain}. ` : ""}Change the name and logo later in Settings.
            </span>
          </div>
        )}
      </div>

      <StepError message={error} />

      <div className="ob-foot ob-foot--stack">
        <Button type="submit" variant="primary" size="lg" className="ob-btn-block" disabled={!canSubmit || busy}>
          {busy ? (joining ? "Joining…" : "Saving…") : joining ? `Join ${selected?.name ?? "workspace"}` : "Continue"}
        </Button>
        {matchedOrgs.length > 0 ? (
          <button
            type="button"
            className="ob-textbtn"
            disabled={busy}
            onClick={() => onModeChange(joining ? "create" : "join")}
          >
            {joining ? "Create a new workspace" : "Join an existing workspace"}
          </button>
        ) : null}
      </div>
    </form>
  );
}
