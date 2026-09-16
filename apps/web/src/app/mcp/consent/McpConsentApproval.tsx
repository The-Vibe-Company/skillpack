"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiFetchError } from "@/lib/apiClient";
import { Icon } from "@/components/Icon";

interface PendingAuthorization {
  client_id: string;
  client_name: string | null;
  /** Where the authorization code would be sent. The name is self-declared; this is not. */
  redirect_origin: string | null;
  scopes: string[];
}

interface WorkspaceOption {
  org_id: string;
  name: string;
  org_role: string;
}

interface ConsentDecision {
  redirect_uri: string;
}

const SESSION_EXPIRED_MESSAGE = "Your session has expired. Sign in again to continue.";

/** What a failed consent request means to the member reading the screen. */
interface ConsentFailure {
  message: string;
  reauthRequired: boolean;
}

/** One place to decide what a failure means, so the load and decide paths cannot drift apart. */
function describeConsentError(cause: unknown, fallback: string): ConsentFailure {
  if (cause instanceof ApiFetchError && (cause.status === 401 || cause.status === 403)) {
    return { message: SESSION_EXPIRED_MESSAGE, reauthRequired: true };
  }
  return { message: cause instanceof Error ? cause.message : fallback, reauthRequired: false };
}

export function McpConsentApproval({ consentCode, returnPath }: { consentCode: string; returnPath: string }) {
  const [request, setRequest] = useState<PendingAuthorization | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "allowing" | "denying" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [reauthRequired, setReauthRequired] = useState(false);

  useEffect(() => {
    if (!consentCode) {
      setReauthRequired(false);
      setState("error");
      setError("This connection link is incomplete. Return to the app and start the connection again.");
      return;
    }
    let active = true;
    setReauthRequired(false);
    Promise.all([
      apiFetch<PendingAuthorization>(`/v1/mcp/consent?consent_code=${encodeURIComponent(consentCode)}`),
      apiFetch<WorkspaceOption[]>("/v1/orgs"),
    ])
      .then(([pending, orgs]) => {
        if (!active) return;
        setRequest(pending);
        setWorkspaces(orgs);
        setWorkspaceId(orgs[0]?.org_id ?? "");
        setState("ready");
      })
      .catch((cause) => {
        if (!active) return;
        const described = describeConsentError(cause, "Could not load this connection request.");
        setReauthRequired(described.reauthRequired);
        setState("error");
        setError(described.message);
      });
    return () => {
      active = false;
    };
  }, [consentCode]);

  const decide = async (accept: boolean) => {
    if (state === "allowing" || state === "denying") return;
    if (accept && !workspaceId) return;
    setState(accept ? "allowing" : "denying");
    setError(null);
    try {
      const decision = await apiFetch<ConsentDecision>("/v1/mcp/consent", {
        method: "POST",
        body: JSON.stringify({ consent_code: consentCode, accept, workspace_id: workspaceId }),
      });
      window.location.href = decision.redirect_uri;
    } catch (cause) {
      const described = describeConsentError(cause, "Could not record your decision.");
      setReauthRequired(described.reauthRequired);
      setState("error");
      setError(described.message);
    }
  };

  if (state === "loading") {
    return (
      <section className="device-approval" aria-busy="true">
        <div className="device-approval__skeleton" role="status">Loading connection request...</div>
      </section>
    );
  }

  if (!request || state === "error") {
    return (
      <section className="device-approval device-approval--error" role="alert">
        <span className="device-approval__mark"><Icon name="alert-triangle" size={18} /></span>
        <h1>Connection could not continue</h1>
        <p>{error ?? "This request is unavailable or has expired."}</p>
        {reauthRequired ? (
          <form className="device-approval__reauth" method="post" action="/v1/auth/logout">
            <input type="hidden" name="next" value={returnPath} />
            <button className="btn-primary" type="submit">Sign in again</button>
          </form>
        ) : (
          <a className="btn-sec" href={returnPath}>Try again</a>
        )}
      </section>
    );
  }

  return (
    <section className="device-approval" aria-labelledby="mcp-consent-title">
      <header>
        <span className="device-approval__mark"><Icon name="plug-zap" size={18} /></span>
        <div>
          <p className="device-approval__brand">Skillpack connection</p>
          <h1 id="mcp-consent-title">Connect {request.client_name ?? "this app"}</h1>
        </div>
      </header>

      <dl className="device-approval__identity">
        <div><dt>App</dt><dd>{request.client_name ?? "Unnamed client"}</dd></div>
        <div>
          <dt>Sends access to</dt>
          <dd>
            <span className="mono">{request.redirect_origin ?? "an unrecognized address"}</span>
            <small>Any app can choose its own name. This is where access actually goes.</small>
          </dd>
        </div>
        <div><dt>Client</dt><dd className="mono">{request.client_id}</dd></div>
        <div>
          <dt>Requests</dt>
          <dd className="mono">{request.scopes.length ? request.scopes.join(", ") : "no scopes"}</dd>
        </div>
      </dl>

      <fieldset className="device-approval__capabilities">
        <legend>Workspace</legend>
        <p>
          The app will work in this workspace only, with your own access to it. To connect another
          workspace, connect the app again and choose it there.
        </p>
        {workspaces.length === 0 ? (
          <p role="alert">You are not a member of any workspace yet.</p>
        ) : (
          workspaces.map((workspace) => (
            <label key={workspace.org_id}>
              <input
                type="radio"
                name="workspace"
                value={workspace.org_id}
                checked={workspaceId === workspace.org_id}
                onChange={() => setWorkspaceId(workspace.org_id)}
              />
              <span>
                <b>{workspace.name}</b>
                <small>Your role: {workspace.org_role}</small>
              </span>
            </label>
          ))
        )}
      </fieldset>

      <div className="device-approval__notice">
        <Icon name="info" size={14} />
        The app can read and change skills, folders, secrets and Skill Databases you can already
        reach. Disconnect it any time from Settings.
      </div>

      <footer>
        <button className="btn-sec" type="button" disabled={state !== "ready"} onClick={() => void decide(false)}>
          {state === "denying" ? <span className="cds-spinner" /> : <Icon name="x" size={14} />}
          Deny
        </button>
        <button
          className="btn-primary"
          type="button"
          disabled={state !== "ready" || !workspaceId}
          onClick={() => void decide(true)}
        >
          {state === "allowing" ? <span className="cds-spinner" /> : <Icon name="shield-check" size={14} />}
          Allow
        </button>
      </footer>
    </section>
  );
}
