import { zipSync } from "fflate";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { packDir, tarGzToZip } from "@skillpack/skills";
import { createSkillpackMcpServer } from "../../src/mcp/server";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
  applyValidatedSubmission,
  getPublicCatalogSkill,
  listPublicCatalog,
  prepareSkillPublicListing,
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

  const packages = new Map<string, Buffer>();
  function packageBytes(slug: string) {
    return Buffer.from(zipSync({ "SKILL.md": Buffer.from(`---\nname: ${slug}\ndescription: Catalog fixture\nlicense: MIT\n---\n${"Useful instructions. ".repeat(10)}`) }));
  }
  const checksumFor = (slug: string) => `sha256:${createHash("sha256").update(packages.get(slug)!).digest("hex")}`;
  async function promote(
    skill: SeededSkill,
    actor: IntegrationFixture["developer"],
    packageFiles: readonly { path: string; size_bytes: number }[] | undefined = FILES,
  ): Promise<void> {
    packages.set(skill.slug, packageBytes(skill.slug));
    const releaseInput: Parameters<typeof setSkillPublicVersion>[0] = {
      actor,
      orgId: skill.orgId,
      slug: skill.slug,
      version: "1.0.0",
      packageChecksum: checksumFor(skill.slug),
      packageSizeBytes: packages.get(skill.slug)!.length,
      database: integrationDb,
    };
    if (packageFiles !== undefined) releaseInput.packageFiles = packageFiles;
    await setSkillPublicVersion(releaseInput);
  }

  async function submitAndValidate(input: Parameters<typeof setSkillPublicListing>[0]) {
    const result = await setSkillPublicListing({ ...input, packageBytes: packages.get(input.slug) });
    if (!result.latest_submission) throw new Error("missing submission");
    await applyValidatedSubmission({ orgId: input.orgId, submissionId: result.latest_submission.id, decidedBy: fixture.owner.id, database: integrationDb });
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

    expect(await integrationDb.query.catalogSubmissions.findFirst({ where: eq(schema.catalogSubmissions.skillId, skill.id) })).toBeUndefined();
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
      packageBytes: packages.get(skill.slug),
    })).resolves.toMatchObject({ listed_publicly: false, latest_submission: { status: "proposed", kind: "submission" }, changed: true });
    const submission = await integrationDb.query.catalogSubmissions.findFirst({ where: eq(schema.catalogSubmissions.skillId, skill.id) });
    if (!submission) throw new Error("missing submission");
    await applyValidatedSubmission({ orgId: fixture.orgA, submissionId: submission.id, decidedBy: fixture.owner.id, database: integrationDb });

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
      checksum: checksumFor(skill.slug),
      size_bytes: packages.get(skill.slug)!.length,
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
    await submitAndValidate({ actor: fixture.owner, orgId: fixture.orgA, slug, listed: true, database: integrationDb });

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

  it("rejects personal listing for every member and keeps it out of anonymous discovery", async () => {
    const skill = await seedSkill({
      orgId: fixture.orgA,
      creator: fixture.developer,
      slug: `catalog-personal-${fixture.suffix.slice(0, 8)}`,
      scope: "personal",
    });
    await seedPersonalLabel({
      orgId: fixture.orgA,
      owner: fixture.developer,
      skillId: skill.id,
      path: `private-${fixture.suffix.slice(0, 8)}`,
    });

    for (const actor of [fixture.owner, fixture.admin, fixture.developer]) {
      const error = actor.id === fixture.developer.id
        ? SkillPublicReleaseForbiddenError
        : SkillPublicReleaseNotFoundError;
      for (const listed of [true, false]) {
        await expect(setSkillPublicListing({
          actor, orgId: fixture.orgA, slug: skill.slug, listed, database: integrationDb,
        })).rejects.toBeInstanceOf(error);
      }
      await expect(prepareSkillPublicListing({
        actor, orgId: fixture.orgA, slug: skill.slug, database: integrationDb,
      })).rejects.toBeInstanceOf(error);
    }

    // Complete release metadata isolates the scope check from the completeness check.
    await integrationDb.update(schema.skills).set({
      publicVersionId: skill.versionId,
      publicPackageChecksum: `sha256:${"a".repeat(64)}`,
      publicPackageSizeBytes: 1_024,
      publicReleasedAt: new Date(),
      publicPackageFiles: FILES,
    }).where(and(eq(schema.skills.orgId, skill.orgId), eq(schema.skills.id, skill.id)));
    await expect(integrationDb.update(schema.skills)
      .set({ listedPublicly: true, listedAt: new Date() })
      .where(and(eq(schema.skills.orgId, skill.orgId), eq(schema.skills.id, skill.id))))
      .rejects.toThrow();

    // Prove both SQL projections reject even inconsistent personal listing rows. All DDL and
    // fixture changes here roll back, leaving the production constraint in place for other tests.
    await expect(integrationSql.begin(async (connection) => {
      await connection`alter table public.skills drop constraint skills_public_listing_complete_check`;
      await connection`update public.skills set listed_publicly = true, listed_at = now()
        where org_id = ${skill.orgId} and id = ${skill.id}`;
      await connection`set local role companion_api`;
      const rows = await connection`select * from public.skillpack_list_public_catalog(50, 0, null)`;
      expect(rows).not.toContainEqual(expect.objectContaining({ skill_slug: skill.slug }));
      const detail = await connection`select * from public.skillpack_get_public_catalog_skill(
        ${`integration-a-${fixture.suffix}`}, ${skill.slug})`;
      expect(detail).toHaveLength(0);
      throw new Error("roll back inconsistent personal fixture");
    })).rejects.toThrow("roll back inconsistent personal fixture");

    expect(await getPublicCatalogSkill({
      orgSlug: `integration-a-${fixture.suffix}`, skillSlug: skill.slug, database: integrationDb,
    })).toBeNull();
    for (const label of [undefined, `private-${fixture.suffix.slice(0, 8)}`]) {
      await expect(listPublicCatalog({ limit: 50, offset: 0, label, database: integrationDb }))
        .resolves.not.toContainEqual(expect.objectContaining({ skill_slug: skill.slug }));
    }
    expect((await skillRow(skill)).listedPublicly).toBe(false);
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
    await submitAndValidate({ actor: fixture.owner, orgId: fixture.orgA, slug: skill.slug, listed: true, database: integrationDb });

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

  it("preserves catalog consent when MCP promotes a verified release and rejects tampered bytes", async () => {
    const skill = await seedSkill({
      orgId: fixture.orgA, creator: fixture.owner,
      slug: `catalog-mcp-${fixture.suffix.slice(0, 8)}`, scope: "org",
    });
    await promote(skill, fixture.owner);
    await submitAndValidate({ actor: fixture.owner, orgId: fixture.orgA,
      slug: skill.slug, listed: true, database: integrationDb });
    const directory = await mkdtemp(join(tmpdir(), "catalog-mcp-"));
    const client = new Client({ name: "catalog-integration", version: "1" });
    try {
      const markdown = `---\nname: ${skill.slug}\ndescription: MCP release\nlicense: MIT\n---\n\nNew public instructions.\n`;
      await writeFile(join(directory, "SKILL.md"), markdown);
      await mkdir(join(directory, "scripts"));
      await writeFile(join(directory, "scripts/helper.sh"), "echo release\n");
      const packed = await packDir(directory);
      const versionId = randomUUID();
      await integrationDb.insert(schema.skillVersions).values({
        id: versionId, orgId: skill.orgId, skillId: skill.id, version: "2.0.0",
        frontmatter: JSON.stringify({ name: skill.slug, description: "MCP release", metadata: {} }),
        body: "New public instructions.", sizeBytes: packed.sizeBytes, checksum: packed.checksum,
        storagePath: `integration/${skill.orgId}/${skill.slug}/2.0.0.tar.gz`, createdBy: fixture.owner.id,
      });
      await integrationDb.update(schema.skills).set({ currentVersionId: versionId })
        .where(and(eq(schema.skills.orgId, skill.orgId), eq(schema.skills.id, skill.id)));
      const storageMocks = {
        getSkillArchive: vi.fn().mockResolvedValue(packed.archive),
        putPublicSkillReleaseSnapshot: vi.fn().mockResolvedValue(undefined),
      };
      const server = createSkillpackMcpServer({
        connection: { actor: fixture.owner, orgId: fixture.orgA, clientId: "catalog-test" },
        publicReleaseStorage: storageMocks,
        skillDatabaseRuntime: { execute: async () => { throw new Error("unused database runtime"); } },
        skillDatabaseStorage: {
          get: async () => { throw new Error("unused database storage"); },
          put: async () => { throw new Error("unused database storage"); },
          delete: async () => { throw new Error("unused database storage"); },
        },
      });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const result = await client.callTool({ name: "skill_set_public_version",
        arguments: { slug: skill.slug, version: "2.0.0" } });
      expect(result.isError).not.toBe(true);
      const zip = await tarGzToZip(packed.archive);
      const checksum = `sha256:${createHash("sha256").update(zip).digest("hex")}`;
      packages.set(skill.slug, zip);
      expect(await getPublicCatalogSkill({ orgSlug: `integration-a-${fixture.suffix}`,
        skillSlug: skill.slug, database: integrationDb })).toMatchObject({ version: "1.0.0", files: FILES });
      await submitAndValidate({ actor: fixture.owner, orgId: fixture.orgA, slug: skill.slug, listed: true, database: integrationDb });
      expect(await getPublicCatalogSkill({ orgSlug: `integration-a-${fixture.suffix}`,
        skillSlug: skill.slug, database: integrationDb })).toMatchObject({
        version: "2.0.0", body: "New public instructions.", checksum,
        files: [
          { path: "SKILL.md", size_bytes: Buffer.byteLength(markdown) },
          { path: "scripts/helper.sh", size_bytes: Buffer.byteLength("echo release\n") },
        ],
      });
      expect((await skillRow(skill)).listedPublicly).toBe(true);
      expect(storageMocks.putPublicSkillReleaseSnapshot).toHaveBeenCalledWith({
        orgId: fixture.orgA, checksum, body: zip,
      });
      storageMocks.getSkillArchive.mockResolvedValue(Buffer.from("tampered archive"));
      const tampered = await client.callTool({ name: "skill_set_public_version",
        arguments: { slug: skill.slug, version: "2.0.0" } });
      expect(tampered.isError).toBe(true);
      expect(storageMocks.putPublicSkillReleaseSnapshot).toHaveBeenCalledTimes(1);
      expect((await skillRow(skill)).listedPublicly).toBe(true);
    } finally {
      await client.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("unlists without withdrawing the release, while clearing a release also clears consent", async () => {
    const skill = await seedSkill({
      orgId: fixture.orgA,
      creator: fixture.owner,
      slug: `catalog-withdraw-${fixture.suffix.slice(0, 8)}`,
      scope: "org",
    });
    await promote(skill, fixture.owner);
    await submitAndValidate({ actor: fixture.owner, orgId: fixture.orgA, slug: skill.slug, listed: true, database: integrationDb });
    const listed = await skillRow(skill);

    await setSkillPublicListing({ actor: fixture.owner, orgId: fixture.orgA, slug: skill.slug, listed: false, database: integrationDb });
    const unlisted = await skillRow(skill);
    expect(unlisted.publicVersionId).toBe(listed.publicVersionId);
    expect(unlisted.publicPackageChecksum).toBe(listed.publicPackageChecksum);
    expect(unlisted.publicPackageFiles).toEqual(FILES);
    expect(unlisted.shareToken).toBe(listed.shareToken);
    expect(await getPublicCatalogSkill({ orgSlug: `integration-a-${fixture.suffix}`, skillSlug: skill.slug, database: integrationDb })).toBeNull();

    await submitAndValidate({ actor: fixture.owner, orgId: fixture.orgA, slug: skill.slug, listed: true, database: integrationDb });
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
    await submitAndValidate({ actor: fixture.admin, orgId: fixture.orgA, slug: skill.slug, listed: true, database: integrationDb });
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
