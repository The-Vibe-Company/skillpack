"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { hashColor } from "@/components/branding";
import {
  completeOnboarding,
  initialDisplayName,
  joinByDomain,
  suggestWorkspaceName,
  type OnboardingContext,
} from "@/lib/onboarding";
import { updateMe } from "@/lib/org";
import { ConnectAgentStep } from "./ConnectAgentStep";
import { OnboardingShell, type OnboardingStep } from "./OnboardingShell";
import { TeamStep } from "./TeamStep";
import { useBrandIcon } from "./useBrandIcon";
import { WorkspaceStep, type WorkspaceMode } from "./WorkspaceStep";

/** The workspace the member ended up in; step 3 connects their agent to it. */
export interface OnboardedWorkspace {
  id: string;
  name: string;
}

/** Step 3 must survive a reload: the member is already onboarded once the workspace exists. */
const AGENT_STEP_URL = "/onboarding?step=agent";

const FALLBACK_ERROR = "Something went wrong. Try again.";

/**
 * First-run setup: Workspace (create or join by email domain) → Team (invitations, create path only)
 * → Agent (hand the Skillpack setup prompt to a coding agent and watch it connect). Nothing is
 * created until the member confirms on the Team step, and every button does what its label says.
 */
export function OnboardingFlow({
  context,
  me,
  initialStep = "workspace",
  workspace = null,
}: {
  context: OnboardingContext;
  me: { name: string; email: string };
  initialStep?: "workspace" | "agent";
  workspace?: OnboardedWorkspace | null;
}) {
  const router = useRouter();
  const email = context.email || me.email;
  const corporateDomain = context.isPersonal ? null : context.domain;

  const [step, setStep] = useState<OnboardingStep>(workspace ? initialStep : "workspace");
  const [mode, setMode] = useState<WorkspaceMode>(context.matchedOrgs.length > 0 ? "join" : "create");
  const [name, setName] = useState(() => initialDisplayName(me.name, email));
  const [savedName, setSavedName] = useState(() => me.name.trim());
  const [workspaceName, setWorkspaceName] = useState(() => suggestWorkspaceName(corporateDomain));
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(context.matchedOrgs[0]?.id ?? null);
  const [invites, setInvites] = useState<string[]>([]);
  const [allowDomain, setAllowDomain] = useState(Boolean(corporateDomain));
  const [result, setResult] = useState<(OnboardedWorkspace & { invitedCount: number | null }) | null>(
    workspace ? { ...workspace, invitedCount: null } : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [movedOn, setMovedOn] = useState(false);
  const logoSrc = useBrandIcon(corporateDomain);

  const goTo = (next: OnboardingStep) => {
    setError(null);
    setMovedOn(true);
    setStep(next);
  };

  const saveName = async () => {
    const trimmed = name.trim();
    if (trimmed === savedName) return;
    await updateMe(trimmed);
    setSavedName(trimmed);
  };

  const enterAgentStep = (next: OnboardedWorkspace & { invitedCount: number | null }) => {
    setResult(next);
    window.history.replaceState(null, "", AGENT_STEP_URL);
    goTo("agent");
  };

  const submitWorkspace = async () => {
    setError(null);
    setBusy(true);
    try {
      await saveName();
      if (mode === "join") {
        const org = context.matchedOrgs.find((o) => o.id === selectedOrgId) ?? context.matchedOrgs[0];
        if (!org) throw new Error("Choose a workspace to join.");
        const joined = await joinByDomain(org.id);
        enterAgentStep({ id: joined.orgId, name: org.name, invitedCount: null });
      } else {
        goTo("team");
      }
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  };

  const createWorkspace = async (finalInvites: string[]) => {
    setError(null);
    setBusy(true);
    const orgName = workspaceName.trim();
    try {
      const created = await completeOnboarding({
        org: {
          name: orgName,
          domain: corporateDomain,
          autoJoin: Boolean(corporateDomain) && allowDomain,
          color: hashColor(orgName),
          logoUrl: logoSrc,
        },
        invites: finalInvites,
      });
      enterAgentStep({ id: created.orgId, name: orgName, invitedCount: created.invited.length });
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  };

  const openApp = () => {
    router.push("/skills");
    router.refresh();
  };

  let body: React.ReactNode;
  if (step === "agent" && result) {
    body = (
      <ConnectAgentStep
        workspaceId={result.id}
        workspaceName={result.name}
        invitedCount={result.invitedCount}
        onFinish={openApp}
      />
    );
  } else if (step === "team") {
    body = (
      <TeamStep
        invites={invites}
        onInvitesChange={setInvites}
        allowDomain={allowDomain}
        onAllowDomainChange={setAllowDomain}
        domain={corporateDomain}
        selfEmail={email}
        busy={busy}
        error={error}
        onBack={() => goTo("workspace")}
        onSubmit={(finalInvites) => void createWorkspace(finalInvites)}
      />
    );
  } else {
    body = (
      <WorkspaceStep
        mode={mode}
        onModeChange={(next) => {
          setError(null);
          setMode(next);
        }}
        name={name}
        onNameChange={setName}
        workspaceName={workspaceName}
        onWorkspaceNameChange={setWorkspaceName}
        logoSrc={logoSrc}
        domain={corporateDomain}
        matchedOrgs={context.matchedOrgs}
        selectedOrgId={selectedOrgId}
        onSelectOrg={setSelectedOrgId}
        busy={busy}
        error={error}
        focusHeading={movedOn}
        onSubmit={() => void submitWorkspace()}
      />
    );
  }

  return (
    <OnboardingShell step={step} teamSkipped={mode === "join" && step === "agent"} email={email}>
      {body}
    </OnboardingShell>
  );
}
