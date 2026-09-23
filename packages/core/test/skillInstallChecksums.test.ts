import { describe, expect, it } from "vitest";
import { computeSkillInstallStatus } from "../src/services";

describe("installed package checksum status", () => {
  it("detects replaced bytes at the same version and clears after reinstall", () => {
    expect(computeSkillInstallStatus(true, "1.0.0", "1.0.0", "old", "new")).toBe("update");
    expect(computeSkillInstallStatus(true, "1.0.0", "1.0.0", "new", "new")).toBe("installed");
  });
  it("detects changes to manually tracked packages with unknown version", () => {
    expect(computeSkillInstallStatus(true, null, "1.0.0", "old", "new")).toBe("update");
  });
  it("preserves version, unknown, and absent install semantics", () => {
    expect(computeSkillInstallStatus(false, "1.0.0", "1.0.0", "old", "new")).toBe("none");
    expect(computeSkillInstallStatus(true, "1.0.0", "2.0.0", "same", "same")).toBe("update");
    expect(computeSkillInstallStatus(true, null, "1.0.0", null, "new")).toBe("installed");
    expect(computeSkillInstallStatus(true, "2.0.0", "1.0.0", "new", "old")).toBe("installed");
  });
});
