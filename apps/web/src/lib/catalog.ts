import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { EXCLUDE_PATTERNS, parseFrontmatter, SKILL_FILE, stripSkillUsageInstructions } from "@skillpack/skills";
import { z } from "zod";

export const CATALOG_REPO_URL = "https://github.com/The-Vibe-Company/skillpack";

/** `next build`, `next dev` and the web tests all run from apps/web. */
export const CATALOG_REPO_ROOT = join(process.cwd(), "..", "..");

/**
 * - `management`: the CLI installs the signed-in instance's bundled management skill with
 *   `skillpack install skillpack` (runtime/internal/cli/install.go special-cases that slug).
 * - `source`: no verified install command; the page points to the source folder instead.
 */
export type CatalogInstall = "management" | "source";
export type CatalogSource = { dir: string; install: CatalogInstall };

/**
 * Official skills in the public catalog, read from this repository at build time. Add or remove
 * an entry here. `dir` is relative to the repository root, and deploy/railway/Dockerfile.web must
 * copy it into the web build (catalog.test.ts checks that).
 */
export const CATALOG_SOURCES: readonly CatalogSource[] = [
  { dir: "packages/skillpack-skill/skill", install: "management" },
  { dir: "examples/skills/incident-summary", install: "source" },
];

/** The runtime release the bundled management skill pins; its installers ship with that release. */
const RUNTIME_RELEASE_FILE = "packages/skillpack-skill/skill/runtime-release.json";

export type CatalogSkill = {
  /** The frontmatter `name`, which is also the URL segment. */
  slug: string;
  description: string;
  license?: string;
  compatibility?: string;
  allowedTools?: string;
  /** SKILL.md body without frontmatter or a generated `skillpack:usage` block. */
  body: string;
  /** Every package file, as sorted POSIX paths relative to the skill folder. */
  files: string[];
  install: CatalogInstall;
  sourceUrl: string;
};

/** Parses one source. Throws with the folder so a broken skill fails the build, not a page view. */
export function loadCatalogSkill(source: CatalogSource, repoRoot: string = CATALOG_REPO_ROOT): CatalogSkill {
  const folder = join(repoRoot, source.dir);
  const parsed = parseFrontmatter(readFileSync(join(folder, SKILL_FILE), "utf8"));
  if (!parsed.ok) throw new Error(`${source.dir}: ${parsed.error}`);
  const { data } = parsed;
  if (source.install === "management" && data.name !== "skillpack") {
    throw new Error(`${source.dir}: only the "skillpack" management skill installs with the management command`);
  }
  return {
    slug: data.name,
    description: data.description,
    license: data.license,
    compatibility: data.compatibility,
    allowedTools: data.allowedToolsRaw,
    body: stripSkillUsageInstructions(parsed.body),
    files: listPackageFiles(folder),
    install: source.install,
    sourceUrl: `${CATALOG_REPO_URL}/tree/main/${source.dir}`,
  };
}

function listPackageFiles(folder: string): string[] {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(folder, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .filter((path) => !EXCLUDE_PATTERNS.some((pattern) => pattern.test(path)))
    .sort();
}

/** Every catalog skill in source order. Duplicate slugs fail the build. */
export function loadCatalogSkills(
  sources: readonly CatalogSource[] = CATALOG_SOURCES,
  repoRoot: string = CATALOG_REPO_ROOT,
): CatalogSkill[] {
  const skills = sources.map((source) => loadCatalogSkill(source, repoRoot));
  const seen = new Set<string>();
  for (const skill of skills) {
    if (seen.has(skill.slug)) throw new Error(`catalog: duplicate skill "${skill.slug}"`);
    seen.add(skill.slug);
  }
  return skills;
}

export function findCatalogSkill(slug: string): CatalogSkill | undefined {
  return loadCatalogSkills().find((skill) => skill.slug === slug);
}

export function catalogSkillPath(slug: string): string {
  return `/catalog/${slug}`;
}

const runtimeReleaseSchema = z.object({ version: z.string().regex(/^\d+\.\d+\.\d+$/) });

export type RuntimeRelease = { version: string; url: string };

/** The GitHub release page for the runtime version the management skill pins. */
export function runtimeRelease(repoRoot: string = CATALOG_REPO_ROOT): RuntimeRelease {
  const parsed = runtimeReleaseSchema.safeParse(JSON.parse(readFileSync(join(repoRoot, RUNTIME_RELEASE_FILE), "utf8")));
  if (!parsed.success) throw new Error(`${RUNTIME_RELEASE_FILE}: invalid runtime version`);
  const { version } = parsed.data;
  return { version, url: `${CATALOG_REPO_URL}/releases/tag/runtime-v${version}` };
}
