import { describe, expect, it } from "vitest";
import { catalogCheckReportSchema, publicCatalogSkillSchema, skillPublicListingStatusSchema, requestSkillPublicListingInputSchema, setSkillPublicListingInputSchema } from "../src/publicCatalog";

describe("catalog privacy contract", () => {
  it("rejects source excerpts and matched values in reports", () => {
    const finding = { rule_id: "secret_github", severity: "blocking", path: "nested/config.txt", line: 1 };
    expect(catalogCheckReportSchema.safeParse({ version: 1, passed: false, findings: [finding] }).success).toBe(true);
    for (const field of ["value", "message", "excerpt"]) {
      expect(catalogCheckReportSchema.safeParse({ version: 1, passed: false, findings: [{ ...finding, [field]: "sensitive" }] }).success).toBe(false);
    }
  });
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


it("strips internal identity and token fields from listing status", () => {
  const value = skillPublicListingStatusSchema.parse({
    listed_publicly: false, listed_at: null, latest_submission: {
      id: "11111111-1111-4111-8111-111111111111", status: "rejected", kind: "submission", share_token: "private",
    }, rejection_reason: "Unsupported package", check_report: null, can_manage_listing: true, share_token: "private", submitted_by: "private",
  });
  expect(JSON.stringify(value)).not.toContain("private");
  expect(value.rejection_reason).toBe("Unsupported package");
  expect(requestSkillPublicListingInputSchema.safeParse({ version: "override" }).success).toBe(false);
});
