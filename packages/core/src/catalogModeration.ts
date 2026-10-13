import { sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Db } from "@skillpack/db";
import {
  catalogCheckReportSchema,
  catalogModerationCheckReportSchema, catalogModerationQuerySchema, catalogModerationReasonSchema,
  type CatalogModerationCheckReport,
} from "@skillpack/contracts";

export interface CatalogCheckIdentity {
  orgId: string;
  submissionId: string;
  skillVersionId: string;
  packageChecksum: string;
}
/** Read a persisted report; never execute checks or package code in this consumer. */
export type CatalogCheckReader = (input: CatalogCheckIdentity & { database: Db }) => Promise<CatalogModerationCheckReport | null>;
let checkReader: CatalogCheckReader = async () => null;
/** PR 3 wires its persisted report reader once at API startup. Missing reports fail closed. */
export function configureCatalogCheckReader(reader: CatalogCheckReader): void { checkReader = reader; }

/**
 * Read the checks engine's value-free report through the narrow API-only database function. The
 * function matches all frozen identity fields; malformed, missing, or internally inconsistent
 * reports remain pending and cannot authorize moderation.
 */
export const readPersistedCatalogCheckReport: CatalogCheckReader = async (input) => {
  const { database, ...identity } = input;
  const rows = await database.execute<{ check_report: unknown }>(sql`
    select public.skillpack_catalog_check_report(
      ${identity.orgId}::uuid,
      ${identity.submissionId}::uuid,
      ${identity.skillVersionId}::uuid,
      ${identity.packageChecksum}
    ) as check_report
  `);
  const raw = rows[0]?.check_report;
  if (raw === null || raw === undefined) return null;
  const report = catalogCheckReportSchema.safeParse(raw);
  if (!report.success) return null;
  const blockingRules = report.data.findings
    .filter((finding) => finding.severity === "blocking")
    .map((finding) => finding.rule_id);
  const failedReason = (blockingRules.join(",").slice(0, 2000) || "catalog checks failed");
  return {
    ...identity,
    status: report.data.passed && blockingRules.length === 0 ? "passed" : "failed",
    reason: report.data.passed && blockingRules.length === 0 ? null : failedReason,
  };
};

export class CatalogModerationError extends Error {
  constructor(message: string, readonly status: 403 | 404 | 409) { super(message); }
}

function configuredId(name: string, id: string): boolean {
  return (process.env[name] ?? "").split(",").map(value => value.trim()).filter(Boolean).includes(id);
}
function enabled(): void {
  if (process.env.SKILLPACK_PUBLIC_CATALOG !== "true") throw new CatalogModerationError("not found", 404);
}
export async function assertCatalogModerator(input: { actorId: string; database?: Db }): Promise<void> {
  enabled();
  const rows = await (input.database ?? db).execute<{ allowed: boolean }>(sql`
    select public.skillpack_is_catalog_moderator(${input.actorId},
      ${configuredId("SKILLPACK_CATALOG_MODERATOR_USER_IDS", input.actorId)}) as allowed
  `);
  if (!rows[0]?.allowed) throw new CatalogModerationError("platform moderator required", 403);
}

export async function catalogPublishingPolicy(database: Db, orgId: string, lock = false) {
  if (lock) {
    const rows = await database.execute<{ banned: boolean }>(sql`select public.skillpack_lock_catalog_publishing(${orgId}::uuid) as banned`);
    return { banned: rows[0]?.banned ?? false, auto_approve: false };
  }
  const rows = await database.execute<{ banned: boolean; auto_approve: boolean }>(sql`select * from public.skillpack_catalog_publishing_policy(${orgId}::uuid)`);
  return rows[0] ?? { banned: false, auto_approve: false };
}

type Snapshot = {
  id: string; org_id: string; skill_id: string; skill_version_id: string;
  package_checksum: string; status: string; kind: string; submitted_by: string | null;
};
async function snapshot(database: Db, orgId: string, submissionId: string) {
  const rows = await database.execute<Snapshot>(sql`select * from public.skillpack_catalog_submission_snapshot(${orgId}::uuid, ${submissionId}::uuid)`);
  if (!rows[0]) throw new CatalogModerationError("submission not found", 404);
  return rows[0];
}
async function reportFor(database: Db, row: Omit<Snapshot, "submitted_by">, reader = checkReader) {
  const identity: CatalogCheckIdentity = { orgId: row.org_id, submissionId: row.id,
    skillVersionId: row.skill_version_id, packageChecksum: row.package_checksum };
  const report = await reader({ ...identity, database });
  if (!report) return null;
  const validated = catalogModerationCheckReportSchema.safeParse(report);
  if (!validated.success) return null;
  const parsed = validated.data;
  if (parsed.orgId !== identity.orgId || parsed.submissionId !== identity.submissionId
    || parsed.skillVersionId !== identity.skillVersionId || parsed.packageChecksum !== identity.packageChecksum) return null;
  return parsed;
}

