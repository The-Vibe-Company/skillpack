import { z } from "zod";
import { apiFetch } from "@/lib/apiClient";

/** Queue tabs mirror the statuses accepted by `GET /v1/platform/catalog/submissions`. */
export const CATALOG_MODERATION_STATUSES = ["proposed", "validated", "rejected", "removed"] as const;
export type CatalogModerationStatus = (typeof CATALOG_MODERATION_STATUSES)[number];
export const CATALOG_MODERATION_PAGE_SIZE = 20;
const MAX_OFFSET = 10_000;
export const CATALOG_MODERATION_REASON_MAX = 2000;

const submissionSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  skill_id: z.string(),
  skill_version_id: z.string(),
  package_checksum: z.string(),
  status: z.enum(CATALOG_MODERATION_STATUSES),
  kind: z.string(),
  rejection_reason: z.string().nullable(),
  created_at: z.string(),
  decided_at: z.string().nullable(),
  check_status: z.enum(["pending", "passed", "failed"]),
  check_reason: z.string().nullable(),
});
export const catalogModerationQueueSchema = z.object({ submissions: z.array(submissionSchema) });
export type CatalogModerationSubmission = z.infer<typeof submissionSchema>;

/**
 * Incoming skill report, as the catalog reporting API (PR 7/9) will serve it. Until that API ships
 * the server loader returns `unavailable`, and the Reports tab says so instead of an empty inbox.
 */
export interface CatalogSkillReport {
  id: string;
  org_id: string;
  skill_id: string;
  submission_id: string | null;
  reason: string;
  details: string | null;
  created_at: string;
}
export type CatalogSkillReportsState =
  | { status: "unavailable" }
  | { status: "ready"; reports: CatalogSkillReport[] };

export type CatalogModerationView =
  | { view: "queue"; status: CatalogModerationStatus; offset: number }
  | { view: "reports" };

type SearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Unknown or out-of-range params fall back to the first page of proposals. */
export function parseCatalogModerationView(params: SearchParams): CatalogModerationView {
  if (single(params.view) === "reports") return { view: "reports" };
  const status = CATALOG_MODERATION_STATUSES.find((value) => value === single(params.status)) ?? "proposed";
  const rawOffset = Number(single(params.offset) ?? 0);
  const offset = Number.isInteger(rawOffset) && rawOffset >= 0 && rawOffset <= MAX_OFFSET
    ? rawOffset - (rawOffset % CATALOG_MODERATION_PAGE_SIZE)
    : 0;
  return { view: "queue", status, offset };
}

export function catalogModerationHref(view: CatalogModerationView): string {
  if (view.view === "reports") return "/platform/catalog?view=reports";
  const params = new URLSearchParams({ status: view.status });
  if (view.offset > 0) params.set("offset", String(view.offset));
  return `/platform/catalog?${params.toString()}`;
}

export function catalogModerationQueuePath(status: CatalogModerationStatus, offset: number): string {
  const params = new URLSearchParams({
    status,
    limit: String(CATALOG_MODERATION_PAGE_SIZE),
    offset: String(offset),
  });
  return `/v1/platform/catalog/submissions?${params.toString()}`;
}

export function hasNextCatalogModerationPage(offset: number, count: number): boolean {
  return count === CATALOG_MODERATION_PAGE_SIZE && offset + CATALOG_MODERATION_PAGE_SIZE <= MAX_OFFSET;
}

export type CatalogModerationDecision =
  | { action: "validate"; submission: CatalogModerationSubmission }
  | { action: "reject" | "remove"; submission: CatalogModerationSubmission; reason: string }
  | { action: "ban"; orgId: string; reason: string };

interface CatalogModerationRequest {
  path: string;
  body: string;
}

function decisionRequest(decision: CatalogModerationDecision): CatalogModerationRequest {
  if (decision.action === "ban") {
    return {
      path: `/v1/platform/catalog/organizations/${encodeURIComponent(decision.orgId)}/ban`,
      body: JSON.stringify({ reason: decision.reason.trim() }),
    };
  }
  const { org_id: orgId, id } = decision.submission;
  return {
    path: `/v1/platform/catalog/organizations/${encodeURIComponent(orgId)}/submissions/${encodeURIComponent(id)}/${decision.action}`,
    body: JSON.stringify(decision.action === "validate" ? {} : { reason: decision.reason.trim() }),
  };
}

/** Moderation is session-only; the same-origin proxy forwards the browser cookie to the API. */
export async function submitCatalogModerationDecision(decision: CatalogModerationDecision): Promise<void> {
  const request = decisionRequest(decision);
  await apiFetch<{ ok: true }>(request.path, { method: "POST", body: request.body });
}
