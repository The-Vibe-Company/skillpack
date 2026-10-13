/* oxlint-disable anti-slop/no-shape-in-symbol-names -- the contracts package exposes the nested file validator through Zod's shape API. */

import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema, type Db } from "@skillpack/db";
import { checkCatalogPackage } from "@skillpack/skills";
import {
  publicCatalogSkillSchema,
  type PublicCatalogSkill,
  type OrgRole,
  type SkillPublicListingStatus,
  type SkillPublicListingResult,
} from "@skillpack/contracts";
import type { ActorContext } from "./services";
import {
  assertMember,
  SkillPublicReleaseConflictError,
  SkillPublicReleaseForbiddenError,
  SkillPublicReleaseNotFoundError,
} from "./services";
import { withdrawOpenCatalogSubmissions } from "./catalogSubmissionLifecycle";
import { canManagePublicListing } from "./authz";
import { autoApproveCatalogSubmission, catalogPublishingPolicy } from "./catalogModeration";

export interface PublicCatalogQuery {
  limit: number;
  offset: number;
  label?: string;
  database?: Db;
}

export interface SetSkillPublicListingInput {
  actor: ActorContext;
  orgId: string;
  slug: string;
  listed: boolean;
  /** File list captured from the exact pinned public ZIP (required for a first listing). */
  packageFiles?: readonly PublicCatalogSkill["files"][number][];
  /** Exact public ZIP bytes. Missing bytes fail closed; caller-supplied reports are never trusted. */
  packageBytes?: Buffer;
  /** Release identity read before the archive was extracted, used as a compare-and-swap fence. */
  expectedPublicVersionId?: string;
  expectedChecksum?: string;
  database?: Db;
}

interface PublicCatalogFunctionRow {
  [key: string]: string | number | Date | PublicCatalogSkill["files"] | null;
  org_name: string;
  org_slug: string;
  skill_slug: string;
  name: string;
  description: string;
  version: string;
  released_at: Date;
  checksum: string;
  size_bytes: number;
  body: string;
  files: PublicCatalogSkill["files"] | null;
}

function assertPagination(limit: number, offset: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new RangeError("public catalog limit must be between 1 and 50");
  }
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10_000) {
    throw new RangeError("public catalog offset must be between 0 and 10000");
  }
}

function toCatalogSkill(row: PublicCatalogFunctionRow): PublicCatalogSkill {
  const files = publicCatalogSkillSchema.shape.files.parse(row.files ?? []);
  return publicCatalogSkillSchema.parse({
    org_name: row.org_name,
    org_slug: row.org_slug,
    skill_slug: row.skill_slug,
    name: row.name,
    description: row.description,
    version: row.version,
    released_at: new Date(row.released_at).toISOString(),
    checksum: row.checksum,
    size_bytes: row.size_bytes,
    body: row.body,
    files,
  });
}

function resultRows<T>(result: Iterable<T>): T[] {
  return Array.from(result);
}

type ListingSkill = typeof schema.skills.$inferSelect;
type Submission = typeof schema.catalogSubmissions.$inferSelect;
type ListingInput = { actor: ActorContext; orgId: string; slug: string; database?: Db };

async function listingSkill(input: ListingInput, database: Db, lock = false) {
  const role = await assertMember(database, input.actor, input.orgId);
  const query = database.select().from(schema.skills).where(and(
    eq(schema.skills.orgId, input.orgId), eq(schema.skills.slug, input.slug),
  ));
  const [skill] = await (lock ? query.for("update") : query);
  if (!skill || (skill.scope === "personal" && skill.creatorId !== input.actor.id)) {
    throw new SkillPublicReleaseNotFoundError("skill not found");
  }
  if (skill.scope !== "org") {
    throw new SkillPublicReleaseForbiddenError("share this personal skill with the organization before requesting publication");
  }
  return { skill, role };
}

async function listingStatus(database: Db, orgId: string, skill: ListingSkill, role: OrgRole): Promise<SkillPublicListingStatus> {
  const latest = await database.query.catalogSubmissions.findFirst({
    where: and(eq(schema.catalogSubmissions.orgId, orgId), eq(schema.catalogSubmissions.skillId, skill.id)),
    orderBy: [desc(schema.catalogSubmissions.createdAt), desc(schema.catalogSubmissions.id)],
  });
  return {
    listed_publicly: skill.listedPublicly,
    listed_at: skill.listedAt?.toISOString() ?? null,
    latest_submission: latest ? { id: latest.id, status: latest.status, kind: latest.kind } : null,
    rejection_reason: latest?.rejectionReason ?? null,
    check_report: latest?.checkReport ?? null,
    can_manage_listing: canManagePublicListing({ id: skill.creatorId, orgRole: role }, skill),
  };
}