export async function listCatalogSubmissions(input: {
  actorId: string; status?: "proposed" | "validated" | "rejected" | "removed";
  limit?: number; offset?: number; database?: Db; checks?: CatalogCheckReader;
}) {
  const database = input.database ?? db;
  await assertCatalogModerator({ actorId: input.actorId, database });
  const query = catalogModerationQuerySchema.parse({ status: input.status, limit: input.limit, offset: input.offset });
  const rows = await moderationRpc(() => database.execute<Omit<Snapshot, "submitted_by"> & {
    rejection_reason: string | null; created_at: Date | string; decided_at: Date | string | null;
  }>(sql`select * from public.skillpack_catalog_moderation_queue(${input.actorId},
    ${configuredId("SKILLPACK_CATALOG_MODERATOR_USER_IDS", input.actorId)},
    ${query.status}, ${query.limit}, ${query.offset})`));
  return Promise.all(Array.from(rows).map(async row => {
    const report = await reportFor(database, row, input.checks);
    return { ...row, created_at: new Date(row.created_at).toISOString(), decided_at: row.decided_at ? new Date(row.decided_at).toISOString() : null,
      check_status: report?.status ?? "pending", check_reason: report?.reason ?? null };
  }));
}

/** Map PostgreSQL's stable error codes without exposing SQL or query parameters. */
function decisionError(error: Error): never {
  let cause: unknown = error;
  while (cause instanceof Error && cause.cause) cause = cause.cause;
  const code = z.object({ code: z.string(), message: z.string() }).passthrough().safeParse(cause);
  if (code.success) {
    if (code.data.code === "42501") throw new CatalogModerationError("platform moderator required", 403);
    if (code.data.code === "P0002") throw new CatalogModerationError("submission or organization not found", 404);
    if (code.data.code === "23514") throw new CatalogModerationError(code.data.message, 409);
  }
  throw error;
}

async function moderationRpc<Result>(operation: () => Promise<Result>): Promise<Result> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof Error) decisionError(error);
    throw error;
  }
}

async function decide(input: {
  actorId: string; orgId: string; submissionId?: string; action: "validate" | "reject" | "remove" | "ban";
  reason?: string; database: Db; automatic?: boolean; checks?: CatalogCheckReader;
}) {
  let candidate: Snapshot | undefined;
  let passed = false;
  if (input.action === "validate") {
    candidate = await snapshot(input.database, input.orgId, input.submissionId!);
    passed = (await reportFor(input.database, candidate, input.checks))?.status === "passed";
    if (!passed) throw new CatalogModerationError("a passing automatic check report is required", 409);
  }
  await moderationRpc(() => input.database.execute(sql`select public.skillpack_moderate_catalog(
      ${input.actorId}, ${configuredId("SKILLPACK_CATALOG_MODERATOR_USER_IDS", input.actorId)},
      ${input.orgId}::uuid, ${input.submissionId ?? null}::uuid, ${input.action}, ${input.reason ?? null},
      ${passed}, ${input.automatic ?? false}, ${configuredId("SKILLPACK_CATALOG_AUTO_APPROVE_ORG_IDS", input.orgId)},
      ${candidate?.skill_version_id ?? null}::uuid, ${candidate?.package_checksum ?? null})`));
}

export async function moderateCatalog(input: {
  actorId: string; orgId: string; submissionId?: string; action: "validate" | "reject" | "remove" | "ban";
  reason?: string; database?: Db; checks?: CatalogCheckReader;
}): Promise<void> {
  const database = input.database ?? db;
  await assertCatalogModerator({ actorId: input.actorId, database });
  if (input.action !== "validate") catalogModerationReasonSchema.parse({ reason: input.reason });
  await decide({ ...input, database });
}

/** PR 3 calls after committing a report; proposals also call this when a report already exists. */
export async function autoApproveCatalogSubmission(input: {
  orgId: string; submissionId: string; database?: Db; checks?: CatalogCheckReader;
}): Promise<boolean> {
  if (process.env.SKILLPACK_PUBLIC_CATALOG !== "true") return false;
  const database = input.database ?? db;
  const policy = await catalogPublishingPolicy(database, input.orgId);
  if (policy.banned || !(policy.auto_approve || configuredId("SKILLPACK_CATALOG_AUTO_APPROVE_ORG_IDS", input.orgId))) return false;
  const row = await snapshot(database, input.orgId, input.submissionId);
  if (row.status !== "proposed" || row.kind !== "submission" || !row.submitted_by) return false;
  if ((await reportFor(database, row, input.checks))?.status !== "passed") return false;
  try {
    await decide({ ...input, actorId: row.submitted_by, action: "validate", automatic: true, database });
    return true;
  } catch (error) {
    // Concurrent withdrawal, validation, ban, or replacement has won; never resurrect it.
    if (error instanceof CatalogModerationError && (error.status === 409 || error.status === 403)) return false;
    throw error;
  }
}
