import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { serverApiFetch, ServerApiError } from "@/lib/apiServer";
import { loadServerAuth } from "@/lib/serverAuth";
import {
  catalogModerationQueuePath,
  catalogReportQueueSchema,
  CATALOG_MODERATION_PAGE_SIZE,
  catalogModerationQueueSchema,
  hasNextCatalogModerationPage,
  parseCatalogModerationView,
  type CatalogModerationStatus,
  type CatalogModerationSubmission,
  type CatalogModerationView,
  type CatalogSkillReportsState,
} from "@/lib/catalogModeration";

export type CatalogModerationPageData =
  | { kind: "auth-unavailable" }
  | { kind: "load-error" }
  | {
      kind: "ready";
      view: CatalogModerationView;
      submissions: CatalogModerationSubmission[];
      hasNextPage: boolean;
      reports: CatalogSkillReportsState;
    };

const REPORTS_UNAVAILABLE: CatalogSkillReportsState = { status: "unavailable" };

/**
 * The API is the authority: it 404s while the catalog is disabled and 403s anyone without a live
 * platform moderator grant. Both render this page's 404 so the screen's existence never leaks.
 */
export async function loadCatalogModerationPage(
  params: Record<string, string | string[] | undefined>,
): Promise<CatalogModerationPageData> {
  const view = parseCatalogModerationView(params);
  return view.view === "queue"
    ? loadCatalogModerationView("queue", view.status, view.offset)
    : loadCatalogModerationView("reports", "proposed", view.offset ?? 0);
}

// Metadata and the page share one moderator check and queue request per render.
const loadCatalogModerationView = cache(async (
  kind: CatalogModerationView["view"],
  status: CatalogModerationStatus,
  offset: number,
): Promise<CatalogModerationPageData> => {
  if (process.env.SKILLPACK_PUBLIC_CATALOG !== "true") notFound();
  const auth = await loadServerAuth();
  if (auth.status === "unauthenticated") redirect("/login");
  if (auth.status === "unavailable") return { kind: "auth-unavailable" };

  // Both queue APIs recheck the live moderator grant.
  let payload: unknown;
  let failedStatus: number | null = null;
  try {
    payload = await serverApiFetch<unknown>(kind === "reports"
      ? `/v1/platform/catalog/reports?limit=${CATALOG_MODERATION_PAGE_SIZE}&offset=${offset}`
      : catalogModerationQueuePath(status, offset));
  } catch (error) {
    failedStatus = error instanceof ServerApiError ? error.status : 0;
  }
  if (failedStatus === 401) redirect("/login");
  if (failedStatus === 403 || failedStatus === 404) notFound();
  if (failedStatus !== null) return { kind: "load-error" };

  if (kind === "reports") {
    const parsed = catalogReportQueueSchema.safeParse(payload);
    if (!parsed.success) return { kind: "load-error" };
    return { kind: "ready", view: { view: "reports", offset }, submissions: [],
      hasNextPage: hasNextCatalogModerationPage(offset, parsed.data.reports.length),
      reports: { status: "ready", reports: parsed.data.reports } };
  }
  const parsed = catalogModerationQueueSchema.safeParse(payload);
  if (!parsed.success) return { kind: "load-error" };
  return {
    kind: "ready",
    view: { view: "queue", status, offset },
    submissions: parsed.data.submissions,
    hasNextPage: hasNextCatalogModerationPage(offset, parsed.data.submissions.length),
    reports: REPORTS_UNAVAILABLE,
  };
});
