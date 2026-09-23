import { existsSync } from "node:fs";
import { join } from "node:path";
import { packDir, resolvePin } from "@skillpack/skills";
import type { DriftState, LockedSkill, SkillListRow, SkillVersionRow } from "@skillpack/contracts";
import type { AuthedClient } from "./client";

export interface RegistryInfo {
  exists: boolean;
  id: string | null;
  currentVersion: string | null;
  versions: string[];
  checksums?: Record<string, string>;
  row?: SkillListRow;
}

export async function getRegistryInfo(client: AuthedClient, slug: string): Promise<RegistryInfo> {
  const row = await client.request<SkillListRow>(`/v1/skills/${slug}`).catch(() => null);
  if (!row) return { exists: false, id: null, currentVersion: null, versions: [] };
  const versions = await client.request<SkillVersionRow[]>(`/v1/skills/${slug}/versions`);
  return {
    exists: true,
    id: row.id,
    currentVersion: row.current_version,
    versions: versions.map((v) => v.version),
    checksums: Object.fromEntries(versions.map((v) => [v.version, v.checksum])),
    row,
  };
}

export async function localChecksum(dir: string): Promise<string | null> {
  if (!existsSync(join(dir, "SKILL.md"))) return null;
  try {
    const r = await packDir(dir);
    return r.checksum;
  } catch {
    return null;
  }
}

export function resolveTarget(pinned: string | null, reg: RegistryInfo): string | null {
  if (!reg.exists) return null;
  if (pinned && /^\d+\.\d+\.\d+/.test(pinned)) return pinned;
  if (!pinned) return reg.currentVersion;
  return resolvePin(pinned, reg.versions);
}

const isExactPin = (p: string | null): boolean => !!p && /^\d+\.\d+\.\d+/.test(p);

export function classify(
  locked: LockedSkill,
  local: string | null,
  reg: RegistryInfo,
  target: string | null,
): DriftState {
  if (!reg.exists) return "not-published";
  if (local === null) return "missing";
  const edited = local !== locked.checksum;
  const remoteChecksum = target ? reg.checksums?.[target] ?? (target === reg.currentVersion ? reg.row?.checksum : null) : null;
  const rewritten = !!remoteChecksum && target === locked.resolved && remoteChecksum !== locked.checksum;
  const advanced = target !== null && (target !== locked.resolved || rewritten);

  if (isExactPin(locked.pinned)) {
    if (edited && rewritten) return "conflict";
    if (edited) return "modified";
    if (rewritten) return "outdated";
    if (reg.currentVersion && reg.currentVersion !== locked.resolved) return "pinned";
    return "up-to-date";
  }
  if (edited && advanced) return "conflict";
  if (edited) return "modified";
  if (advanced) return "outdated";
  return "up-to-date";
}
