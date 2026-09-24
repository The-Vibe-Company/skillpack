import { redirect } from "next/navigation";
import { loadServerAuth } from "@/lib/serverAuth";
import { CliApproval } from "./CliApproval";

export const dynamic = "force-dynamic";

export default async function CliApprovePage({ searchParams }: { searchParams: Promise<{ request_id?: string }> }) {
  const { request_id: id = "" } = await searchParams;
  const returnPath = `/cli/approve?request_id=${encodeURIComponent(id)}`;
  const auth = await loadServerAuth();
  if (auth.status === "unauthenticated") redirect(`/login?next=${encodeURIComponent(returnPath)}`);
  return <main className="device-approval-page">{auth.status === "unavailable" ? (
    <section className="device-approval device-approval--error" role="alert">
      <h1>Approval unavailable</h1><p>Skillpack could not verify your session. Refresh when the API is reachable.</p>
    </section>
  ) : <CliApproval requestId={id} />}</main>;
}
