import { describe, expect, it } from "vitest";
import { publicCatalogSkillSchema, setSkillPublicListingInputSchema } from "../src/publicCatalog";

describe("catalog privacy contract", () => {
  it("projects only released presentation content, including nested file entries", () => {
    const parsed = publicCatalogSkillSchema.parse({
      org_name: "Example", org_slug: "example", skill_slug: "release", name: "release",
      description: "Instructions", version: "1.0.0", released_at: "2026-10-13T00:00:00Z",
      checksum: `sha256:${"a".repeat(64)}`, size_bytes: 50, body: "# Instructions",
      files: [{ path: "SKILL.md", size_bytes: 20, storage_path: "private", email: "private@example.test" }],
      share_token: "private", secret_slots: ["private"], creator_email: "private@example.test",
    });
    expect(Object.keys(parsed)).toEqual(["org_name", "org_slug", "skill_slug", "name", "description",
      "version", "released_at", "checksum", "size_bytes", "body", "files"]);
    expect(parsed.files).toEqual([{ path: "SKILL.md", size_bytes: 20 }]);
    expect(JSON.stringify(parsed)).not.toContain("private");
  });

  it("requires explicit boolean consent and rejects extra authority", () => {
    for (const input of [{}, { listed: "true" }, { listed: true, org_id: "other" }, { listed: true, version: "private" }]) {
      expect(setSkillPublicListingInputSchema.safeParse(input).success).toBe(false);
    }
    expect(setSkillPublicListingInputSchema.parse({ listed: false })).toEqual({ listed: false });
  });
});
