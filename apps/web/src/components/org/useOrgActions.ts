"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { acceptInvite, createOrg as createOrgRpc, setCurrentOrg } from "@/lib/org";
import type { WorkspaceDialogMode } from "./WorkspaceDialog";

/** Shell-level workspace actions shared by the Skills + Settings shells. */
export function useOrgActions() {
  const router = useRouter();
  const [workspaceDialog, setWorkspaceDialog] = useState<WorkspaceDialogMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchOrg = async (id: string) => {
    setError(null);
    setBusy(true);
    try {
      await setCurrentOrg(id);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const createOrg = async (name: string) => {
    setError(null);
    setBusy(true);
    try {
      const { id } = await createOrgRpc(name);
      await setCurrentOrg(id);
      setWorkspaceDialog(null);
      router.push("/skills");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const joinOrg = async (codeOrLink: string) => {
    const raw = codeOrLink.includes("/join/") ? (codeOrLink.split("/join/").pop() ?? "") : codeOrLink;
    // Drop a trailing slash / query / hash so a pasted ".../join/<token>/" still resolves.
    const token = raw.trim().replace(/[/?#].*$/, "");
    setError(null);
    setBusy(true);
    try {
      const { orgId } = await acceptInvite(token);
      if (orgId) await setCurrentOrg(orgId);
      setWorkspaceDialog(null);
      router.push("/skills");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return { workspaceDialog, setWorkspaceDialog, busy, error, setError, switchOrg, createOrg, joinOrg };
}
