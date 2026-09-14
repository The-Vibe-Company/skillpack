import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `@skillpack/skillpack-skill` — the built-in "Skillpack" management skill.
 *
 * The packable skill source lives in `skill/`. Its `companion.json` is the source of truth for
 * version, user-facing copy, commands, changelog, and setup declarations.
 */

export const SKILLPACK_SKILL_KEY = "skillpack";
// Keep existing per-member installation records under their original database key.
export const SKILLPACK_INSTALL_KEY = "companion";
export function isSkillpackSkillKey(key: string): boolean {
  return key === SKILLPACK_SKILL_KEY || key === SKILLPACK_INSTALL_KEY;
}

export interface SkillpackSkillCommand {
  name: string;
  desc: string;
}

export interface SkillpackSkillChangelogEntry {
  version: string;
  date?: string;
  changes: string[];
}

export interface SkillpackSkillManifest {
  key: string;
  name: string;
  version: string;
  description: string;
  notes: string;
  commands: SkillpackSkillCommand[];
  changelog: SkillpackSkillChangelogEntry[];
}

interface RawSkillpackJson {
  name?: string;
  version?: string;
  title?: string;
  description?: string;
  notes?: string;
  metadata?: {
    changelog?: SkillpackSkillChangelogEntry[];
  };
  commands?: SkillpackSkillCommand[];
}

function loadSkillpackSkillManifest(): SkillpackSkillManifest {
  // SAFETY: the bundled manifest is a repository-owned package with the declared metadata shape.
  const raw = JSON.parse(readFileSync(join(skillpackSkillDir(), "companion.json"), "utf8")) as RawSkillpackJson;
  const key = raw.name ?? SKILLPACK_SKILL_KEY;
  const version = raw.version;
  if (!version) throw new Error("bundled companion skill is missing companion.json version");
  return {
    key,
    name: raw.title ?? "Skillpack",
    version,
    description: raw.description ?? "Manage local SKILL.md packages with Skillpack.",
    notes: raw.notes ?? "",
    commands: raw.commands ?? [],
    changelog: raw.metadata?.changelog ?? [],
  };
}

export const COMPANION_SKILL_MANIFEST: SkillpackSkillManifest = loadSkillpackSkillManifest();

/** Free-form changelog lookup; empty array when the version is unknown. */
export function skillpackSkillChanges(version: string): string[] {
  return COMPANION_SKILL_MANIFEST.changelog.find((entry) => entry.version === version)?.changes ?? [];
}

/**
 * Absolute path to the packable `skill/` directory. Resolves for `tsx` dev runs and tests (via the
 * package source), for bundled production builds (the dir is copied next to the bundle as
 * `companion-skill/`), and for a repo-root cwd. Override with `COMPANION_SKILL_DIR`.
 */
export function skillpackSkillDir(): string {
  const candidates = [
    process.env.COMPANION_SKILL_DIR,
    fileURLToPath(new URL("../skill", import.meta.url)),
    fileURLToPath(new URL("./companion-skill", import.meta.url)),
    resolve(process.cwd(), "packages/skillpack-skill/skill"),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0]!;
}
