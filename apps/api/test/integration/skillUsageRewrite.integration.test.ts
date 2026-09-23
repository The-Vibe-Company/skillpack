import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { schema } from "@skillpack/db";
import { packDir, unpackTo, tarGzToZip } from "@skillpack/skills";
import { rewriteHistoricalSkillUsage } from "../../src/skillUsageRewrite";
import { createIntegrationFixture, integrationDb, seedSkill, type IntegrationFixture } from "./testDatabase";

const maintenanceSql = postgres(process.env.SKILL_USAGE_REWRITE_DATABASE_URL ?? process.env.DATABASE_URL!, { max: 1 });
afterAll(async () => { await maintenanceSql.end(); });
let fixture: IntegrationFixture;
let dir: string;
const objects = new Map<string, Buffer>();
const snapshots = new Map<string, Buffer>();
const instanceUrl = "https://skills.example.test";
const storage = {
  async read(key: string) { const bytes = objects.get(key); if (!bytes) throw new Error("missing fixture archive"); return bytes; },
  async archive(key: string, bytes: Buffer) { objects.set(key, bytes); },
  async publicSnapshot(org: string, checksum: string, bytes: Buffer) { snapshots.set(`${org}/${checksum}`, bytes); },
};
beforeEach(async () => {
  fixture = await createIntegrationFixture();
  dir = await mkdtemp(join(tmpdir(), "rewrite-integration-"));
  objects.clear(); snapshots.clear();
});
afterEach(async () => { await fixture.cleanup(); await rm(dir, { recursive: true, force: true }); });

async function fixtureSkill(orgId: string, scope: "personal" | "org") {
  const skill = await seedSkill({ orgId, creator: fixture.owner, slug: `rewrite-${randomUUID()}`, scope });
  const text = `---\n# Preserve this comment\nname: ${skill.slug}\ndescription: Preserve package\n---\n\n# Instructions\nKeep all authored content.\n`;
  await writeFile(join(dir, "SKILL.md"), text);
  await writeFile(join(dir, "data.bin"), Buffer.from([0, 255, 21]));
  const packed = await packDir(dir);
  const path = `${orgId}/${skill.id}/old.tar.gz`;
  objects.set(path, packed.archive);
  await integrationDb.update(schema.skillVersions).set({ checksum: packed.checksum, storagePath: path, sizeBytes: packed.sizeBytes })
    .where(and(eq(schema.skillVersions.orgId, orgId), eq(schema.skillVersions.id, skill.versionId)));
  return { ...skill, path, packed, text };
}

describe("release historical usage retrofit", () => {
  it("rewrites every historical, personal, archived and tenant version once, retaining install baselines", async () => {
    const org = await fixtureSkill(fixture.orgA, "org");
    const personal = await fixtureSkill(fixture.orgA, "personal");
    const archived = await fixtureSkill(fixture.orgB, "org");
    await integrationDb.update(schema.skills).set({ archivedAt: new Date() }).where(eq(schema.skills.id, archived.id));
    await integrationDb.insert(schema.skillVersions).values({
      orgId: org.orgId, skillId: org.id, version: "0.9.0", frontmatter: "{}", body: "old",
      sizeBytes: org.packed.sizeBytes, checksum: org.packed.checksum, storagePath: org.path, createdBy: fixture.owner.id,
    });
    await integrationDb.insert(schema.skillInstalls).values({ orgId: org.orgId, skillId: org.id, userId: fixture.owner.id,
      installedVersion: "1.0.0", installedChecksum: org.packed.checksum });
    expect(await rewriteHistoricalSkillUsage(maintenanceSql, { instanceUrl, storage })).toBe(4);
    expect(await rewriteHistoricalSkillUsage(maintenanceSql, { instanceUrl, storage })).toBe(0);
    const versions = await integrationDb.select().from(schema.skillVersions);
    expect(versions).toHaveLength(4);
    for (const version of versions) {
      expect(version.body).toContain(`"version":"${version.version}"`);
      expect(version.body.match(/<!-- skillpack:usage:start -->/g)).toHaveLength(1);
      expect(version.usageReportingRevision).toBe(1);
    }
    const rewritten = versions.find((v) => v.id === personal.versionId)!;
    await unpackTo(await storage.read(rewritten.storagePath), dir);
    expect(await readFile(join(dir, "data.bin"))).toEqual(Buffer.from([0, 255, 21]));
    expect(await readFile(join(dir, "SKILL.md"), "utf8")).toContain("# Preserve this comment");
    expect(objects.get(personal.path)).toEqual(personal.packed.archive);
    const [install] = await integrationDb.select().from(schema.skillInstalls).where(eq(schema.skillInstalls.skillId, org.id));
    expect(install?.installedChecksum).toBe(org.packed.checksum);
    const audits = await integrationDb.select().from(schema.auditLog).where(eq(schema.auditLog.action, "skill.usage_reporting_rewrite"));
    expect(audits).toHaveLength(4);
    expect(audits.find((a) => a.targetId === personal.id)?.privateToUserId).toBe(fixture.owner.id);
  });

  it("keeps public and private references unchanged on storage failure, then resumes with a matching public ZIP", async () => {
    const skill = await fixtureSkill(fixture.orgA, "org");
    const oldPublicChecksum = `sha256:${"a".repeat(64)}`;
    await integrationDb.update(schema.skills).set({ publicVersionId: skill.versionId,
      publicPackageChecksum: oldPublicChecksum, publicPackageSizeBytes: 1, publicReleasedAt: new Date() }).where(eq(schema.skills.id, skill.id));
    await expect(rewriteHistoricalSkillUsage(maintenanceSql, { instanceUrl, storage: {
      ...storage, async publicSnapshot() { throw new Error("storage offline"); },
    } })).rejects.toThrow("storage offline");
    const [before] = await integrationDb.select().from(schema.skillVersions).where(eq(schema.skillVersions.id, skill.versionId));
    expect(before?.storagePath).toBe(skill.path);
    expect(before?.usageReportingRevision).toBe(0);
    expect(await rewriteHistoricalSkillUsage(maintenanceSql, { instanceUrl, storage })).toBe(1);
    const [after] = await integrationDb.select().from(schema.skills).where(eq(schema.skills.id, skill.id));
    expect(after?.publicVersionId).toBe(skill.versionId);
    const zip = snapshots.get(`${skill.orgId}/${after?.publicPackageChecksum}`)!;
    expect(`sha256:${createHash("sha256").update(zip).digest("hex")}`).toBe(after?.publicPackageChecksum);
    const [version] = await integrationDb.select().from(schema.skillVersions).where(eq(schema.skillVersions.id, skill.versionId));
    expect(await tarGzToZip(await storage.read(version!.storagePath))).toEqual(zip);
  });

  it("fails closed for wrong source checksums or a runtime role", async () => {
    const skill = await fixtureSkill(fixture.orgA, "personal");
    objects.set(skill.path, Buffer.from("wrong bytes"));
    await expect(rewriteHistoricalSkillUsage(maintenanceSql, { instanceUrl, storage })).rejects.toThrow("checksum mismatch");
    const api = postgres(process.env.DATABASE_API_URL!, { max: 1 });
    try { await expect(rewriteHistoricalSkillUsage(api, { instanceUrl, storage })).rejects.toThrow("migration table owner"); }
    finally { await api.end(); }
  });
});
