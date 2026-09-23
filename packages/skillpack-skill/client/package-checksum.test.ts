import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { packDir } from "@skillpack/skills";

it("reports the server canonical checksum from installed bytes without credentials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "installed-checksum-"));
  try {
    await writeFile(join(dir, "SKILL.md"), "---\nname: test\ndescription: Test\n---\nOriginal\n");
    const helper = fileURLToPath(new URL("../skill/scripts/package-checksum.mjs", import.meta.url));
    const checksum = () => JSON.parse(execFileSync(process.execPath, [helper], {
      input: JSON.stringify({ directory: dir }), encoding: "utf8",
    })).checksum;
    const original = checksum();
    expect(original).toBe((await packDir(dir)).checksum);
    await writeFile(join(dir, "SKILL.md"), "---\nname: test\ndescription: Test\n---\nRetrofitted\n");
    expect(checksum()).toBe((await packDir(dir)).checksum);
    expect(checksum()).not.toBe(original);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
