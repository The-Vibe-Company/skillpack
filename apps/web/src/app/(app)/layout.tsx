import { redirect } from "next/navigation";
import { AnalyticsIdentity } from "@/components/auth/AnalyticsIdentity";
import { SessionKeepAlive } from "@/components/auth/SessionKeepAlive";
import { AuthUnavailable } from "@/components/org/WorkspaceLoadError";
import type { AnalyticsUser } from "@/lib/analytics";
import { loadServerAuth } from "@/lib/serverAuth";

export default async function AppLayout({
  children,
  settings,
}: {
  children: React.ReactNode;
  settings: React.ReactNode;
}) {
  const authState = await loadServerAuth<AnalyticsUser>();
  if (authState.status === "unauthenticated") redirect("/login");
  if (authState.status === "unavailable") return <AuthUnavailable />;
  const { userId, email, org } = authState.user;
  return (
    <>
      <SessionKeepAlive />
      <AnalyticsIdentity user={{ userId, email, org: org ? { org_id: org.org_id, name: org.name } : null }} />
      {children}
      {settings}
    </>
  );
}
