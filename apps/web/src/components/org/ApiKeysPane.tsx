"use client";

import { useState } from "react";
import { Icon } from "../Icon";
import { Dialog } from "./primitives";
import { PaneHead } from "./paneKit";
import type { ApiKeyVM, OrgCtx } from "./model";

/** The one-time secret payload surfaced by CreateKeyDialog and revealed by KeyRevealDialog. */
interface RevealedKey {
  name: string;
  secret: string;
}

/* ============================ Account › API keys ============================ */
export function ApiKeysPane({ ctx, keys }: { ctx: OrgCtx; keys: ApiKeyVM[] }) {
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<RevealedKey | null>(null);
  return (
    <div className="sx-pane">
      <PaneHead
        title="API keys"
        desc="Personal keys to authenticate with the Skillpack API and CLI. They carry your access — treat them like passwords and never commit them."
        action={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={14} />
            Create key
          </button>
        }
      />

      <div className="og-lockbar og-lockbar--wide" style={{ marginBottom: 18 }}>
        <Icon name="shield-check" size={13} />
        <span>Keys are shown in full only once, at creation. Skillpack stores a hash, never the raw value.</span>
      </div>

      {keys.length === 0 ? (
        <div className="sx-empty">No API keys yet. Create one to use the Skillpack CLI or call the API.</div>
      ) : (
        <>
          <div className="mlist__lbl">
            <span>
              {keys.length} key{keys.length === 1 ? "" : "s"}
            </span>
            <span className="n">last used</span>
          </div>
          <div className="mlist">
            {keys.map((k) => (
              <div className="mrow mrow--apikey" key={k.id}>
                <span className="keyic">
                  <Icon name="key" size={16} />
                </span>
                <div className="mrow__id">
                  <div className="og-mname">
                    {k.name}
                    <span className="badge scopebadge">{k.access === "full" ? "Full" : "Limited"}</span>
                  </div>
                  <div className="keytok">
                    <span className="keytok__part"><b>{k.prefix}</b>••••••••••••{k.last4}</span>
                    <span className="keytok__part">created {k.created}</span>
                    <span className="keytok__part">expires {k.expires}</span>
                  </div>
                </div>
                <div className="mrow__end">
                  <span className="mrow__meta" style={{ minWidth: 110 }}>
                    {k.lastUsed === "never" ? "never used" : k.lastUsed}
                  </span>
                  <button className="mrow__x" title="Revoke key" onClick={() => ctx.revokeApiKey(k.id)}>
                    <Icon name="trash-2" size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {creating && (
        <CreateKeyDialog
          ctx={ctx}
          onClose={() => setCreating(false)}
          onCreated={(r) => {
            setCreating(false);
            setRevealed(r);
          }}
        />
      )}
      {revealed && <KeyRevealDialog data={revealed} onClose={() => setRevealed(null)} />}
    </div>
  );
}

/** Name-only creation; every new human key carries the complete current capability set. */
function CreateKeyDialog({
  ctx,
  onClose,
  onCreated,
}: {
  ctx: OrgCtx;
  onClose: () => void;
  onCreated: (revealed: RevealedKey) => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = name.trim().length >= 2;
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const secret = await ctx.createApiKey(name.trim());
      onCreated({ name: name.trim(), secret });
    } catch {
      // createApiKey already surfaced the failure via ctx.setError; swallow here so the
      // `void submit()` callers don't produce an unhandled rejection. The dialog stays open
      // (busy cleared below) so the user can retry or cancel.
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      icon="key"
      title="Create API key"
      desc="Name the key. It will have full access to the skills, secrets, and databases you can use. You'll see the secret once."
      onClose={onClose}
      foot={
        <>
          <span className="og-spacer" />
          <button className="btn-sec" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!valid || busy} onClick={() => void submit()}>
            <Icon name="key" size={14} />
            Create key
          </button>
        </>
      }
    >
      <div className="og-field">
        <label className="og-field__label">Name</label>
        <input
          className="sx-input"
          autoFocus
          placeholder="Local CLI"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
        <span className="og-field__hint">A label so you can recognize this key later.</span>
      </div>
    </Dialog>
  );
}

/** One-time reveal of a freshly created key's plaintext secret with copy-to-clipboard. */
function KeyRevealDialog({ data, onClose }: { data: RevealedKey; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard may be unavailable (insecure context); the secret stays visible to copy manually.
    }
  };
  return (
    <Dialog
      icon="key"
      title={data.name + " created"}
      desc="Copy this key now. For your security it won't be shown again."
      onClose={onClose}
      foot={
        <>
          <span className="og-spacer" />
          <button className="btn-primary" onClick={onClose}>
            <Icon name="check" size={14} />
            Done
          </button>
        </>
      }
    >
      <div className="og-field">
        <label className="og-field__label">Secret key</label>
        <div className="secretbox">
          <span>{data.secret}</span>
          <button className="iconbtn" title="Copy" onClick={() => void copy()}>
            <Icon name={copied ? "check" : "copy"} size={15} />
          </button>
        </div>
        <span className="og-field__hint">
          <Icon name="alert-triangle" size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />
          Store it in a secret manager. Anyone with this key has full access to the skills, secrets, and databases you
          can use.
        </span>
      </div>
    </Dialog>
  );
}
