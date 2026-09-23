"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/cds";
import { Icon } from "@/components/Icon";
import { normalizeInvite } from "@/lib/onboarding";
import { StepError, StepHeading } from "./StepHeading";

/** Email chips: Enter, comma, space, or leaving the field adds the typed address. */
function InviteInput({
  invites,
  onInvitesChange,
  selfEmail,
  domain,
  disabled,
  draft,
  onDraftChange,
  inputError,
  onInputError,
}: {
  invites: string[];
  onInvitesChange: (next: string[]) => void;
  selfEmail: string;
  domain: string | null;
  disabled: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  inputError: string | null;
  onInputError: (message: string | null) => void;
}) {
  const add = () => {
    if (!draft.trim()) return;
    const result = normalizeInvite(draft, { existing: invites, selfEmail });
    if (!result.ok) {
      onInputError(result.error);
      return;
    }
    onInvitesChange([...invites, result.email]);
    onDraftChange("");
    onInputError(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "," || event.key === " " || (event.key === "Enter" && draft.trim())) {
      event.preventDefault();
      add();
    } else if (event.key === "Backspace" && !draft && invites.length) {
      onInvitesChange(invites.slice(0, -1));
    }
  };

  return (
    <div className="ob-field">
      <label className="ob-field__label" htmlFor="ob-invite">Email addresses</label>
      <div className={`ob-invitebox${inputError ? " is-invalid" : ""}`}>
        {invites.map((email) => (
          <span className="ob-chip" key={email}>
            {email}
            <button
              type="button"
              className="ob-chip__x"
              disabled={disabled}
              onClick={() => onInvitesChange(invites.filter((x) => x !== email))}
              aria-label={`Remove ${email}`}
            >
              <Icon name="x" size={12} />
            </button>
          </span>
        ))}
        <input
          id="ob-invite"
          className="ob-invitebox__input"
          type="email"
          inputMode="email"
          autoComplete="off"
          value={draft}
          disabled={disabled}
          aria-invalid={inputError ? true : undefined}
          aria-describedby="ob-invite-hint"
          placeholder={invites.length ? "Add another" : `name@${domain ?? "company.com"}`}
          onChange={(event) => {
            onDraftChange(event.target.value);
            if (inputError) onInputError(null);
          }}
          onKeyDown={onKeyDown}
          onBlur={add}
        />
      </div>
      <span id="ob-invite-hint" className={inputError ? "ob-field__error" : "ob-field__hint"}>
        {inputError ?? "Press Enter or comma to add. Up to 50."}
      </span>
    </div>
  );
}

export function TeamStep({
  invites,
  onInvitesChange,
  allowDomain,
  onAllowDomainChange,
  domain,
  selfEmail,
  busy,
  error,
  onBack,
  onSubmit,
}: {
  invites: string[];
  onInvitesChange: (next: string[]) => void;
  allowDomain: boolean;
  onAllowDomainChange: (value: boolean) => void;
  /** The member's corporate domain; domain access is only offered for it. */
  domain: string | null;
  selfEmail: string;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  /** Receives the final invite list, including an address still typed in the field. */
  onSubmit: (invites: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    let finalInvites = invites;
    if (draft.trim()) {
      const result = normalizeInvite(draft, { existing: invites, selfEmail });
      if (!result.ok) {
        setInputError(result.error);
        return;
      }
      finalInvites = [...invites, result.email];
      onInvitesChange(finalInvites);
      setDraft("");
    }
    onSubmit(finalInvites);
  };

  const draftValid = draft.trim() ? normalizeInvite(draft, { existing: invites, selfEmail }).ok : false;
  const count = invites.length + (draftValid ? 1 : 0);
  const label = busy ? "Creating…" : count ? `Create and invite ${count}` : "Create workspace";

  return (
    <form onSubmit={submit} noValidate>
      <StepHeading title="Invite your team" focusOnMount>
        Invitations are emailed when you create the workspace. Optional.
      </StepHeading>

      <div className="ob-body">
        <InviteInput
          invites={invites}
          onInvitesChange={onInvitesChange}
          selfEmail={selfEmail}
          domain={domain}
          disabled={busy}
          draft={draft}
          onDraftChange={setDraft}
          inputError={inputError}
          onInputError={setInputError}
        />

        {domain ? (
          <label className="ob-toggle">
            <span className="ob-toggle__meta">
              <span className="ob-toggle__title">
                Allow verified <span className="mono">@{domain}</span> emails to join
              </span>
              <span className="ob-toggle__desc">
                They join as Developers without an invite. Change this in Settings.
              </span>
            </span>
            <span className="ob-switch">
              <input
                type="checkbox"
                role="switch"
                checked={allowDomain}
                disabled={busy}
                onChange={(event) => onAllowDomainChange(event.target.checked)}
              />
              <span className="ob-switch__track" />
              <span className="ob-switch__thumb" />
            </span>
          </label>
        ) : null}
      </div>

      <StepError message={error} />

      <div className="ob-foot">
        <Button type="button" variant="ghost" size="lg" disabled={busy} onClick={onBack} iconLeft={<Icon name="arrow-left" />}>
          Back
        </Button>
        <span className="ob-spacer" />
        <Button type="submit" variant="primary" size="lg" disabled={busy}>
          {label}
        </Button>
      </div>
    </form>
  );
}
