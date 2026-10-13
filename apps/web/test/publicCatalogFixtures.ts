import type { PublicCatalogSkill } from "@skillpack/contracts";

/** One listed skill exactly as the public catalog contract serializes it. */
export function catalogSkill(overrides: Partial<PublicCatalogSkill> = {}): PublicCatalogSkill {
  return {
    org_name: "Acme",
    org_slug: "acme",
    skill_slug: "release-helper",
    name: "Release helper",
    description: "Prepare a release.",
    version: "1.2.3",
    released_at: "2026-10-01T09:30:00.000Z",
    checksum: `sha256:${"a".repeat(64)}`,
    size_bytes: 2048,
    body: "# Release helper\n\nRun the checklist.",
    files: [{ path: "SKILL.md", size_bytes: 512 }],
    ...overrides,
  };
}
