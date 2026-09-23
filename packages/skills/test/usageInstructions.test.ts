import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { packDir, prepareSkillDirForPublish, withSkillUsageInstructions } from "../src/index";

const input = { skillId: "733fd021-274c-48ac-a843-95ee78b47759", version: "1.0.0", instanceUrl: "https://skills.example.test" };
describe("portable activation instructions", () => {
  it("replaces its block and retains authored content across publications", () => {
    const body = "# Review\n\nRead the code.\n\n```sh\nprintf 'hello'\n```";
    const first = withSkillUsageInstructions(body, input);
    expect(withSkillUsageInstructions(first, input)).toBe(first);
    const updated = withSkillUsageInstructions(first, { ...input, version: "2.0.0", instanceUrl: "https://self-hosted.example.test" });
    expect(updated.match(/<!-- skillpack:usage:start -->/g)).toHaveLength(1);
    expect(updated).toContain('"version":"2.0.0"');
    expect(updated).not.toContain("https://skills.example.test");
    expect(updated.endsWith(body)).toBe(true);
    expect(updated).toContain("SKILLPACK_TELEMETRY=0");
    expect(updated).toContain("--max-time 3 --retry 0");
    expect(updated).toContain("-TimeoutSec 3");
  });
  it("preserves marker examples inside the authored body", () => {
    const body = "# Documentation\n\n```html\n<!-- skillpack:usage:start -->example<!-- skillpack:usage:end -->\n```";
    expect(withSkillUsageInstructions(body, input).endsWith(body)).toBe(true);
  });
  it("rejects malformed blocks and non-HTTP destinations", () => {
    expect(() => withSkillUsageInstructions("<!-- skillpack:usage:start -->oops", input)).toThrow("Unclosed");
    expect(() => withSkillUsageInstructions("body", { ...input, instanceUrl: "file:///tmp/foo" })).toThrow();
    expect(() => withSkillUsageInstructions("body", { ...input, instanceUrl: "https://user:secret@example.test" })).toThrow();
  });
  it("includes instrumentation in canonical bytes without mutating earlier archive snapshots", async () => {
    const dir = await mkdtemp(join(tmpdir(), "usage-package-"));
    try {
      await writeFile(join(dir, "SKILL.md"), "---\nname: review\ndescription: Review code.\n---\n\n# Review\nRead the code.\n");
      const original = await packDir(dir);
      const saved = Buffer.from(original.archive);
      await prepareSkillDirForPublish(dir, input);
      const first = await packDir(dir);
      expect(first.checksum).not.toBe(original.checksum);
      expect(await readFile(join(dir, "SKILL.md"), "utf8")).toContain(input.skillId);
      await prepareSkillDirForPublish(dir, input);
      expect((await packDir(dir)).checksum).toBe(first.checksum);
      expect(original.archive.equals(saved)).toBe(true);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
