import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  assertCanPublishSkillVersion,
  buildDependencyPlan,
  DependencyPublishError,
  getSkillById,
  getSkillBySlug,
  listSkillVersions,
  prepareSkillPublishDependencies,
  publishSkillVersion,
  type ActorContext,
} from "@skillpack/core/services";
import {
  publishSkillInputSchema,
  skillFrontmatterSchema,
  type DependencyPlan,
  type FrontmatterWarning,
  type SkillFrontmatter,
  type SkillScope,
  type SkillpackManifest,
  type ValidationResult,
} from "@skillpack/contracts";
import { deleteSkillArchive, putSkillArchive, skillArchiveKey } from "@skillpack/storage";
import {
  buildNormalizedSkillMd,
  buildNormalizedSkillpackJson,
  bumpSemver,
  compareSemver,
  isValidSemver,
  packDir,
  prepareSkillDirForPublish,
  toStoredSkillVersionManifest,
  unpackAnyTo,
  validateSkillArchive,
} from "@skillpack/skills";
import { withTenantContext } from "@skillpack/db";
import { assertNoSkillpackRetarget, assertTargetedSkillUpdate } from "./skillPublishGuards";
import { uploadDependencyValues, withResolvedManifestDependencies } from "./skillSkillpackManifest";
import { captureServerError } from "./sentry";

/** A canonical, re-packed skill archive plus the metadata read back out of it. */
export interface CanonicalSkillArchive {
  canonical: Awaited<ReturnType<typeof packDir>>;
  frontmatter: SkillFrontmatter;
  skillpackManifest: SkillpackManifest;
}

