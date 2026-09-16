import { redirect } from "next/navigation";
import { loadServerAuth } from "@/lib/serverAuth";
import { McpConsentApproval } from "./McpConsentApproval";

export const dynamic = "force-dynamic";

/** Next hands repeated query parameters through as arrays; the consent flow only ever sends one. */
function valueOf(value: string | string[] | undefined): string {
  if (value === undefined) return "";
  return Array.isArray(value) ? value[0] ?? "" : value;
}

export default async function McpConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const consentCode = valueOf(params.consent_code).trim();
  const clientId = valueOf(params.client_id).trim();
  const scope = valueOf(params.scope).trim();
  const returnPath = `/mcp/consent?consent_code=${encodeURIComponent(consentCode)}`
    + `&client_id=${encodeURIComponent(clientId)}&scope=${encodeURIComponent(scope)}`;
  const auth = await loadServerAuth();
  if (auth.status === "unauthenticated") redirect(`/login?next=${encodeURIComponent(returnPath)}`);

  return (
    <main className="device-approval-page">
      {auth.status === "unavailable" ? (
        <section className="device-approval device-approval--error" role="alert">
          <h1>Connection unavailable</h1>
          <p>Skillpack could not verify your session. Refresh when the API is reachable.</p>
        </section>
      ) : (
        <McpConsentApproval consentCode={consentCode} returnPath={returnPath} />
      )}
    </main>
  );
}
