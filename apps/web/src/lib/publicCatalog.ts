/**
 * Same default-off flag as the API. The web reads it server-side so a deployment that leaves it
 * unset never renders catalog publishing controls, even when its API flag differs.
 */
export function isPublicCatalogEnabled(): boolean {
  return process.env.SKILLPACK_PUBLIC_CATALOG === "true";
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
