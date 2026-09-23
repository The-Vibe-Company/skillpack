import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { schema } from "@skillpack/db";
import { packDir, unpackTo } from "@skillpack/skills";
import { migrateSkillUsageRuntime } from "../../src/skillUsageMigration";
import { createIntegrationFixture, integrationDb, seedSkill, type IntegrationFixture } from "./testDatabase";

let fixture: IntegrationFixture;
let dir: string;
const objects = new Map<string, Buffer>();
const storage = {
  async read(key: string) { const value = objects.get(key); if (!value) throw new Error("missing archive"); return value; },
  async write(key: string, bytes: Buffer) { if (objects.has(key)) throw new Error("immutable collision"); objects.set(key, bytes); },
};
beforeEach(async () => { fixture = await createIntegrationFixture(); dir = await mkdtemp(join(tmpdir(), "usage-migration-")); objects.clear(); });
afterEach(async () => { await fixture.cleanup(); await rm(dir, { recursive: true, force: true }); });
async function skill(creator = fixture.owner, scope: "org" | "personal" = "org") {
  const seeded = await seedSkill({ orgId: fixture.orgA, creator, scope, slug: `migration-${randomUUID()}` });
  await writeFile(join(dir, "SKILL.md"), `---\nname: ${seeded.slug}\ndescription: Preserve this description\n---\n\n<!-- skillpack:usage:start -->\nRun the old HTTP reporting.\n<!-- skillpack:usage:end -->\n\n# Authored instructions\nKeep this exact paragraph.\n`);
  await writeFile(join(dir, "data.bin"), Buffer.from([0, 255, 17]));
  const packed = await packDir(dir);
  const key = `old/${seeded.id}`; objects.set(key, packed.archive);
  await integrationDb.update(schema.skillVersions).set({ checksum: packed.checksum, storagePath: key, sizeBytes: packed.sizeBytes })
    .where(eq(schema.skillVersions.id, seeded.versionId));
  return { ...seeded, packed, key };
}
const run = (dryRun: boolean) => migrateSkillUsageRuntime({ database: integrationDb, actor: fixture.owner,
  orgId: fixture.orgA, instanceUrl: "https://skills.example.test", dryRun, storage });
describe("automatic runtime patch migration", () => {
  it("patches every active organization skill regardless of author, preserving archives and public pins", async () => {
    const first = await skill();
    const other = await skill(fixture.developer);
    const personal = await skill(fixture.owner, "personal");
    await integrationDb.update(schema.skills).set({ publicVersionId: first.versionId, publicPackageChecksum: first.packed.checksum, publicPackageSizeBytes: first.packed.sizeBytes, publicReleasedAt: new Date() }).where(eq(schema.skills.id, first.id));
    const preview = await run(true);
    expect(preview.map((r) => r.version)).toEqual(["1.0.1", "1.0.1"]);
    expect((await integrationDb.select().from(schema.skillVersions))).toHaveLength(3);
    expect(await run(false)).toHaveLength(2);
    expect(await run(false)).toEqual([]);
    const versions = await integrationDb.select().from(schema.skillVersions);
    expect(versions).toHaveLength(5);
    for (const source of [first, other]) {
      const next = versions.find((v) => v.skillId === source.id && v.version === "1.0.1")!;
      expect(next.body).toContain("Keep this exact paragraph.");
      expect(next.body).not.toContain("Run the old HTTP");
      expect(objects.get(source.key)).toEqual(source.packed.archive);
      const unpacked = await mkdtemp(join(tmpdir(), "migrated-"));
      try {
        await unpackTo(await storage.read(next.storagePath), unpacked);
        expect(await readFile(join(unpacked, "data.bin"))).toEqual(Buffer.from([0, 255, 17]));
        const manifest = JSON.parse(await readFile(join(unpacked, "companion.json"), "utf8"));
        expect(manifest.metadata.usage.migration).toEqual({ parentVersion: "1.0.0", parentChecksum: source.packed.checksum });
      } finally { await rm(unpacked, { recursive: true, force: true }); }
    }
    const [saved] = await integrationDb.select().from(schema.skills).where(eq(schema.skills.id, first.id));
    expect(saved?.publicVersionId).toBe(first.versionId);
    expect(saved?.creatorId).toBe(fixture.owner.id);
    expect(versions.filter((v) => v.skillId === personal.id)).toHaveLength(1);
  });
  it("does not partially publish when source integrity is wrong", async () => {
    const source = await skill(); objects.set(source.key, Buffer.from("corrupt"));
    await expect(run(false)).rejects.toThrow(/checksum|archive/i);
    expect(await integrationDb.select().from(schema.skillVersions).where(and(eq(schema.skillVersions.orgId, fixture.orgA), eq(schema.skillVersions.skillId, source.id)))).toHaveLength(1);
  });
  it("patches current 3.2.0 once while preserving a 2.1.0 public release and archived skills", async () => {
    const source = await skill();
    const archived = await skill(fixture.developer);
    await integrationDb.update(schema.skills).set({ archivedAt: new Date() }).where(eq(schema.skills.id, archived.id));
    await integrationDb.update(schema.skillVersions).set({ version: "2.1.0" }).where(eq(schema.skillVersions.id, source.versionId));
    const [base] = await integrationDb.select().from(schema.skillVersions).where(eq(schema.skillVersions.id, source.versionId));
    const currentId = randomUUID();
    await integrationDb.insert(schema.skillVersions).values({ ...base!, id: currentId, version: "3.2.0" });
    await integrationDb.update(schema.skills).set({ currentVersionId: currentId, publicVersionId: source.versionId,
      publicPackageChecksum: source.packed.checksum, publicPackageSizeBytes: source.packed.sizeBytes, publicReleasedAt: new Date() }).where(eq(schema.skills.id, source.id));
    expect((await run(false)).map((row) => row.version)).toEqual(["3.2.1"]);
    expect(await run(false)).toEqual([]);
    const [saved] = await integrationDb.select().from(schema.skills).where(eq(schema.skills.id, source.id));
    expect(saved?.publicVersionId).toBe(source.versionId);
    expect(await integrationDb.select().from(schema.skillVersions).where(eq(schema.skillVersions.skillId, archived.id))).toHaveLength(1);
  });
  it("does not overwrite a concurrent publication and replans from its newer version on retry", async () => {
    const source = await skill();
    const [base] = await integrationDb.select().from(schema.skillVersions).where(eq(schema.skillVersions.id, source.versionId));
    const concurrentId = randomUUID();
    const racingStorage = { ...storage, async write(key: string, bytes: Buffer) {
      await storage.write(key, bytes);
      await integrationDb.insert(schema.skillVersions).values({ ...base!, id: concurrentId, version: "1.1.0" });
      await integrationDb.update(schema.skills).set({ currentVersionId: concurrentId }).where(eq(schema.skills.id, source.id));
    } };
    await expect(migrateSkillUsageRuntime({ database: integrationDb, actor: fixture.owner, orgId: fixture.orgA,
      instanceUrl: "https://skills.example.test", dryRun: false, storage: racingStorage })).rejects.toThrow(/changed|concurrent|retry|monotonically/i);
    const [saved] = await integrationDb.select().from(schema.skills).where(eq(schema.skills.id, source.id));
    expect(saved?.currentVersionId).toBe(concurrentId);
    expect((await run(false)).map((row) => row.version)).toEqual(["1.1.1"]);
  });
});
