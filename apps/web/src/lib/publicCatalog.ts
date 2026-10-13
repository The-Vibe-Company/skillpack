import {
  publicCatalogPathSchema,
  publicCatalogSkillSchema,
  type PublicCatalogSkill,
} from "@skillpack/contracts";

export type { PublicCatalogSkill };

/** The anonymous catalog lives under its own prefix; `/skills` is the signed-in library. */
export const CATALOG_PATH = "/catalog";

export function isPublicCatalogEnabled(): boolean {
  return process.env.SKILLPACK_PUBLIC_CATALOG === "true";
}

export function catalogSkillPath(orgSlug: string, skillSlug: string): string {
  return `${CATALOG_PATH}/${encodeURIComponent(orgSlug)}/${encodeURIComponent(skillSlug)}`;
}

/** Anonymous API path for one listed skill; 404 means unlisted, archived, missing, or disabled. */
export function publicCatalogSkillApiPath(orgSlug: string, skillSlug: string): string {
  return `/v1/public/catalog/skills/${encodeURIComponent(orgSlug)}/${encodeURIComponent(skillSlug)}`;
}

/** Anonymous API path for a report about one listed skill. */
export function publicCatalogReportApiPath(orgSlug: string, skillSlug: string): string {
  return `${publicCatalogSkillApiPath(orgSlug, skillSlug)}/reports`;
}

/**
 * Real native CLI commands. The catalog never exposes a share token, so installation is by slug
 * in the signed-in workspace instead of through a public share-link flow.
 */
export function catalogInstallCommands(input: { siteUrl: URL; skillSlug: string; version: string }): string {
  return [
    `skillpack auth login --api-url ${new URL("/v1", input.siteUrl).href}`,
    `skillpack install ${input.skillSlug} --version ${input.version}`,
  ].join("\n");
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

/** One listed skill, or null when it is not listed (or the slugs could never match one). */
export async function fetchPublicCatalogSkill(orgSlug: string, skillSlug: string): Promise<PublicCatalogSkill | null> {
  if (!publicCatalogPathSchema.safeParse({ orgSlug, skillSlug }).success) return null;
  const response = await fetchCatalogJson(publicCatalogSkillApiPath(orgSlug, skillSlug));
  if (!response) return null;
  return publicCatalogSkillSchema.parse(await response.json());
}

/** Licenses the catalog accepts, as SPDX identifiers. */
export const CATALOG_LICENSES = ["MIT", "Apache-2.0"] as const;

/** Whether a declared SKILL.md license is one the catalog accepts. Null means none declared. */
export function isCatalogLicense(license: string | null): boolean {
  const declared = license?.trim().toLowerCase();
  return CATALOG_LICENSES.some((accepted) => accepted.toLowerCase() === declared);
}