export async function getSkillPublicListing(input: ListingInput): Promise<SkillPublicListingStatus> {
  const database = input.database ?? db;
  return database.transaction(async (tx) => {
    const transactionDatabase: unknown = tx;
    // SAFETY: transaction queries share the Db schema and query contract.
    const tenantDb = transactionDatabase as Db;
    const { skill, role } = await listingSkill(input, tenantDb);
    return listingStatus(tenantDb, input.orgId, skill, role);
  });
}

function assertListingRole(role: OrgRole, request: boolean) {
  if (request ? role !== "developer" : role !== "owner" && role !== "admin") {
    throw new SkillPublicReleaseForbiddenError(request
      ? "only a Developer may request publication; Owner/Admin can submit directly"
      : "only an organization Owner/Admin may manage org catalog discovery");
  }
}

function completeRelease(skill: ListingSkill) {
  if (skill.archivedAt) throw new SkillPublicReleaseConflictError("restore the skill before requesting publication");
  if (!skill.publicVersionId || !skill.publicPackageChecksum || skill.publicPackageSizeBytes == null || !skill.publicReleasedAt) {
    throw new SkillPublicReleaseConflictError("prepare a complete public release before requesting publication");
  }
  return { versionId: skill.publicVersionId, checksum: skill.publicPackageChecksum, sizeBytes: skill.publicPackageSizeBytes };
}

async function auditSubmission(database: Db, actorId: string, submission: Submission, action: string) {
  await database.insert(schema.auditLog).values({
    orgId: submission.orgId, actorId, action, targetType: "catalog_submission", targetId: submission.id,
    metadata: { skillId: submission.skillId, releaseVersionId: submission.skillVersionId, kind: submission.kind, status: submission.status },
  });
}

/** Owner/Admin submits the current release; only validation may enable discovery. */
export async function setSkillPublicListing(input: SetSkillPublicListingInput): Promise<SkillPublicListingResult> {
  return mutateListing(input, false);
}

/** Developer requests are inert until an Owner/Admin submits them. */
export async function requestSkillPublicListing(input: Omit<SetSkillPublicListingInput, "listed">): Promise<SkillPublicListingResult> {
  return mutateListing({ ...input, listed: true }, true);
}

