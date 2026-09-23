import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { schema, withTenantContextOn, type Db } from "@skillpack/db";
import { bumpSemver, packDir, prepareSkillDirForPublish, skillChecksum, toTar, unpackTo,
  buildNormalizedSkillpackJson, toStoredSkillVersionManifest, parseFrontmatter } from "@skillpack/skills";
import { skillpackManifestSchema, skillpackDependencySlugs } from "@skillpack/contracts";
import { publishSkillVersion, type ActorContext } from "@skillpack/core/services";
import { getSkillArchive, putSkillArchive, isStoragePreconditionFailure } from "@skillpack/storage";

interface MigrationStorage {
  read(key: string): Promise<Buffer>;
  write(key: string, bytes: Buffer): Promise<void>;
}

/** Release configuration is explicit: no implicit cross-tenant catalogue mutation. */
export function runtimeMigrationConfiguration(env: NodeJS.ProcessEnv): { orgId: string; actorId: string; origin: string } | null {
  const orgId = env.SKILLPACK_USAGE_MIGRATION_ORG_ID;
  const actorId = env.SKILLPACK_USAGE_MIGRATION_ACTOR_ID;
  const origin = env.SKILLPACK_USAGE_MIGRATION_ORIGIN;
  if (!orgId && !actorId && !origin) return null;
  if (!orgId || !actorId || !origin) throw new Error("Configure all three SKILLPACK_USAGE_MIGRATION variables together");
  const url = new URL(origin);
  if (url.origin !== origin || url.username || url.password || url.protocol !== "https:") throw new Error("Invalid runtime migration origin");
  return { orgId, actorId, origin };
}

export async function migrateConfiguredSkillUsageRuntime(database: Db, env: NodeJS.ProcessEnv): Promise<number> {
  const config = runtimeMigrationConfiguration(env);
  if (!config) return 0;
  const [actor] = await database.select().from(schema.user).where(eq(schema.user.id, config.actorId));
  if (!actor) throw new Error("Runtime migration actor does not exist");
  const result = await migrateSkillUsageRuntime({ database, actor, orgId: config.orgId, instanceUrl: config.origin, dryRun: false });
  return result.length;
}
const archiveStorage: MigrationStorage = {
  read: (key) => getSkillArchive({ key, signal: AbortSignal.timeout(30_000) }),
  async write(key, body) {
    try { await putSkillArchive({ key, body, preventOverwrite: true, signal: AbortSignal.timeout(30_000) }); }
    catch (error) {
      if (!isStoragePreconditionFailure(error)) throw error;
      const previous = await getSkillArchive({ key, signal: AbortSignal.timeout(30_000) });
      if (!toTar(previous).equals(toTar(body))) throw new Error("runtime migration archive collision");
    }
  },
};

function migrated(frontmatter: string, instanceUrl: string): boolean {
  const stored = JSON.parse(frontmatter);
  const manifest = skillpackManifestSchema.safeParse(stored.companion);
  return manifest.success && manifest.data.metadata.usage?.schemaVersion === 1
    && manifest.data.metadata.usage.origin === new URL(instanceUrl).origin;
}

/** Explicit organization, all authors, latest only. Never rewrites a historical/public archive.
 * The new immutable manifest records the base checksum, so a rerun can resume after any crash. */
export async function migrateSkillUsageRuntime(input: {
  database: Db; actor: ActorContext; orgId: string; instanceUrl: string; dryRun: boolean;
  storage?: MigrationStorage;
}): Promise<{ skillId: string; slug: string; previousVersion: string; version: string; applied: boolean }[]> {
  const objects = input.storage ?? archiveStorage;
  const context = { orgId: input.orgId, userId: input.actor.id };
  const ids = await withTenantContextOn(input.database, context, async (database) => {
    const [member] = await database.select().from(schema.memberships).where(and(
      eq(schema.memberships.orgId, input.orgId), eq(schema.memberships.userId, input.actor.id)));
    if (!member) throw new Error("organization membership required for runtime migration");
    return database.select({ id: schema.skills.id }).from(schema.skills).where(and(
      eq(schema.skills.orgId, input.orgId), eq(schema.skills.scope, "org"), isNull(schema.skills.archivedAt)));
  });
  const results: { skillId: string; slug: string; previousVersion: string; version: string; applied: boolean }[] = [];
  for (const { id } of ids) {
    const row = await withTenantContextOn(input.database, context, async (database) => {
      const [value] = await database.select({ skill: schema.skills, version: schema.skillVersions }).from(schema.skills)
        .innerJoin(schema.skillVersions, and(eq(schema.skills.currentVersionId, schema.skillVersions.id), eq(schema.skills.orgId, schema.skillVersions.orgId)))
        .where(and(eq(schema.skills.id, id), eq(schema.skills.orgId, input.orgId), eq(schema.skills.scope, "org"), isNull(schema.skills.archivedAt)));
      return value;
    });
    if (!row || migrated(row.version.frontmatter, input.instanceUrl)) continue;
    const version = bumpSemver(row.version.version, "patch");
    const result = { skillId: id, slug: row.skill.slug, previousVersion: row.version.version, version, applied: false };
    if (input.dryRun) { results.push(result); continue; }
    const source = await objects.read(row.version.storagePath);
    if (skillChecksum(toTar(source)) !== row.version.checksum) throw new Error("runtime migration source checksum mismatch");
    const dir = await mkdtemp(join(tmpdir(), "skill-runtime-migration-"));
    try {
      await unpackTo(source, dir);
      const prepared = await prepareSkillDirForPublish(dir, { skillId: id, version, instanceUrl: input.instanceUrl });
      const manifest = prepared.skillpackManifest;
      if (!manifest.metadata.usage) throw new Error("runtime metadata missing");
      manifest.metadata.usage.migration = { parentVersion: row.version.version, parentChecksum: row.version.checksum };
      const entry = manifest.metadata.changelog.find((item) => item.version === version);
      if (entry) entry.changes = ["Replace model activation reporting with automatic Skillpack runtime collection."];
      await writeFile(prepared.skillpackManifestPath, buildNormalizedSkillpackJson(manifest));
      const packed = await packDir(prepared.rootDir);
      const key = `${input.orgId}/usage-runtime-v1/${id}/${row.version.id}/${packed.checksum.slice(7)}.tar.gz`;
      await objects.write(key, packed.archive);
      const verified = await objects.read(key);
      if (skillChecksum(toTar(verified)) !== packed.checksum) throw new Error("runtime migration published checksum mismatch");
      const parsed = parseFrontmatter(await readFile(join(prepared.rootDir, "SKILL.md"), "utf8"));
      if (!parsed.ok) throw new Error("runtime migration produced invalid SKILL.md");
      await withTenantContextOn(input.database, context, (database) => publishSkillVersion({
        actor: input.actor, orgId: input.orgId, archiveKey: key, database,
        expectedCurrentVersionId: row.version.id,
        payload: {
          skill_id: id, slug: row.skill.slug, scope: "org", version,
          description: row.skill.description, labels: [], checksum: packed.checksum,
          storage_path: key, size_bytes: packed.sizeBytes,
          frontmatter: JSON.stringify(toStoredSkillVersionManifest(prepared.frontmatter, manifest)),
          body: parsed.body, tools: prepared.frontmatter.allowedTools, license: prepared.frontmatter.license ?? null,
          dependencies: skillpackDependencySlugs(manifest), note: "Automatic runtime usage migration (schema 1)",
        },
      }));
      results.push({ ...result, applied: true });
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
  return results;
}
