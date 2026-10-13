import {
  publicCatalogListSchema,
  publicCatalogPathSchema,
  publicCatalogSkillSchema,
  type PublicCatalogSkill,
} from "@skillpack/contracts";

export type { PublicCatalogSkill };

/**
 * `/skills` is the authenticated library, so the anonymous catalog lives under its own prefix.
 * Paths reuse the existing organization and skill slugs, exactly as the catalog API does.
 */
export const CATALOG_PATH = "/catalog";
export const CATALOG_PAGE_SIZE = 20;

/** The catalog API rejects offsets above this bound (`publicCatalogQuerySchema`). */
const CATALOG_MAX_OFFSET = 10_000;
/** The catalog API's largest page (`publicCatalogQuerySchema`). */
const CATALOG_MAX_LIMIT = 50;

/**
 * Same default-off flag as the API. The web reads it server-side so a deployment that leaves it
 * unset never renders catalog pages or publishing controls, even when its API flag differs.
 */
export function isPublicCatalogEnabled(): boolean {
  return process.env.SKILLPACK_PUBLIC_CATALOG === "true";
}

export function catalogSkillPath(orgSlug: string, skillSlug: string): string {
  return `${CATALOG_PATH}/${encodeURIComponent(orgSlug)}/${encodeURIComponent(skillSlug)}`;
}

export function catalogIndexPath(page: number): string {
  return page <= 1 ? CATALOG_PATH : `${CATALOG_PATH}?page=${page}`;
}

/** Anonymous API path for one listed skill; 404 means unlisted, archived, missing, or disabled. */
export function publicCatalogSkillApiPath(orgSlug: string, skillSlug: string): string {
  return `/v1/public/catalog/skills/${encodeURIComponent(orgSlug)}/${encodeURIComponent(skillSlug)}`;
}

/** Licenses the catalog accepts, as SPDX identifiers. */
export const CATALOG_LICENSES = ["MIT", "Apache-2.0"] as const;

/** Whether a declared SKILL.md license is one the catalog accepts. Null means none declared. */
export function isCatalogLicense(license: string | null): boolean {
  const declared = license?.trim().toLowerCase();
  return CATALOG_LICENSES.some((accepted) => accepted.toLowerCase() === declared);
}

/**
 * Real native CLI commands (runtime/internal/cli/commands.go). The catalog never exposes a share
 * token, so `install --public` is not offered; installing by slug resolves in the signed-in
 * workspace, which is only the listing workspace for someone with access there.
 */
export function catalogInstallCommands(input: { siteUrl: URL; skillSlug: string; version: string }): string {
  return [
    `skillpack auth login --api-url ${new URL("/v1", input.siteUrl).href}`,
    `skillpack install ${input.skillSlug} --version ${input.version}`,
  ].join("\n");
}

/** `?page=` as a 1-based page within the API offset bound, or null for anything else. */
export function parseCatalogPage(value: string | string[] | undefined): number | null {
  if (value === undefined) return 1;
  if (Array.isArray(value) || !/^[1-9]\d{0,5}$/.test(value)) return null;
  const page = Number(value);
  return (page - 1) * CATALOG_PAGE_SIZE <= CATALOG_MAX_OFFSET ? page : null;
}

function apiBaseUrl(): string {
  return process.env.COMPANION_API_URL ?? "http://127.0.0.1:3001";
}

/** Anonymous by construction: no cookies or credentials are forwarded to the catalog API. */
async function fetchCatalogJson(path: string): Promise<Response | null> {
  const response = await fetch(`${apiBaseUrl()}${path}`, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Public catalog request failed: ${response.status}`);
  return response;
}

async function fetchCatalogRows(limit: number, offset: number): Promise<PublicCatalogSkill[] | null> {
  const response = await fetchCatalogJson(`/v1/public/catalog/skills?limit=${limit}&offset=${offset}`);
  if (!response) return null;
  return publicCatalogListSchema.parse(await response.json()).skills;
}

export interface PublicCatalogPage {
  skills: PublicCatalogSkill[];
  hasNextPage: boolean;
}

/**
 * One index page, or null when the API reports the catalog disabled. One extra row is requested so
 * a "Next" link never leads to the empty page the API may return after a full final page.
 */
export async function fetchPublicCatalogPage(page: number): Promise<PublicCatalogPage | null> {
  const offset = (page - 1) * CATALOG_PAGE_SIZE;
  const rows = await fetchCatalogRows(CATALOG_PAGE_SIZE + 1, offset);
  if (!rows) return null;
  return {
    skills: rows.slice(0, CATALOG_PAGE_SIZE),
    hasNextPage: rows.length > CATALOG_PAGE_SIZE && offset + CATALOG_PAGE_SIZE <= CATALOG_MAX_OFFSET,
  };
}

/** One listed skill, or null when it is not listed (or the slugs could never match one). */
export async function fetchPublicCatalogSkill(orgSlug: string, skillSlug: string): Promise<PublicCatalogSkill | null> {
  if (!publicCatalogPathSchema.safeParse({ orgSlug, skillSlug }).success) return null;
  const response = await fetchCatalogJson(publicCatalogSkillApiPath(orgSlug, skillSlug));
  if (!response) return null;
  return publicCatalogSkillSchema.parse(await response.json());
}

/**
 * Every listed skill reachable within the API offset bound (for the sitemap), or null when
 * disabled. The anonymous API serves only validated, listed organization skills.
 */
export async function listAllPublicCatalogSkills(): Promise<PublicCatalogSkill[] | null> {
  const skills: PublicCatalogSkill[] = [];
  for (let offset = 0; offset <= CATALOG_MAX_OFFSET; offset += CATALOG_MAX_LIMIT) {
    const rows = await fetchCatalogRows(CATALOG_MAX_LIMIT, offset);
    if (!rows) return null;
    skills.push(...rows);
    if (rows.length < CATALOG_MAX_LIMIT) break;
  }
  return skills;
}
