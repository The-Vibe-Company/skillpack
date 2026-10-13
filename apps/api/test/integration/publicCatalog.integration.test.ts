import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { schema } from "@skillpack/db";
import {
  archiveSkill,
  clearSkillPublicVersion,
  setSkillPublicVersion,
  SkillPublicReleaseConflictError,
  SkillPublicReleaseForbiddenError,
  SkillPublicReleaseNotFoundError,
} from "@skillpack/core/services";
import {
  getPublicCatalogSkill,
  listPublicCatalog,
  setSkillPublicListing,
} from "@skillpack/core";
import {
  createIntegrationFixture,
  integrationDb,
  integrationSql,
  seedPersonalLabel,
  seedSkill,
  type IntegrationFixture,
  type SeededSkill,
} from "./testDatabase";

process.env.COMPANION_BILLING_MODE = "off";

const FILES = [
  { path: "SKILL.md", size_bytes: 128 },
  { path: "scripts/run.ts", size_bytes: 42 },
];

describe("public catalog", () => {
  let fixture: IntegrationFixture;

  beforeAll(async () => {
    fixture = await createIntegrationFixture();
  });

  afterAll(async () => fixture.cleanup());

  async function promote(
    skill: SeededSkill,
    actor: IntegrationFixture["developer"],
    packageFiles: readonly { path: string; size_bytes: number }[] | undefined = FILES,
  ): Promise<void> {
    const releaseInput: Parameters<typeof setSkillPublicVersion>[0] = {
      actor,
      orgId: skill.orgId,
      slug: skill.slug,
      version: "1.0.0",
      packageChecksum: `sha256:${"a".repeat(64)}`,
      packageSizeBytes: 1_024,
      database: integrationDb,
    };
    if (packageFiles !== undefined) releaseInput.packageFiles = packageFiles;
    await setSkillPublicVersion(releaseInput);
  }

  async function skillRow(skill: SeededSkill) {
    const [row] = await integrationDb
      .select()
      .from(schema.skills)
      .where(and(eq(schema.skills.orgId, skill.orgId), eq(schema.skills.id, skill.id)));
    if (!row) throw new Error(`skill row missing: ${skill.slug}`);
    return row;
  }

  it("keeps releases unlisted by default and rejects incomplete catalog consent", async () => {
    const skill = await seedSkill({
      orgId: fixture.orgA,
      creator: fixture.developer,
      slug: `catalog-unlisted-${fixture.suffix.slice(0, 8)}`,
      scope: "org",
    });
    await setSkillPublicVersion({
      actor: fixture.developer,
      orgId: skill.orgId,
      slug: skill.slug,
      version: "1.0.0",
      packageChecksum: `sha256:${"a".repeat(64)}`,
      packageSizeBytes: 1_024,
      database: integrationDb,
    });

    const row = await skillRow(skill);
    expect(row.listedPublicly).toBe(false);
    expect(row.listedAt).toBeNull();
    expect(await getPublicCatalogSkill({
      orgSlug: `integration-a-${fixture.suffix}`,
      skillSlug: skill.slug,
      database: integrationDb,
    })).toBeNull();

    await expect(setSkillPublicListing({
      actor: fixture.admin,
      orgId: fixture.orgA,
      slug: skill.slug,
      listed: true,
      database: integrationDb,
    })).rejects.toBeInstanceOf(SkillPublicReleaseConflictError);

    await expect(
      integrationDb
        .update(schema.skills)
        .set({ listedPublicly: true, listedAt: new Date() })
        .where(eq(schema.skills.id, skill.id)),
    ).rejects.toThrow();
  });

  it("allows only Owner/Admin org discovery consent and fences non-members", async () => {
    const skill = await seedSkill({
      orgId: fixture.orgA,
      creator: fixture.developer,
      slug: `catalog-org-${fixture.suffix.slice(0, 8)}`,
      scope: "org",
    });
    await promote(skill, fixture.developer);

    await expect(setSkillPublicListing({
      actor: fixture.developer,
      orgId: fixture.orgA,
      slug: skill.slug,
      listed: true,
      database: integrationDb,
    })).rejects.toBeInstanceOf(SkillPublicReleaseForbiddenError);
    await expect(setSkillPublicListing({
      actor: fixture.outsider,
      orgId: fixture.orgA,
      slug: skill.slug,
      listed: true,
      database: integrationDb,
    })).rejects.toThrow("not a member of this organization");

    await expect(setSkillPublicListing({
      actor: fixture.admin,
      orgId: fixture.orgA,
      slug: skill.slug,
      listed: true,
      database: integrationDb,
    })).resolves.toMatchObject({ listed_publicly: true, changed: true });

    const catalog = await getPublicCatalogSkill({
      orgSlug: `integration-a-${fixture.suffix}`,
      skillSlug: skill.slug,
      database: integrationDb,
    });
    expect(catalog).toMatchObject({
      org_name: `Integration A ${fixture.suffix}`,
      org_slug: `integration-a-${fixture.suffix}`,
      skill_slug: skill.slug,
      name: skill.slug,
      description: `Integration skill ${skill.slug}`,
      version: "1.0.0",
      checksum: `sha256:${"a".repeat(64)}`,
      size_bytes: 1_024,
      body: `# ${skill.slug}\n\nIntegration skill ${skill.slug}`,
      files: FILES,
    });
    expect(catalog?.released_at).toEqual(expect.any(String));
    expect(catalog).not.toHaveProperty("id");
    expect(catalog).not.toHaveProperty("share_token");
    expect(catalog).not.toHaveProperty("creator_id");
  });

  it("rechecks live role and membership for both listing directions", async () => {
    const slug = `catalog-revoked-${fixture.suffix.slice(0, 8)}`;
    const skill = await seedSkill({
      orgId: fixture.orgA,
      creator: fixture.developer,
      slug,
      scope: "org",
    });
    await seedSkill({
      orgId: fixture.orgB,
      creator: fixture.outsider,
      slug,
      scope: "org",
    });
    await promote(skill, fixture.developer);
    await setSkillPublicListing({ actor: fixture.owner, orgId: fixture.orgA, slug, listed: true, database: integrationDb });

    try {
      await integrationDb.update(schema.memberships)
        .set({ orgRole: "developer" })
        .where(and(eq(schema.memberships.orgId, fixture.orgA), eq(schema.memberships.userId, fixture.admin.id)));
      await expect(setSkillPublicListing({ actor: fixture.admin, orgId: fixture.orgA, slug, listed: true, database: integrationDb }))
        .rejects.toBeInstanceOf(SkillPublicReleaseForbiddenError);
      await expect(setSkillPublicListing({ actor: fixture.admin, orgId: fixture.orgA, slug, listed: false, database: integrationDb }))
        .rejects.toBeInstanceOf(SkillPublicReleaseForbiddenError);

      await integrationDb.delete(schema.memberships).where(and(
        eq(schema.memberships.orgId, fixture.orgA),
        eq(schema.memberships.userId, fixture.admin.id),
      ));
      await expect(setSkillPublicListing({ actor: fixture.admin, orgId: fixture.orgA, slug, listed: true, database: integrationDb }))
        .rejects.toThrow("not a member of this organization");
      await expect(setSkillPublicListing({ actor: fixture.admin, orgId: fixture.orgA, slug, listed: false, database: integrationDb }))
        .rejects.toThrow("not a member of this organization");

      await expect(setSkillPublicListing({ actor: fixture.outsider, orgId: fixture.orgA, slug, listed: false, database: integrationDb }))
        .rejects.toThrow("not a member of this organization");
      const unchanged = await skillRow(skill);
      expect(unchanged.listedPublicly).toBe(true);
    } finally {
      await integrationDb.insert(schema.memberships)
        .values({ orgId: fixture.orgA, userId: fixture.admin.id, orgRole: "admin" })
        .onConflictDoUpdate({
          target: [schema.memberships.orgId, schema.memberships.userId],
          set: { orgRole: "admin" },
        });
    }
  });

  it("permits a personal creator to list without exposing personal labels or identity", async () => {
    const skill = await seedSkill({
      orgId: fixture.orgA,
      creator: fixture.developer,
      slug: `catalog-personal-${fixture.suffix.slice(0, 8)}`,
      scope: "personal",
    });
    await promote(skill, fixture.developer);
    await seedPersonalLabel({
      orgId: fixture.orgA,
      owner: fixture.developer,
      skillId: skill.id,
      path: `private-${fixture.suffix.slice(0, 8)}`,
    });

    await expect(setSkillPublicListing({
      actor: fixture.admin,
      orgId: fixture.orgA,
      slug: skill.slug,
      listed: true,
      database: integrationDb,
    })).rejects.toBeInstanceOf(SkillPublicReleaseNotFoundError);
    await expect(setSkillPublicListing({
      actor: fixture.developer,
      orgId: fixture.orgA,
      slug: skill.slug,
      listed: true,
      database: integrationDb,
    })).resolves.toMatchObject({ listed_publicly: true });

    const catalog = await getPublicCatalogSkill({
      orgSlug: `integration-a-${fixture.suffix}`,
      skillSlug: skill.slug,
      database: integrationDb,
    });
    expect(catalog).toBeTruthy();
    expect(catalog).not.toHaveProperty("creator_id");
    expect(catalog).not.toHaveProperty("creator_name");
    await expect(listPublicCatalog({
      limit: 50,
      offset: 0,
      label: `private-${fixture.suffix.slice(0, 8)}`,
      database: integrationDb,
    })).resolves.not.toContainEqual(expect.objectContaining({ skill_slug: skill.slug }));
  });

  it("reads only the pinned version and exact shared label assignment", async () => {
    const skill = await seedSkill({
      orgId: fixture.orgA,
      creator: fixture.owner,
      slug: `catalog-pinned-${fixture.suffix.slice(0, 8)}`,
      scope: "org",
      description: "Pinned catalog description",
    });
    await promote(skill, fixture.owner);
    const labelPath = `catalog-${fixture.suffix.slice(0, 8)}`;
    await integrationDb.insert(schema.labels).values({ orgId: fixture.orgA, path: labelPath, createdBy: fixture.owner.id });
    await integrationDb.insert(schema.skillLabels).values({
      orgId: fixture.orgA,
      skillId: skill.id,
      path: labelPath,
      createdBy: fixture.owner.id,
    });
    await setSkillPublicListing({ actor: fixture.owner, orgId: fixture.orgA, slug: skill.slug, listed: true, database: integrationDb });

    const draftId = randomUUID();
    await integrationDb.insert(schema.skillVersions).values({
      id: draftId,
      orgId: fixture.orgA,
      skillId: skill.id,
      version: "2.0.0",
      frontmatter: JSON.stringify({ name: skill.slug, description: "Private draft metadata", metadata: { hidden: true } }),
      body: "# Private draft body",
      sizeBytes: 512,
      checksum: `sha256:${"b".repeat(64)}`,
      storagePath: `integration/${fixture.orgA}/${skill.slug}/2.0.0.tar.gz`,
      createdBy: fixture.owner.id,
    });
    await integrationDb.update(schema.skills)
      .set({ currentVersionId: draftId, description: "Private draft metadata", updatedAt: new Date() })
      .where(eq(schema.skills.id, skill.id));

    const filtered = await listPublicCatalog({ limit: 50, offset: 0, label: labelPath, database: integrationDb });
    expect(filtered.map((entry) => entry.skill_slug)).toContain(skill.slug);
    const pinned = await getPublicCatalogSkill({
      orgSlug: `integration-a-${fixture.suffix}`,
      skillSlug: skill.slug,
      database: integrationDb,
    });
    expect(pinned).toMatchObject({
      version: "1.0.0",
      description: "Pinned catalog description",
      body: `# ${skill.slug}\n\nPinned catalog description`,
      files: FILES,
    });
    expect(pinned?.description).not.toBe("Private draft metadata");
    expect(pinned?.body).not.toContain("Private draft");
  });

  it("unlists without withdrawing the release, while clearing a release also clears consent", async () => {
    const skill = await seedSkill({
      orgId: fixture.orgA,
      creator: fixture.owner,
      slug: `catalog-withdraw-${fixture.suffix.slice(0, 8)}`,
      scope: "org",
    });
    await promote(skill, fixture.owner);
    await setSkillPublicListing({ actor: fixture.owner, orgId: fixture.orgA, slug: skill.slug, listed: true, database: integrationDb });
    const listed = await skillRow(skill);

    await setSkillPublicListing({ actor: fixture.owner, orgId: fixture.orgA, slug: skill.slug, listed: false, database: integrationDb });
    const unlisted = await skillRow(skill);
    expect(unlisted.publicVersionId).toBe(listed.publicVersionId);
    expect(unlisted.publicPackageChecksum).toBe(listed.publicPackageChecksum);
    expect(unlisted.publicPackageFiles).toEqual(FILES);
    expect(unlisted.shareToken).toBe(listed.shareToken);
    expect(await getPublicCatalogSkill({ orgSlug: `integration-a-${fixture.suffix}`, skillSlug: skill.slug, database: integrationDb })).toBeNull();

    await setSkillPublicListing({ actor: fixture.owner, orgId: fixture.orgA, slug: skill.slug, listed: true, database: integrationDb });
    await clearSkillPublicVersion({ actor: fixture.owner, orgId: fixture.orgA, slug: skill.slug, database: integrationDb });
    const cleared = await skillRow(skill);
    expect(cleared.publicVersionId).toBeNull();
    expect(cleared.publicPackageFiles).toBeNull();
    expect(cleared.listedPublicly).toBe(false);
    expect(cleared.listedAt).toBeNull();
    const audits = await integrationDb.select().from(schema.auditLog).where(and(
      eq(schema.auditLog.targetId, skill.id),
      eq(schema.auditLog.action, "skill.public_listing.clear"),
    ));
    expect(audits).toEqual(expect.arrayContaining([
      expect.objectContaining({ metadata: expect.objectContaining({ reason: "public_release_cleared" }) }),
    ]));
  });

  it("automatically delists an archived catalog entry and records the withdrawal", async () => {
    const skill = await seedSkill({
      orgId: fixture.orgA,
      creator: fixture.developer,
      slug: `catalog-archive-${fixture.suffix.slice(0, 8)}`,
      scope: "org",
    });
    await promote(skill, fixture.developer);
    await setSkillPublicListing({ actor: fixture.admin, orgId: fixture.orgA, slug: skill.slug, listed: true, database: integrationDb });
    await archiveSkill({ actor: fixture.developer, orgId: fixture.orgA, slug: skill.slug, database: integrationDb });
    const archived = await skillRow(skill);
    expect(archived.archivedAt).toBeInstanceOf(Date);
    expect(archived.listedPublicly).toBe(false);
    expect(archived.listedAt).toBeNull();
    expect(await getPublicCatalogSkill({ orgSlug: `integration-a-${fixture.suffix}`, skillSlug: skill.slug, database: integrationDb })).toBeNull();
    const audits = await integrationDb.select().from(schema.auditLog).where(and(
      eq(schema.auditLog.targetId, skill.id),
      eq(schema.auditLog.action, "skill.public_listing.clear"),
    ));
    expect(audits).toEqual(expect.arrayContaining([
      expect.objectContaining({ metadata: expect.objectContaining({ reason: "skill.archived" }) }),
    ]));
  });

  it("exposes the pre-tenant projection to the API role only", async () => {
    const [privileges] = await integrationDb.execute<{
      api_execute: boolean;
      worker_execute: boolean;
      public_execute: boolean;
    }>(sql`select
      has_function_privilege('companion_api', 'public.skillpack_list_public_catalog(integer,integer,text)', 'EXECUTE') as api_execute,
      has_function_privilege('companion_worker', 'public.skillpack_list_public_catalog(integer,integer,text)', 'EXECUTE') as worker_execute,
      has_function_privilege('public', 'public.skillpack_list_public_catalog(integer,integer,text)', 'EXECUTE') as public_execute`);
    expect(privileges).toEqual({ api_execute: true, worker_execute: false, public_execute: false });

    await integrationSql.begin(async (connection) => {
      await connection`set local role companion_api`;
      const rows = await connection`select * from public.skillpack_list_public_catalog(1, 0, null)`;
      expect(rows.length).toBeGreaterThan(0);
    });
    await expect(integrationSql.begin(async (connection) => {
      await connection`set local role companion_worker`;
      await connection`select * from public.skillpack_list_public_catalog(1, 0, null)`;
    })).rejects.toThrow();
  });
});