async function mutateListing(input: SetSkillPublicListingInput, request: boolean): Promise<SkillPublicListingResult> {
  const database = input.database ?? db;
  return database.transaction(async (tx) => {
    const transactionDatabase: unknown = tx;
    // SAFETY: transaction queries share the Db schema and query contract.
    const tenantDb = transactionDatabase as Db;
    await assertMember(tenantDb, input.actor, input.orgId);
    if (input.listed && (await catalogPublishingPolicy(tenantDb, input.orgId, true)).banned) {
      throw new SkillPublicReleaseForbiddenError("this organization is banned from catalog publishing");
    }
    const { skill, role } = await listingSkill(input, tenantDb, true);
    assertListingRole(role, request);
    const open = await tenantDb.query.catalogSubmissions.findFirst({
      where: and(eq(schema.catalogSubmissions.orgId, input.orgId), eq(schema.catalogSubmissions.skillId, skill.id), eq(schema.catalogSubmissions.status, "proposed")),
    });
    if (!input.listed) {
      const changed = skill.listedPublicly || !!open;
      await tenantDb.update(schema.skills).set({ listedPublicly: false, listedAt: null }).where(and(eq(schema.skills.orgId, input.orgId), eq(schema.skills.id, skill.id)));
      await withdrawOpenCatalogSubmissions({ database: tenantDb, orgId: input.orgId, skillId: skill.id, actorId: input.actor.id });
      if (skill.listedPublicly) await tenantDb.insert(schema.auditLog).values({
        orgId: input.orgId, actorId: input.actor.id, action: "skill.public_listing.clear", targetType: "skill", targetId: skill.id,
        metadata: { slug: skill.slug },
      });
      return { ...await listingStatus(tenantDb, input.orgId, { ...skill, listedPublicly: false, listedAt: null }, role), changed };
    }
    const release = completeRelease(skill);
    if ((input.expectedPublicVersionId && input.expectedPublicVersionId !== release.versionId)
      || (input.expectedChecksum && input.expectedChecksum !== release.checksum)) {
      throw new SkillPublicReleaseConflictError("the public release changed concurrently; refresh and try again");
    }
    if (input.packageFiles === undefined && skill.publicPackageFiles === null) {
      throw new SkillPublicReleaseConflictError("prepare a complete public release before requesting publication");
    }
    const files = publicCatalogSkillSchema.shape.files.parse(input.packageFiles ?? skill.publicPackageFiles);
    if (skill.publicPackageFiles && JSON.stringify(files) !== JSON.stringify(skill.publicPackageFiles)) {
      throw new SkillPublicReleaseConflictError("the public release file list changed; refresh and try again");
    }
    const kind = request ? "publish_request" : "submission";
    if (open && (request || open.kind === "submission")) {
      if (open.skillVersionId !== release.versionId || open.packageChecksum !== release.checksum || open.packageSizeBytes !== release.sizeBytes) {
        throw new SkillPublicReleaseConflictError("withdraw the open submission before submitting a different release");
      }
      return { ...await listingStatus(tenantDb, input.orgId, skill, role), changed: false };
    }
    const checkReport = checkCatalogPackage({ bytes: input.packageBytes, checksum: release.checksum,
      sizeBytes: release.sizeBytes, slug: skill.slug, shareToken: skill.shareToken });
    const rejected = !checkReport.passed;
    const snapshot = { skillVersionId: release.versionId, packageChecksum: release.checksum, packageSizeBytes: release.sizeBytes, packageFiles: files,
      checkReport, status: rejected ? "rejected" as const : "proposed" as const,
      decidedBy: rejected ? input.actor.id : null, decidedAt: rejected ? new Date() : null,
      rejectionReason: rejected ? [...new Set(checkReport.findings.filter(finding => finding.severity === "blocking").map(finding => finding.rule_id))].join(",") : null };
    const [submission] = open
      ? await tenantDb.update(schema.catalogSubmissions).set({ ...snapshot, kind, submittedBy: input.actor.id })
          .where(and(eq(schema.catalogSubmissions.orgId, input.orgId), eq(schema.catalogSubmissions.id, open.id))).returning()
      : await tenantDb.insert(schema.catalogSubmissions).values({
          orgId: input.orgId, skillId: skill.id, ...snapshot, kind,
          requestedBy: request ? input.actor.id : null, submittedBy: request ? null : input.actor.id,
        }).returning();
    if (!submission) throw new SkillPublicReleaseConflictError("submission changed concurrently");
    await auditSubmission(tenantDb, input.actor.id, submission, request ? "catalog_submission.requested" : "catalog_submission.submitted");
    if (rejected) await auditSubmission(tenantDb, input.actor.id, submission, "catalog_submission.rejected");
    const approved = !request && !rejected && await autoApproveCatalogSubmission({ orgId: input.orgId, submissionId: submission.id, database: tenantDb });
    const current = approved ? await tenantDb.query.skills.findFirst({
      where: and(eq(schema.skills.orgId, input.orgId), eq(schema.skills.id, skill.id)),
    }) : skill;
    return { ...await listingStatus(tenantDb, input.orgId, current ?? skill, role), changed: true };
  });
}

export interface PreparedSkillPublicListing {
  orgId: string;
  publicVersionId: string;
  checksum: string;
  sizeBytes: number;
  packageFiles: PublicCatalogSkill["files"] | null;
}

/** Authorize before reading storage; compare the identity again under the skill lock. */
export async function prepareSkillPublicListing(input: ListingInput & { request?: boolean }): Promise<PreparedSkillPublicListing> {
  const database = input.database ?? db;
  const { skill, role } = await listingSkill(input, database);
  assertListingRole(role, input.request ?? false);
  const release = completeRelease(skill);
  return { orgId: input.orgId, publicVersionId: release.versionId, checksum: release.checksum, sizeBytes: release.sizeBytes, packageFiles: skill.publicPackageFiles };
}

