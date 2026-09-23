import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type postgres from "postgres";
import {
  extractFrontmatter, packDir, skillChecksum, tarGzToZip, toTar, unpackTo, withSkillUsageInstructions,
} from "@skillpack/skills";
import {
  getSkillArchive, putSkillArchive, putPublicSkillReleaseSnapshot, isStoragePreconditionFailure,
} from "@skillpack/storage";

interface RewriteStorage {
  read(key: string): Promise<Buffer>;
  archive(key: string, bytes: Buffer): Promise<void>;
  publicSnapshot(orgId: string, checksum: string, bytes: Buffer): Promise<void>;
}

const storage: RewriteStorage = {
  read: (key) => getSkillArchive({ key, signal: AbortSignal.timeout(30_000) }),
  async archive(key, body) {
    try {
      await putSkillArchive({ key, body, preventOverwrite: true, signal: AbortSignal.timeout(30_000) });
    } catch (error) {
      if (!isStoragePreconditionFailure(error)) throw error;
      const saved = await getSkillArchive({ key, signal: AbortSignal.timeout(30_000) });
      if (!toTar(saved).equals(toTar(body))) throw new Error("Historical usage rewrite archive collision");
    }
  },
  async publicSnapshot(orgId, checksum, body) {
    await putPublicSkillReleaseSnapshot({ orgId, checksum, body, signal: AbortSignal.timeout(30_000) });
  },
};

/** Preserve every authored file and the exact YAML header. Never execute package code. */
export async function rewriteUsageArchive(archive: Buffer, input: {
  skillId: string; version: string; instanceUrl: string; checksum: string;
}) {
  if (skillChecksum(toTar(archive)) !== input.checksum) throw new Error("Historical archive checksum mismatch");
  const dir = await mkdtemp(join(tmpdir(), "skill-usage-rewrite-"));
  try {
    await unpackTo(archive, dir);
    const path = join(dir, "SKILL.md");
    const original = await readFile(path, "utf8");
    const parsed = extractFrontmatter(original);
    if (parsed.raw === null) throw new Error("Historical SKILL.md has no frontmatter");
    const header = original.slice(0, original.length - parsed.body.length);
    const body = withSkillUsageInstructions(parsed.body, input);
    await writeFile(path, `${header}\n${body}\n`);
    return { ...await packDir(dir), body };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

interface RewriteRow {
  id: string; org_id: string; skill_id: string; version: string;
  checksum: string; storage_path: string; size_bytes: number;
  scope: string; creator_id: string; public_version_id: string | null;
  public_package_checksum: string | null; public_package_size_bytes: number | null;
}

/** Called only by the release CLI under its migration lock, never by an API/worker runtime. */
export async function rewriteHistoricalSkillUsage(client: ReturnType<typeof postgres>, input: {
  instanceUrl?: string; storage?: RewriteStorage;
} = {}): Promise<number> {
  // Historical schema-only replays may stop before this maintenance checkpoint exists.
  const [column] = await client`select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'skill_versions' and column_name = 'usage_reporting_revision'`;
  if (!column) return 0;
  const [owner] = await client`select 1 from pg_class c join pg_roles r on r.oid = c.relowner
    where c.oid = 'public.skill_versions'::regclass and r.rolname = current_user`;
  if (!owner) throw new Error("Historical skill rewrite requires the migration table owner");
  const objects = input.storage ?? storage;
  let rewritten = 0;
  for (;;) {
    const changed = await client.begin(async (tx) => {
      // Fail closed rather than silently processing a tenant-filtered subset.
      await tx`set local row_security = off`;
      const [row] = await tx<RewriteRow[]>`select v.id, v.org_id, v.skill_id, v.version,
        v.checksum, v.storage_path, v.size_bytes, s.scope, s.creator_id,
        s.public_version_id, s.public_package_checksum, s.public_package_size_bytes
        from skill_versions v join skills s on s.id = v.skill_id and s.org_id = v.org_id
        where v.usage_reporting_revision < 1 order by v.org_id, v.skill_id, v.id
        limit 1 for update of s, v`;
      if (!row) return false;
      if (!input.instanceUrl) throw new Error("BETTER_AUTH_URL or COMPANION_API_URL is required to retrofit existing skills");
      const original = await objects.read(row.storage_path);
      const updated = await rewriteUsageArchive(original, {
        skillId: row.skill_id, version: row.version, checksum: row.checksum, instanceUrl: input.instanceUrl,
      });
      // New content address first, then atomic DB pointer swap: readers never see mismatched bytes.
      // Keep prior objects intact for rollback and already-issued downloads.
      const key = `${row.org_id}/usage-reporting-v1/${row.id}/${updated.checksum.slice(7)}.tar.gz`;
      await objects.archive(key, updated.archive);
      let publicChecksum = row.public_package_checksum;
      let publicSize = row.public_package_size_bytes;
      if (row.public_version_id === row.id) {
        const zip = await tarGzToZip(updated.archive);
        publicChecksum = `sha256:${createHash("sha256").update(zip).digest("hex")}`;
        publicSize = zip.length;
        await objects.publicSnapshot(row.org_id, publicChecksum, zip);
      }
      await tx`update skill_versions set checksum = ${updated.checksum}, storage_path = ${key},
        size_bytes = ${updated.sizeBytes}, body = ${updated.body}, usage_reporting_revision = 1
        where org_id = ${row.org_id} and skill_id = ${row.skill_id} and id = ${row.id}`;
      await tx`update skills set updated_at = now(), public_package_checksum = ${publicChecksum},
        public_package_size_bytes = ${publicSize} where org_id = ${row.org_id} and id = ${row.skill_id}`;
      await tx`delete from agent_transfer_tickets where org_id = ${row.org_id} and skill_version_id = ${row.id}`;
      await tx`insert into audit_log (org_id, actor_id, private_to_user_id, action, target_type, target_id, metadata)
        values (${row.org_id}, null, ${row.scope === "personal" ? row.creator_id : null},
          'skill.usage_reporting_rewrite', 'skill', ${row.skill_id}, ${JSON.stringify({
            versionId: row.id, version: row.version, previousChecksum: row.checksum,
            previousStoragePath: row.storage_path, previousSizeBytes: row.size_bytes,
            previousPublicChecksum: row.public_package_checksum, previousPublicSizeBytes: row.public_package_size_bytes,
            checksum: updated.checksum,
          })}::jsonb)`;
      if (row.scope === "org") {
        await tx`update github_sync_destinations set desired_revision = desired_revision + 1,
          status = case when status = 'syncing' then 'syncing'::github_sync_status else 'pending'::github_sync_status end,
          next_retry_at = null, updated_at = now() where org_id = ${row.org_id} and status <> 'disconnected'`;
      }
      return true;
    });
    if (!changed) return rewritten;
    rewritten += 1;
  }
}
