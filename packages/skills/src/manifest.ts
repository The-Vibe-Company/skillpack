import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import {
  skillpackDependencySlugs,
  skillpackManifestJson,
  skillpackManifestSchema,
  fallbackSkillpackManifest,
  toStoredSkillFrontmatter,
  type SkillpackManifest,
  type FrontmatterWarning,
  type SkillFrontmatter,
  type SkillLegacyFrontmatter,
} from "@skillpack/contracts";
import { withSkillUsageInstructions } from "./usageInstructions";
import { scanDir } from "./archive";
import { parseFrontmatter } from "./frontmatter";

export interface SkillpackManifestMetadata {
  skillId?: string;
  instanceUrl?: string;
  version: string;
}

export interface PreparedSkillDir {
  rootDir: string;
  frontmatter: SkillFrontmatter;
  skillpackManifest: SkillpackManifest;
  skillpackManifestPath: string;
  warnings: FrontmatterWarning[];
  legacy: SkillLegacyFrontmatter;
}

/**
 * Stable UUID for legacy declarations that predate explicit slot ids. This intentionally uses only
 * the immutable workspace skill id and the original env key: republishing the same declaration is
 * stable, while a rename without carrying the old slotId is treated as a new incompatible slot.
 */
export function deterministicSecretSlotId(skillId: string, envKey: string): string {
  const hex = createHash("md5").update(`${skillId}:secret:${envKey}`, "utf8").digest("hex").split("");
  hex[12] = "5";
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function withSecretSlotIds(environment: SkillpackManifest["environment"], skillId: string): SkillpackManifest["environment"] {
  return {
    env: environment.env,
    secrets: Object.fromEntries(
      Object.entries(environment.secrets).map(([key, declaration]) => [
        key,
        { ...declaration, slotId: declaration.slotId ?? deterministicSecretSlotId(skillId, key) },
      ]),
    ),
  };
}

export function withSkillpackMetadata(
  frontmatter: SkillFrontmatter,
  _companion: SkillpackManifestMetadata,
): SkillFrontmatter {
  const { companion_skill_id: _skillId, companion_version: _version, ...metadata } = frontmatter.metadata;
  return {
    ...frontmatter,
    metadata: Object.fromEntries(Object.entries(metadata).sort(([a], [b]) => a.localeCompare(b))),
  };
}

export function buildNormalizedSkillMd(frontmatter: SkillFrontmatter, body: string): string {
  const stored = toStoredSkillFrontmatter(frontmatter);
  const yaml = stringifyYaml(stored, { sortMapEntries: false }).trimEnd();
  return `---\n${yaml}\n---\n\n${body.trim()}\n`;
}

export function buildNormalizedSkillpackJson(manifest: SkillpackManifest): string {
  return `${JSON.stringify(skillpackManifestJson(manifest), null, 2)}\n`;
}

export function toStoredSkillVersionManifest(
  frontmatter: SkillFrontmatter,
  companion: SkillpackManifest,
): ReturnType<typeof toStoredSkillFrontmatter> & { companion: ReturnType<typeof skillpackManifestJson> } {
  return {
    ...toStoredSkillFrontmatter(frontmatter),
    companion: skillpackManifestJson(companion),
  };
}

function publishChangelogForVersion(manifest: SkillpackManifest, version: string): SkillpackManifest["metadata"]["changelog"] {
  if (manifest.metadata.changelog.some((entry) => entry.version === version)) return manifest.metadata.changelog;
  return [
    {
      version,
      date: new Date().toISOString().slice(0, 10),
      changes: [`Publish version ${version}.`],
    },
    ...manifest.metadata.changelog,
  ];
}

function parseSkillpackJson(raw: string | null, frontmatter: SkillFrontmatter): SkillpackManifest {
  if (raw === null) {
    return fallbackSkillpackManifest({
      summary: frontmatter.description,
      requirements: frontmatter.requirements,
      name: frontmatter.name,
      version: frontmatter.metadata.companion_version,
      companionSkillId: frontmatter.metadata.companion_skill_id,
    });
  }
  const parsed = skillpackManifestSchema.parse(JSON.parse(raw));
  return fallbackSkillpackManifest({
    summary: parsed.description ?? frontmatter.description,
    name: parsed.name ?? frontmatter.name,
    version: parsed.version ?? frontmatter.metadata.companion_version,
    icon: parsed.icon,
    companionSkillId: parsed.metadata.companionSkillId ?? frontmatter.metadata.companion_skill_id,
    display: parsed.display,
    requirements: parsed.requirements,
    dependencies: parsed.legacyDependencySlugs.length ? skillpackDependencySlugs(parsed) : parsed.dependencies,
    environment: parsed.environment,
    database: parsed.database,
    changelog: parsed.metadata.changelog,
    commands: parsed.commands,
    checks: parsed.checks,
    notes: parsed.notes,
  });
}

function resolvePackageRoot(dir: string, skillName: string, skillMdPath: string | null, files: string[]): string {
  if (skillMdPath === "SKILL.md") return dir;
  const wrapper = `${skillName}/`;
  if (skillMdPath === `${wrapper}SKILL.md` && files.length > 0 && files.every((file) => file.startsWith(wrapper))) {
    return join(dir, skillName);
  }
  throw new Error(`unexpected SKILL.md location: ${skillMdPath ?? "(missing)"}`);
}

export async function prepareSkillDirForPublish(
  dir: string,
  companion: SkillpackManifestMetadata,
): Promise<PreparedSkillDir> {
  const scan = await scanDir(dir);
  if (!scan.skillMd) throw new Error("SKILL.md not found in package");
  const parsed = parseFrontmatter(scan.skillMd);
  if (!parsed.ok) throw new Error(parsed.error);
  const rootDir = resolvePackageRoot(
    dir,
    parsed.data.name,
    scan.skillMdPath,
    scan.files.map((file) => file.relPath),
  );
  const skillMdPath = join(rootDir, "SKILL.md");
  const current = await readFile(skillMdPath, "utf8");
  const reparsed = parseFrontmatter(current);
  if (!reparsed.ok) throw new Error(reparsed.error);
  const frontmatter = withSkillpackMetadata(reparsed.data, companion);
  const skillpackPath = join(rootDir, "companion.json");
  const rawSkillpackJson = await readFile(skillpackPath, "utf8").catch(() => null);
  const existingManifest = parseSkillpackJson(rawSkillpackJson, frontmatter);
  const normalizedManifest = fallbackSkillpackManifest({
    summary: existingManifest.description ?? frontmatter.description,
    name: frontmatter.name,
    version: companion.version,
    icon: existingManifest.icon,
    companionSkillId: companion.skillId,
    display: existingManifest.display,
    requirements: existingManifest.requirements,
    dependencies: existingManifest.legacyDependencySlugs.length ? skillpackDependencySlugs(existingManifest) : existingManifest.dependencies,
    environment: existingManifest.environment,
    database: existingManifest.database,
    changelog: publishChangelogForVersion(existingManifest, companion.version),
    commands: existingManifest.commands,
    checks: existingManifest.checks,
    notes: existingManifest.notes,
  });
  const skillpackManifest = fallbackSkillpackManifest({
    summary: normalizedManifest.description ?? frontmatter.description,
    name: normalizedManifest.name,
    version: normalizedManifest.version,
    icon: normalizedManifest.icon,
    companionSkillId: normalizedManifest.metadata.companionSkillId,
    display: normalizedManifest.display,
    environment: withSecretSlotIds(normalizedManifest.environment, companion.skillId ?? frontmatter.name),
    database: normalizedManifest.database,
    dependencies: normalizedManifest.dependencies,
    changelog: normalizedManifest.metadata.changelog,
    commands: normalizedManifest.commands,
    checks: normalizedManifest.checks,
    notes: normalizedManifest.notes,
  });
  await writeFile(skillpackPath, buildNormalizedSkillpackJson(skillpackManifest), "utf8");
  await writeFile(skillMdPath, buildNormalizedSkillMd(frontmatter, companion.skillId && companion.instanceUrl
    ? withSkillUsageInstructions(reparsed.body, { skillId: companion.skillId, version: companion.version, instanceUrl: companion.instanceUrl })
    : reparsed.body), "utf8");
  return {
    rootDir,
    frontmatter,
    skillpackManifest,
    skillpackManifestPath: skillpackPath,
    warnings: reparsed.warnings,
    legacy: reparsed.legacy,
  };
}
