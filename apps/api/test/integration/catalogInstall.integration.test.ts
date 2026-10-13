import { createHash, randomUUID } from "node:crypto";
import { zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { schema, type Db } from "@skillpack/db";
import { applyValidatedSubmission, getPublicCatalogPackage, setSkillPublicListing } from "@skillpack/core";
import { clearSkillPublicVersion, setSkillPublicVersion } from "@skillpack/core/services";
import { createPublicCatalogRoutes } from "../../src/publicCatalogRoutes";
import { createIntegrationFixture, integrationDb, integrationSql, seedSkill, type IntegrationFixture } from "./testDatabase";

process.env.COMPANION_BILLING_MODE = "off";

describe("anonymous validated catalog install", () => {
  let fixture: IntegrationFixture;
  beforeAll(async () => { fixture = await createIntegrationFixture(); });
  afterAll(async () => fixture.cleanup());

  it("delivers the frozen published version through the API role, rejecting unpublished and withdrawn releases", async () => {
    const skill = await seedSkill({ orgId: fixture.orgA, creator: fixture.owner, scope: "org", slug: "catalog-install" });
    const markdown = Buffer.from(`---\nname: ${skill.slug}\ndescription: Catalog install fixture\nlicense: MIT\n---\n${"Useful instructions. ".repeat(10)}`);
    const zip = Buffer.from(zipSync({ "SKILL.md": markdown }));
    const checksum = `sha256:${createHash("sha256").update(zip).digest("hex")}`;
    await setSkillPublicVersion({ actor: fixture.owner, orgId: fixture.orgA, slug: skill.slug, version: "1.0.0",
      packageChecksum: checksum, packageSizeBytes: zip.length, packageFiles: [{ path: "SKILL.md", size_bytes: markdown.length }], database: integrationDb });
    const path = { orgSlug: `integration-a-${fixture.suffix}`, skillSlug: skill.slug };
    const url = `/v1/public/catalog/skills/${path.orgSlug}/${skill.slug}/versions/1.0.0/package`;
    const readArchive = vi.fn().mockResolvedValue(zip);
    // Resolve as the NOBYPASSRLS API role with no tenant or member identity set.
    const resolvePackage: typeof getPublicCatalogPackage = async (input) => integrationDb.transaction(async (tx) => {
      await tx.execute(sql`set local role companion_api`);
      const transactionDatabase: unknown = tx;
      // SAFETY: the transaction uses the same Drizzle schema and execute contract as integrationDb.
      const database = transactionDatabase as Db;
      return getPublicCatalogPackage({ ...input, database });
    });
    const app = createPublicCatalogRoutes({ resolvePackage, readArchive, enabled: () => true });
    expect((await app.request(url)).status).toBe(404);
    const proposed = await setSkillPublicListing({ actor: fixture.owner, orgId: fixture.orgA, slug: skill.slug, listed: true, packageBytes: zip, database: integrationDb });
    expect((await app.request(url)).status).toBe(404);
    expect(readArchive).not.toHaveBeenCalled();
    await applyValidatedSubmission({ orgId: fixture.orgA, submissionId: proposed.latest_submission!.id, decidedBy: fixture.owner.id, database: integrationDb });
    // A newer upload AND public release must not replace the validated package.
    const versionId = randomUUID();
    await integrationDb.insert(schema.skillVersions).values({ id: versionId, orgId: skill.orgId, skillId: skill.id,
      version: "2.0.0", frontmatter: JSON.stringify({ name: skill.slug, description: "Unvalidated" }), body: "unvalidated",
      sizeBytes: 20, checksum: `sha256:${"b".repeat(64)}`, storagePath: "unvalidated.tar.gz", createdBy: fixture.owner.id });
    await integrationDb.update(schema.skills).set({ currentVersionId: versionId }).where(and(eq(schema.skills.orgId, skill.orgId), eq(schema.skills.id, skill.id)));
    await setSkillPublicVersion({ actor: fixture.owner, orgId: fixture.orgA, slug: skill.slug, version: "2.0.0",
      packageChecksum: `sha256:${"b".repeat(64)}`, packageSizeBytes: 20, packageFiles: [], database: integrationDb });
    expect(await resolvePackage(path)).toEqual({ orgId: fixture.orgA, slug: skill.slug, version: "1.0.0", checksum, sizeBytes: zip.length });
    const response = await app.request(url);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(zip);
    expect(response.headers.get("x-companion-public-version")).toBe("1.0.0");
    expect(response.headers.get("x-companion-package-checksum")).toBe(checksum);
    expect(readArchive).toHaveBeenCalledWith({ key: `${fixture.orgA}/public-releases/sha256/${checksum.slice(7)}.zip` });
    expect((await app.request(url.replace("1.0.0", "2.0.0"))).status).toBe(404);
    await setSkillPublicListing({ actor: fixture.owner, orgId: fixture.orgA, slug: skill.slug, listed: false, database: integrationDb });
    expect((await app.request(url)).status).toBe(404);
    const markdown2 = Buffer.from(`---\nname: ${skill.slug}\ndescription: Catalog install second fixture\nlicense: MIT\n---\n${"Useful instructions. ".repeat(10)}`);
    const zip2 = Buffer.from(zipSync({ "SKILL.md": markdown2 }));
    const checksum2 = `sha256:${createHash("sha256").update(zip2).digest("hex")}`;
    await setSkillPublicVersion({ actor: fixture.owner, orgId: fixture.orgA, slug: skill.slug, version: "2.0.0",
      packageChecksum: checksum2, packageSizeBytes: zip2.length, packageFiles: [{ path: "SKILL.md", size_bytes: markdown2.length }], database: integrationDb });
    const resubmitted = await setSkillPublicListing({ actor: fixture.owner, orgId: fixture.orgA, slug: skill.slug, listed: true, packageBytes: zip2, database: integrationDb });
    await applyValidatedSubmission({ orgId: fixture.orgA, submissionId: resubmitted.latest_submission!.id, decidedBy: fixture.owner.id, database: integrationDb });
    await clearSkillPublicVersion({ actor: fixture.owner, orgId: fixture.orgA, slug: skill.slug, database: integrationDb });
    expect((await app.request(url.replace("1.0.0", "2.0.0"))).status).toBe(404);
  });

  it("keeps the internal package projection API-only", async () => {
    const [grants] = await integrationDb.execute(sql`select
      has_function_privilege('companion_api', 'public.skillpack_get_public_catalog_package(text,text)', 'EXECUTE') as api,
      has_function_privilege('companion_worker', 'public.skillpack_get_public_catalog_package(text,text)', 'EXECUTE') as worker,
      has_function_privilege('public', 'public.skillpack_get_public_catalog_package(text,text)', 'EXECUTE') as anonymous`);
    expect(grants).toEqual({ api: true, worker: false, anonymous: false });
    await expect(integrationSql.begin(async (connection) => {
      await connection`set local role companion_worker`;
      await connection`select * from public.skillpack_get_public_catalog_package('example', 'skill')`;
    })).rejects.toThrow();
  });
});
