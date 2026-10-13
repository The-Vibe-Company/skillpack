/* oxlint-disable anti-slop/no-shape-in-symbol-names -- the contracts package exposes the nested file validator through Zod's shape API. */

import { and, eq, isNull, isNotNull, sql } from "drizzle-orm";
import { db, schema, type Db } from "@skillpack/db";
import {
  publicCatalogSkillSchema,
  type PublicCatalogSkill,
  type OrgRole,
} from "@skillpack/contracts";
import type { ActorContext } from "./services";
import {
  assertMember,
  SkillPublicReleaseConflictError,
  SkillPublicReleaseForbiddenError,
  SkillPublicReleaseNotFoundError,
} from "./services";
import { canManagePublicListing } from "./authz";

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
  /** Release identity read before the archive was extracted, used as a compare-and-swap fence. */
  expectedPublicVersionId?: string;
  expectedChecksum?: string;
  database?: Db;
}

export interface SkillPublicListingResult {
  listed_publicly: boolean;
  listed_at: string | null;
  changed: boolean;
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

/**
 * Set explicit public discovery consent for one immutable public release. This is a tenant
 * mutation, so membership and scope authorization are checked before the conditional update. Org
 * catalog consent is Owner/Admin-only; personal consent remains creator-only with no admin override.
 */
export async function setSkillPublicListing(
  input: SetSkillPublicListingInput,
): Promise<SkillPublicListingResult> {
  const packageFiles = input.packageFiles === undefined
    ? undefined
    : publicCatalogSkillSchema.shape.files.parse(input.packageFiles);
  const database = input.database ?? db;
  return database.transaction(async (tx) => {
    const transactionDatabase: unknown = tx;
    // SAFETY: Drizzle's transaction surface has the same schema and query contract as Db; only
    // the private client holder differs while this callback is active.
    const tenantDatabase = transactionDatabase as Db;
    const role: OrgRole = await assertMember(tenantDatabase, input.actor, input.orgId);
    const skill = await tenantDatabase.query.skills.findFirst({
      where: and(eq(schema.skills.orgId, input.orgId), eq(schema.skills.slug, input.slug)),
    });
    if (!skill || (skill.scope === "personal" && skill.creatorId !== input.actor.id)) {
      throw new SkillPublicReleaseNotFoundError("skill not found");
    }
    if (!canManagePublicListing({ id: input.actor.id, orgRole: role }, skill)) {
      throw new SkillPublicReleaseForbiddenError("only an organization Owner/Admin may manage org catalog discovery");
    }
    if (input.expectedPublicVersionId && input.expectedPublicVersionId !== skill.publicVersionId) {
      throw new SkillPublicReleaseConflictError("the public release changed concurrently; refresh and try again");
    }
    if (input.expectedChecksum && input.expectedChecksum !== skill.publicPackageChecksum) {
      throw new SkillPublicReleaseConflictError("the public release changed concurrently; refresh and try again");
    }
    if (input.listed && skill.archivedAt) {
      throw new SkillPublicReleaseConflictError("restore the skill before listing it publicly");
    }
    if (
      input.listed
      && (
        !skill.publicVersionId
        || !skill.publicPackageChecksum
        || skill.publicPackageSizeBytes == null
        || !skill.publicReleasedAt
        || (packageFiles === undefined && skill.publicPackageFiles == null)
      )
    ) {
      throw new SkillPublicReleaseConflictError("prepare a complete public release before listing it");
    }

    const changed = skill.listedPublicly !== input.listed;
    const filesChanged = packageFiles !== undefined
      && JSON.stringify(skill.publicPackageFiles ?? null) !== JSON.stringify(packageFiles);
    if (input.listed && skill.publicPackageFiles && filesChanged) {
      throw new SkillPublicReleaseConflictError("the public release file list changed; refresh and try again");
    }
    const listedAt = input.listed
      ? (changed ? new Date() : skill.listedAt)
      : null;
    const expectedListedAt = skill.listedAt
      ? eq(schema.skills.listedAt, skill.listedAt)
      : isNull(schema.skills.listedAt);
    const expectedPublicVersion = skill.publicVersionId
      ? eq(schema.skills.publicVersionId, skill.publicVersionId)
      : isNull(schema.skills.publicVersionId);
    const expectedChecksum = skill.publicPackageChecksum
      ? eq(schema.skills.publicPackageChecksum, skill.publicPackageChecksum)
      : isNull(schema.skills.publicPackageChecksum);
    const expectedSize = skill.publicPackageSizeBytes != null
      ? eq(schema.skills.publicPackageSizeBytes, skill.publicPackageSizeBytes)
      : isNull(schema.skills.publicPackageSizeBytes);
    const expectedReleasedAt = skill.publicReleasedAt
      ? eq(schema.skills.publicReleasedAt, skill.publicReleasedAt)
      : isNull(schema.skills.publicReleasedAt);
    type ListingUpdate = {
      listedPublicly?: boolean;
      listedAt?: Date | null;
      publicPackageFiles?: PublicCatalogSkill["files"];
      updatedAt?: Date;
    };
    const update: ListingUpdate = changed
      ? { listedPublicly: input.listed, listedAt, updatedAt: new Date() }
      : filesChanged
        ? { publicPackageFiles: packageFiles, updatedAt: new Date() }
        : { listedPublicly: input.listed };
    if (changed && packageFiles !== undefined && !skill.publicPackageFiles) {
      update.publicPackageFiles = packageFiles;
    }
    const [updated] = await tenantDatabase
      .update(schema.skills)
      .set(update)
      .where(and(
        eq(schema.skills.orgId, input.orgId),
        eq(schema.skills.id, skill.id),
        eq(schema.skills.slug, input.slug),
        eq(schema.skills.scope, skill.scope),
        eq(schema.skills.creatorId, skill.creatorId),
        eq(schema.skills.listedPublicly, skill.listedPublicly),
        expectedListedAt,
        expectedPublicVersion,
        expectedChecksum,
        expectedSize,
        expectedReleasedAt,
        ...(input.listed
          ? [isNull(schema.skills.archivedAt), ...(packageFiles === undefined ? [isNotNull(schema.skills.publicPackageFiles)] : [])]
          : []),
      ))
      .returning({ id: schema.skills.id });
    if (!updated) {
      throw new SkillPublicReleaseConflictError("the public listing changed concurrently; refresh and try again");
    }

    if (changed) {
      await tenantDatabase.insert(schema.auditLog).values({
        orgId: input.orgId,
        actorId: input.actor.id,
        action: input.listed ? "skill.public_listing.set" : "skill.public_listing.clear",
        targetType: "skill",
        targetId: skill.id,
        metadata: {
          slug: skill.slug,
          listed: input.listed,
          releaseVersionId: skill.publicVersionId,
        },
      });
    }

    return {
      listed_publicly: input.listed,
      listed_at: listedAt ? listedAt.toISOString() : null,
      changed,
    };
  });
}

export interface PreparedSkillPublicListing {
  orgId: string;
  publicVersionId: string;
  checksum: string;
  sizeBytes: number;
  packageFiles: PublicCatalogSkill["files"] | null;
}

/**
 * Read the exact public release identity before an API caller extracts its immutable archive.
 * The caller must pass the returned identity back to setSkillPublicListing as a CAS fence.
 */
export async function prepareSkillPublicListing(input: {
  actor: ActorContext;
  orgId: string;
  slug: string;
  database?: Db;
}): Promise<PreparedSkillPublicListing> {
  const database = input.database ?? db;
  const role: OrgRole = await assertMember(database, input.actor, input.orgId);
  const skill = await database.query.skills.findFirst({
    where: and(eq(schema.skills.orgId, input.orgId), eq(schema.skills.slug, input.slug)),
  });
  if (!skill || (skill.scope === "personal" && skill.creatorId !== input.actor.id)) {
    throw new SkillPublicReleaseNotFoundError("skill not found");
  }
  if (!canManagePublicListing({ id: input.actor.id, orgRole: role }, skill)) {
    throw new SkillPublicReleaseForbiddenError("only an organization Owner/Admin may manage org catalog discovery");
  }
  if (
    !skill.publicVersionId
    || !skill.publicPackageChecksum
    || skill.publicPackageSizeBytes == null
    || !skill.publicReleasedAt
  ) {
    throw new SkillPublicReleaseConflictError("promote a complete public release before listing it");
  }
  return {
    orgId: input.orgId,
    publicVersionId: skill.publicVersionId,
    checksum: skill.publicPackageChecksum,
    sizeBytes: skill.publicPackageSizeBytes,
    packageFiles: skill.publicPackageFiles,
  };
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
