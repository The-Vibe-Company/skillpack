import { redirect } from "next/navigation";
import type { OnboardingContextResponse } from "@skillpack/contracts";
import { serverApiFetch } from "@/lib/apiServer";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import type { OnboardingContext } from "@/lib/onboarding";
import { AuthUnavailable } from "@/components/org/WorkspaceLoadError";
import { loadOrgContext } from "@/lib/currentOrg";
import { loadServerAuth } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

interface WhoAmI {
  userId: string;
  email: string;
  name: string;
  onboarded?: boolean;
}

type SearchParams = Record<string, string | string[] | undefined>;

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const authState = await loadServerAuth<WhoAmI>();
  if (authState.status === "unauthenticated") redirect("/login");
  if (authState.status === "unavailable") return <AuthUnavailable />;
  const whoami = authState.user;
  const me = { name: whoami.name, email: whoami.email };

  if (whoami.onboarded) {
    // The workspace exists once step 2 succeeds, so only the agent step can be revisited (a reload
    // mid-setup). Everything else belongs to the app.
    const params = await searchParams;
    if (params.step !== "agent") redirect("/skills");
    const { current } = await loadOrgContext().catch(() => ({ current: null }));
    if (!current) redirect("/skills");
    const context: OnboardingContext = { email: whoami.email, domain: null, isPersonal: false, matchedOrgs: [] };
    return (
      <OnboardingFlow
        context={context}
        me={me}
        initialStep="agent"
        workspace={{ id: current.id, name: current.name }}
      />
    );
  }

  const raw = await serverApiFetch<OnboardingContextResponse>("/v1/onboarding/context").catch(() => null);
  const context: OnboardingContext = raw
    ? {
        email: raw.email,
        domain: raw.domain,
        isPersonal: raw.is_personal,
        matchedOrgs: (raw.matched_orgs ?? []).map((org) => ({
          id: org.id,
          name: org.name,
          domain: org.domain,
          memberCount: org.member_count,
        })),
      }
    : { email: whoami.email, domain: null, isPersonal: false, matchedOrgs: [] };

  return <OnboardingFlow context={context} me={me} />;
}
