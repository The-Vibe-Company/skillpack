"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { Icon } from "@/components/Icon";

type Workspace = { id: string; name: string };
type State = "loading" | "ready" | "saving" | "approved" | "denied" | "error";
export type CliApprovalApi = {
  load(requestId: string): Promise<{ workspaces: Workspace[] }>;
  decide(requestId: string, decision: "approve" | "deny", workspaceId?: string): Promise<void>;
};
const defaultApi: CliApprovalApi = {
  load: (id) => apiFetch(`/v1/cli-login/request?request_id=${id}`),
  async decide(id, decision, workspaceId) {
    const payload = { request_id: id, decision, workspace_id: workspaceId };
    await apiFetch("/v1/cli-login/decision", { method: "POST", body: JSON.stringify(payload) });
  },
};

export function CliApproval({ requestId, api = defaultApi }: { requestId: string; api?: CliApprovalApi }) {
  const [state, setState] = useState<State>("loading");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!/^[a-f0-9]{64}$/.test(requestId)) { setError("This link is incomplete. Restart skillpack auth login."); setState("error"); return; }
    let active = true;
    api.load(requestId)
      .then(({ workspaces: available }) => { if (!active) return; setWorkspaces(available); setSelected(available[0]?.id ?? ""); setState("ready"); })
      .catch((cause) => { if (!active) return; setError(cause instanceof Error ? cause.message : "Could not load this request."); setState("error"); });
    return () => { active = false; };
  }, [requestId, api]);

  async function decide(decision: "approve" | "deny") {
    if (state !== "ready") return;
    setState("saving");
    try {
      await api.decide(requestId, decision, decision === "approve" ? selected : undefined);
      setState(decision === "approve" ? "approved" : "denied");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save your decision."); setState("error"); }
  }

  if (state === "loading") return <section className="device-approval" role="status">Loading CLI request...</section>;
  if (state === "error") return <section className="device-approval device-approval--error" role="alert"><h1>Approval could not continue</h1><p>{error}</p></section>;
  if (state === "approved" || state === "denied") return <section className="device-approval" role="status"><h1>{state === "approved" ? "CLI access approved" : "CLI access denied"}</h1><p>{state === "approved" ? "Return to your terminal. Skillpack will finish connecting automatically." : "No key was issued. You can close this tab."}</p></section>;

  return <section className="device-approval">
    <header><span className="device-approval__mark"><Icon name="terminal" size={18} /></span><div><p className="device-approval__brand">SKILLPACK</p><h1>Connect the Skillpack CLI</h1></div></header>
    <p>Approve this terminal to manage skills, secrets and Skill Databases with your account. The CLI will receive a personal API key for the selected workspace. Approve only if you started <code>skillpack auth login</code>.</p>
    <label className="cli-approval__workspace" htmlFor="cli-workspace">Workspace</label>
    <select id="cli-workspace" value={selected} onChange={(event) => setSelected(event.target.value)} disabled={state === "saving"}>
      {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
    </select>
    <p className="cli-approval__scope">Access includes skills, secrets, Skill Databases and public installs under your existing membership. A key cannot override private resources or a revoked membership. You can revoke it from API keys in settings.</p>
    <div className="cli-approval__actions"><button type="button" className="btn-sec" onClick={() => decide("deny")} disabled={state === "saving"}>Deny</button><button type="button" className="btn-primary" onClick={() => decide("approve")} disabled={!selected || state === "saving"}>Approve CLI access</button></div>
  </section>;
}
