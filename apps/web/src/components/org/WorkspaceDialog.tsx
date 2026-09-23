"use client";

import { useEffect, useState } from "react";
import { Icon } from "../Icon";
import { Dialog } from "./primitives";

export type WorkspaceDialogMode = "create" | "join";

/** Add a workspace from the switcher: create a new one, or join one with an invite link. */
export function WorkspaceDialog({
  mode,
  onClose,
  onCreate,
  onJoin,
  busy,
}: {
  mode: WorkspaceDialogMode;
  onClose: () => void;
  onCreate: (name: string) => void;
  onJoin: (codeOrLink: string) => void;
  busy: boolean;
}) {
  if (mode === "join") return <JoinWorkspace onJoin={onJoin} busy={busy} onClose={onClose} />;
  return <CreateWorkspace onCreate={onCreate} busy={busy} onClose={onClose} />;
}

function CreateWorkspace({
  onCreate,
  busy,
  onClose,
}: {
  onCreate: (name: string) => void;
  busy: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const valid = name.trim().length > 0;
  const submit = () => {
    if (valid && !busy) onCreate(name.trim());
  };
  return (
    <Dialog
      icon="plus"
      title="Create a workspace"
      desc="Members, skills, and agent access live here. You're the owner."
      onClose={onClose}
      foot={
        <>
          <span className="og-spacer" />
          <button className="btn-sec" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-primary" disabled={!valid || busy} onClick={submit}>
            Create workspace
          </button>
        </>
      }
    >
      <div className="og-field">
        <label className="og-field__label" htmlFor="workspace-name">Workspace name</label>
        <input
          id="workspace-name"
          className="og-input"
          autoFocus
          placeholder="Acme"
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        />
        <span className="og-field__hint">Invite members from Settings after it&rsquo;s created.</span>
      </div>
    </Dialog>
  );
}

function JoinWorkspace({
  onJoin,
  busy,
  onClose,
}: {
  onJoin: (codeOrLink: string) => void;
  busy: boolean;
  onClose: () => void;
}) {
  const [code, setCode] = useState("");
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.host), []);
  const valid = code.trim().length >= 4;
  const submit = () => {
    if (valid && !busy) onJoin(code.trim());
  };
  return (
    <Dialog
      icon="log-in"
      title="Join a workspace"
      desc="Paste the invite link or code you received."
      onClose={onClose}
      foot={
        <>
          <span className="og-spacer" />
          <button className="btn-sec" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-primary" disabled={!valid || busy} onClick={submit}>
            <Icon name="log-in" size={14} />
            Join
          </button>
        </>
      }
    >
      <div className="og-field">
        <label className="og-field__label" htmlFor="workspace-invite">Invite link or code</label>
        <input
          id="workspace-invite"
          className="og-input og-input--mono"
          autoFocus
          placeholder={`${origin || "skillpack.example.com"}/join/…`}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        />
        <span className="og-field__hint">The full link or just the code.</span>
      </div>
    </Dialog>
  );
}