/** Internal primitive retained for lifecycle tests. Production moderation uses the gated RPC. */
export async function applyValidatedSubmission(input: { orgId: string; submissionId: string; decidedBy: string; database?: Db }): Promise<void> {
  const database = input.database ?? db;
  await database.transaction(async (tx) => {
    const transactionDatabase: unknown = tx;
    // SAFETY: transaction queries share the Db schema and query contract.
    const tenantDb = transactionDatabase as Db;
    if ((await catalogPublishingPolicy(tenantDb, input.orgId, true)).banned) {
      throw new SkillPublicReleaseConflictError("this organization is banned from catalog publishing");
    }
    const candidate = await tenantDb.query.catalogSubmissions.findFirst({
      where: and(eq(schema.catalogSubmissions.orgId, input.orgId), eq(schema.catalogSubmissions.id, input.submissionId)),
    });
    if (!candidate) throw new SkillPublicReleaseNotFoundError("submission not found");
    const [skill] = await tenantDb.select().from(schema.skills).where(and(eq(schema.skills.orgId, input.orgId), eq(schema.skills.id, candidate.skillId))).for("update");
    const submission = await tenantDb.query.catalogSubmissions.findFirst({
      where: and(eq(schema.catalogSubmissions.orgId, input.orgId), eq(schema.catalogSubmissions.id, input.submissionId)),
    });
    if (!skill || skill.scope !== "org" || skill.archivedAt || !skill.publicVersionId || !submission || submission.kind !== "submission" || submission.status !== "proposed"
      || submission.checkReport?.version !== 1 || submission.checkReport.passed !== true
      || submission.checkReport.findings.some(finding => finding.severity === "blocking")) {
      throw new SkillPublicReleaseConflictError("only an active proposed submission can be validated");
    }
    const decidedAt = new Date();
    const [validated] = await tenantDb.update(schema.catalogSubmissions).set({ status: "validated", decidedBy: input.decidedBy, decidedAt, rejectionReason: null })
      .where(and(eq(schema.catalogSubmissions.orgId, input.orgId), eq(schema.catalogSubmissions.id, submission.id), eq(schema.catalogSubmissions.status, "proposed"))).returning();
    if (!validated) throw new SkillPublicReleaseConflictError("submission changed concurrently");
    await tenantDb.update(schema.skills).set({ listedPublicly: true, listedAt: decidedAt, updatedAt: decidedAt })
      .where(and(eq(schema.skills.orgId, input.orgId), eq(schema.skills.id, skill.id)));
    await auditSubmission(tenantDb, input.decidedBy, validated, "catalog_submission.validated");
    await tenantDb.insert(schema.auditLog).values({
      orgId: input.orgId, actorId: input.decidedBy, action: "skill.public_listing.set", targetType: "skill", targetId: skill.id,
      metadata: { submissionId: submission.id, releaseVersionId: submission.skillVersionId },
    });
  });
}

/** List explicit public catalog entries through the pre-tenant SECURITY DEFINER projection. */
export async function listPublicCatalog(input: PublicCatalogQuery): Promise<PublicCatalogSkill[]> {
  assertPagination(input.limit, input.offset);
  const database = input.database ?? db;
  const result = await database.execute<PublicCatalogFunctionRow>(sqlListCatalog(input.limit, input.offset, input.label));
  return resultRows(result).map(toCatalogSkill);
}

/** Resolve one explicit public catalog entry by immutable organization and skill slugs. */
export async function getPublicCatalogSkill(input: {
  orgSlug: string;
  skillSlug: string;
  database?: Db;
}): Promise<PublicCatalogSkill | null> {
  const database = input.database ?? db;
  const result = await database.execute<PublicCatalogFunctionRow>(sqlGetCatalogSkill(input.orgSlug, input.skillSlug));
  const row = resultRows(result)[0];
  return row ? toCatalogSkill(row) : null;
}

// Keep SQL construction in one place so callers cannot accidentally add a tenant or identity
// parameter to the pre-tenant projection.
function sqlListCatalog(limit: number, offset: number, label?: string) {
  return sql`
    select * from public.skillpack_list_public_catalog(
      ${limit}, ${offset}, ${label?.trim() || null}
    )
  `;
}

function sqlGetCatalogSkill(orgSlug: string, skillSlug: string) {
  return sql`
    select * from public.skillpack_get_public_catalog_skill(${orgSlug}, ${skillSlug})
  `;
}
