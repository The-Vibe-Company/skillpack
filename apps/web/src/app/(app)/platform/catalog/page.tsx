import type { Metadata } from "next";
import { AuthUnavailable, WorkspaceLoadError } from "@/components/org/WorkspaceLoadError";
import { CatalogModerationApp } from "@/components/moderation/CatalogModerationApp";
import { loadCatalogModerationPage } from "@/lib/catalogModerationData";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The title names the screen only after the moderator check; everyone else gets the 404's metadata. */
export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const data = await loadCatalogModerationPage(await searchParams);
  return data.kind === "ready"
    ? { title: "Catalog moderation", robots: { index: false, follow: false } }
    : { robots: { index: false, follow: false } };
}

export default async function CatalogModerationPage({ searchParams }: PageProps) {
  const data = await loadCatalogModerationPage(await searchParams);
  if (data.kind === "auth-unavailable") return <AuthUnavailable />;
  if (data.kind === "load-error") {
    return (
      <WorkspaceLoadError
        title="Couldn't load the moderation queue"
        description="Refresh to try again. If the problem continues, check that the API and database are reachable."
      />
    );
  }
  return (
    <CatalogModerationApp
      view={data.view}
      submissions={data.submissions}
      hasNextPage={data.hasNextPage}
      reports={data.reports}
    />
  );
}
