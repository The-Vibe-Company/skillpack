import { createHash, randomBytes } from "node:crypto";
import { zipSync } from "fflate";
import { expect, it, vi } from "vitest";
import { checkCatalogPackage } from "../src/catalogChecks";

it("never emits YAML warnings or parser excerpts containing package source", () => {
  const warning = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
  try {
    const secret = ["ghp_", randomBytes(20).toString("hex")].join("");
    for (const frontmatter of [
      `name: safe-skill\ndescription: !unknown ${secret}\nlicense: MIT`,
      `name: [\ndescription: ${secret}\nlicense: MIT`,
    ]) {
      const bytes = Buffer.from(zipSync({ "SKILL.md": Buffer.from(`---\n${frontmatter}\n---\nInstructions`) }));
      const report = checkCatalogPackage({ bytes, checksum: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, sizeBytes: bytes.length, slug: "safe-skill" });
      expect(report.passed).toBe(false);
      expect(report.findings.some(finding => finding.rule_id === "skill_frontmatter_invalid")).toBe(true);
      expect(JSON.stringify(report)).not.toContain(secret);
    }
    expect(warning).not.toHaveBeenCalled();
  } finally {
    warning.mockRestore();
  }
});