export async function canonicalizeSkillArchive(
  archive: Buffer,
  companion: { skillId: string; version: string },
  overrides: { dependencies?: string[] | Record<string, string> } = {},
): Promise<CanonicalSkillArchive> {
  const dir = await mkdtemp(join(tmpdir(), "companion-skill-"));
  try {
    await unpackAnyTo(archive, dir);
    const prepared = await prepareSkillDirForPublish(dir, companion);
    const skillpackManifest = overrides.dependencies
      ? withResolvedManifestDependencies(prepared.skillpackManifest, overrides.dependencies)
      : prepared.skillpackManifest;
    if (overrides.dependencies) {
      await writeFile(prepared.skillpackManifestPath, buildNormalizedSkillpackJson(skillpackManifest), "utf8");
    }
    const canonical = await packDir(prepared.rootDir);
    return { canonical, frontmatter: prepared.frontmatter, skillpackManifest };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Assemble a standard SKILL.md from inline fields. The registry sets the version, not the author. */
export function buildSkillMd(
  id: string,
  description: string,
  body: string,
  _companion: { skillId: string; version: string },
): string {
  const frontmatter = skillFrontmatterSchema.parse({
    name: id,
    description,
    metadata: {},
  });
  return buildNormalizedSkillMd(frontmatter, body);
}

export function skillSummary(fm: SkillFrontmatter, manifest: SkillpackManifest): string {
  return manifest.display.summary ?? fm.description;
}

export async function resolvePublishTarget(input: {
  actor: ActorContext;
  orgId: string;
  slug: string;
  explicitVersion?: string;
  metadataVersion?: string;
  metadataSkillId?: string;
  legacyVersion?: string;
}): Promise<{ skillId: string; version: string }> {
  return withTenantContext({ orgId: input.orgId, userId: input.actor.id }, async (database) => {
    const existing = await getSkillBySlug({ actor: input.actor, orgId: input.orgId, slug: input.slug, database });
    const metadataIsPublishedProvenance = Boolean(existing && input.metadataSkillId);
    const candidate =
      input.explicitVersion ??
      (metadataIsPublishedProvenance ? undefined : input.metadataVersion) ??
      input.legacyVersion;
    if (candidate) {
      if (!isValidSemver(candidate)) throw new Error(`invalid semver: ${candidate}`);
      return { skillId: existing?.id ?? randomUUID(), version: candidate };
    }
    if (!existing) return { skillId: randomUUID(), version: "1.0.0" };
    const versions = await listSkillVersions({ actor: input.actor, orgId: input.orgId, slug: input.slug, database });
    const latest = versions.map((v) => v.version).sort((a, b) => compareSemver(b, a))[0];
    return { skillId: existing.id, version: latest ? bumpSemver(latest, "patch") : "1.0.0" };
  });
}

export class TransferTicketAuthorizationChangedError extends Error {}

export interface PublishedSkillVersion {
  id: string;
  slug: string;
  version: string;
  checksum: string;
  sizeBytes: number;
}

/**
 * Shared publish tail: store the canonical archive (idempotently) and write a new
 * skill_versions row, authorizing first and cleaning up the blob on failure.
 */
export async function publishCanonical(input: {
  actor: ActorContext;
  orgId: string;
  canonical: Awaited<ReturnType<typeof packDir>>;
  fm: SkillFrontmatter;
  skillpackManifest: SkillpackManifest;
  skillId: string;
  /** Library to publish into on first create: 'personal' (My Skills) or 'org' (default). */
  scope?: SkillScope;
  /** Label paths to file the skill under on create (personal folders for 'personal', else org). */
  labels?: string[];
  version: string;
  note: string;
  /** SKILL.md markdown body — persisted server-side to power full-text content search. */
  body: string;
  dependencies?: Awaited<ReturnType<typeof prepareSkillPublishDependencies>>;
  /** Runs after external storage work and immediately before the tenant mutation. */
  beforeCommit?: () => Promise<boolean>;
}): Promise<PublishedSkillVersion> {
  const { actor, orgId, canonical, fm, skillpackManifest, skillId, scope, labels, version, note, body, dependencies } =
    input;
  if (!isValidSemver(version)) throw new Error(`invalid semver: ${version}`);
  const key = skillArchiveKey({ orgId, slug: fm.name, version });
  const payload = publishSkillInputSchema.parse({
    skill_id: skillId,
    slug: fm.name,
    scope,
    labels: labels ?? [],
    version,
    description: skillSummary(fm, skillpackManifest),
    checksum: canonical.checksum,
    storage_path: key,
    size_bytes: canonical.sizeBytes,
    frontmatter: JSON.stringify(toStoredSkillVersionManifest(fm, skillpackManifest), null, 2),
    body,
    tools: fm.allowedTools,
    license: fm.license ?? null,
    note,
    dependencies: dependencies?.slugs ?? [],
  });
  await withTenantContext({ orgId, userId: actor.id }, (database) =>
    assertCanPublishSkillVersion({ actor, orgId, payload, database }),
  );
  await putSkillArchive({ key, body: canonical.archive, preventOverwrite: true });
  try {
    if (input.beforeCommit && !await input.beforeCommit()) {
      throw new TransferTicketAuthorizationChangedError(
        "transfer ticket authorization changed before publication",
      );
    }
    const published = await withTenantContext({ orgId, userId: actor.id }, (database) =>
      publishSkillVersion({ actor, orgId, payload, archiveKey: key, dependencies, database }),
    );
    return { ...published, slug: fm.name, checksum: canonical.checksum, sizeBytes: canonical.sizeBytes };
  } catch (error) {
    await deleteSkillArchive({ key }).catch((cleanupError) => {
      captureServerError(cleanupError, {
        operation: "skill.archive.cleanup",
        level: "warning",
        retryable: true,
      });
      console.error(`failed to delete orphaned skill archive ${key}`, cleanupError);
    });
    throw error;
  }
}

/** One authored file in an MCP publish request. Paths are package-relative POSIX paths. */
export interface SkillPublishFile {
  path: string;
  content: string;
}

export type SkillVersionBump = "major" | "minor" | "patch";

export interface SkillPublishRequest {
  actor: ActorContext;
  orgId: string;
  slug: string;
  files: readonly SkillPublishFile[];
  /** Exact version to publish. Mutually exclusive with `bump`. */
  version?: string;
  /** Increment from the latest published version instead of naming one. */
  bump?: SkillVersionBump;
  message?: string;
  /** Library for a brand-new skill; ignored when the slug already exists. */
  scope?: SkillScope;
  labels?: readonly string[];
  /** Binds the publish to an exact existing skill id, as `expect_skill_id` does over REST. */
  expectSkillId?: string;
  /** Validate and plan only: nothing is stored and no version row is written. */
  dryRun?: boolean;
}

export interface SkillPublishOutcome {
  ok: boolean;
  dry_run: boolean;
  slug: string;
  validation: ValidationResult;
  dependency_plan: DependencyPlan | null;
  published: PublishedSkillVersion | null;
  warnings: FrontmatterWarning[];
  error: string | null;
}

/** Total authored bytes accepted in one publish. Well under the MCP route's request cap. */
const MAX_PUBLISH_CONTENT_BYTES = 8 * 1024 * 1024;
const MAX_PUBLISH_FILES = 500;
/**
 * Reject control characters in a caller-supplied path. They never belong in a package entry, and
 * they are what a terminal-escape or log-injection payload would hide behind.
 */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}
const WINDOWS_DRIVE_PREFIX = /^[a-zA-Z]:/;

export class SkillPublishInputError extends Error {}

function assertPublishablePath(path: string): string {
  const normalized = path.replace(/\\/g, "/").trim();
  if (!normalized) throw new SkillPublishInputError("every file needs a path");
  if (normalized.startsWith("/") || WINDOWS_DRIVE_PREFIX.test(normalized)) {
    throw new SkillPublishInputError(`file path must be relative: ${path}`);
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new SkillPublishInputError(`file path must not contain empty or relative segments: ${path}`);
  }
  if (hasControlCharacter(normalized)) {
    throw new SkillPublishInputError(`file path must not contain control characters: ${path}`);
  }
  return normalized;
}

async function packAuthoredFiles(files: readonly SkillPublishFile[]): Promise<Buffer> {
  if (files.length === 0) throw new SkillPublishInputError("at least one file is required");
  if (files.length > MAX_PUBLISH_FILES) {
    throw new SkillPublishInputError(`a skill package may contain at most ${MAX_PUBLISH_FILES} files`);
  }
  const seen = new Set<string>();
  let totalBytes = 0;
  const normalized = files.map((file) => {
    const path = assertPublishablePath(file.path);
    if (seen.has(path)) throw new SkillPublishInputError(`duplicate file path: ${path}`);
    seen.add(path);
    totalBytes += Buffer.byteLength(file.content, "utf8");
    return { path, content: file.content };
  });
  if (totalBytes > MAX_PUBLISH_CONTENT_BYTES) {
    throw new SkillPublishInputError("the authored files exceed the 8 MB publish limit");
  }
  const dir = await mkdtemp(join(tmpdir(), "companion-mcp-publish-"));
  try {
    for (const file of normalized) {
      const target = join(dir, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content, "utf8");
    }
    const packed = await packDir(dir);
    return packed.archive;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function bumpedVersion(latest: string | undefined, bump: SkillVersionBump | undefined): string | undefined {
  if (!bump) return undefined;
  return latest ? bumpSemver(latest, bump) : "1.0.0";
}

/**
 * Publish a skill from authored file contents rather than an uploaded archive.
 *
 * This is the MCP entry point into the same pipeline the REST upload route runs: validate, refuse to
 * retarget an existing skill, resolve declared dependencies, canonicalize, re-validate, then write
 * the version. The caller names the skill, so the package's own `SKILL.md` name must agree with it —
 * that agreement is the targeting declaration `expect_slug` makes over REST.
 */
export async function publishSkillFromFiles(request: SkillPublishRequest): Promise<SkillPublishOutcome> {
  const { actor, orgId, slug } = request;
  const dryRun = request.dryRun ?? false;
  const failed = (validation: ValidationResult, error: string): SkillPublishOutcome => ({
    ok: false,
    dry_run: dryRun,
    slug,
    validation,
    dependency_plan: null,
    published: null,
    warnings: validation.warnings ?? [],
    error,
  });

  if (request.version && request.bump) {
    throw new SkillPublishInputError("pass either version or bump, not both");
  }
  const archive = await packAuthoredFiles(request.files);
  const validation = await validateSkillArchive(archive);
  if (!validation.ok || !validation.frontmatter) {
    return failed(validation, validation.error ?? "validation failed");
  }
  const fm = validation.frontmatter;
  if (fm.name !== slug) {
    return failed(validation, `SKILL.md declares "${fm.name}" but this publish targets "${slug}"`);
  }

  const declaredSkillpackId =
    validation.companion_manifest?.metadata.companionSkillId ?? fm.metadata.companion_skill_id ?? undefined;
  const { slugSkill, skillpackIdSkill } = await withTenantContext(
    { orgId, userId: actor.id },
    async (database) => ({
      slugSkill: await getSkillBySlug({ actor, orgId, slug, database }),
      skillpackIdSkill: declaredSkillpackId
        ? await getSkillById({ actor, orgId, id: declaredSkillpackId, database })
        : null,
    }),
  );
  try {
    assertNoSkillpackRetarget({
      frontmatter: fm,
      companionSkillId: declaredSkillpackId,
      lookup: { slugSkill, skillpackIdSkill },
    });
    if (slugSkill) {
      assertTargetedSkillUpdate({
        frontmatter: fm,
        companionSkillId: declaredSkillpackId,
        expectSlug: slug,
        expectSkillId: request.expectSkillId ?? slugSkill.id,
        expectedSkill: slugSkill,
      });
    } else if (request.expectSkillId) {
      return failed(validation, `skill "${slug}" was not found for targeted update`);
    }
  } catch (error) {
    return failed(validation, error instanceof Error ? error.message : String(error));
  }

  const declaredDependencies = uploadDependencyValues({
    queryDependencies: [],
    skillpackManifestPath: validation.companion_manifest_path,
    skillpackManifest: validation.companion_manifest,
  });
  let preparedDependencies: Awaited<ReturnType<typeof prepareSkillPublishDependencies>>;
  try {
    preparedDependencies = await withTenantContext({ orgId, userId: actor.id }, (database) =>
      prepareSkillPublishDependencies({
        actor,
        orgId,
        slugs: declaredDependencies,
        manifest: validation.companion_manifest,
        database,
      }),
    );
  } catch (error) {
    return failed(validation, error instanceof Error ? error.message : String(error));
  }

  const dependencyPlan = await withTenantContext({ orgId, userId: actor.id }, (database) =>
    buildDependencyPlan({ actor, orgId, slug, declaredSlugs: preparedDependencies.slugs, database }),
  );

  const versions = slugSkill
    ? await withTenantContext({ orgId, userId: actor.id }, (database) =>
        listSkillVersions({ actor, orgId, slug, database }),
      )
    : [];
  const latest = versions.map((entry) => entry.version).sort((a, b) => compareSemver(b, a))[0];
  const target = await resolvePublishTarget({
    actor,
    orgId,
    slug,
    explicitVersion: request.version ?? bumpedVersion(latest, request.bump),
    metadataVersion: validation.companion_manifest?.version ?? fm.metadata.companion_version,
    metadataSkillId: declaredSkillpackId,
  });

  if (dryRun) {
    return {
      ok: true,
      dry_run: true,
      slug,
      validation,
      dependency_plan: dependencyPlan,
      published: null,
      warnings: validation.warnings ?? [],
      error: null,
    };
  }

  const normalized = await canonicalizeSkillArchive(
    archive,
    { skillId: target.skillId, version: target.version },
    { dependencies: preparedDependencies.manifestDependencies },
  );
  const normalizedValidation = await validateSkillArchive(normalized.canonical.archive);
  if (!normalizedValidation.ok || !normalizedValidation.frontmatter) {
    return failed(normalizedValidation, normalizedValidation.error ?? "validation failed after normalization");
  }
  try {
    const published = await publishCanonical({
      actor,
      orgId,
      canonical: normalized.canonical,
      fm: normalized.frontmatter,
      skillpackManifest: normalized.skillpackManifest,
      skillId: target.skillId,
      scope: request.scope,
      labels: [...(request.labels ?? [])],
      version: target.version,
      note: request.message ?? "",
      body: normalizedValidation.body ?? "",
      dependencies: preparedDependencies,
    });
    return {
      ok: true,
      dry_run: false,
      slug: published.slug,
      validation: normalizedValidation,
      dependency_plan: dependencyPlan,
      published,
      warnings: validation.warnings ?? [],
      error: null,
    };
  } catch (error) {
    if (error instanceof DependencyPublishError) {
      return {
        ok: false,
        dry_run: false,
        slug,
        validation: normalizedValidation,
        dependency_plan: error.plan,
        published: null,
        warnings: validation.warnings ?? [],
        error: error.message,
      };
    }
    throw error;
  }
}
