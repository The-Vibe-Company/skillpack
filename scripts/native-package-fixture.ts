// Regenerate the independent cross-language packaging oracle with the existing TS packer.
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { packDir } from "../packages/skills/src/pack";
const directory = await mkdtemp(join(tmpdir(), "skillpack-fixture-"));
const output = resolve(dirname(fileURLToPath(import.meta.url)), "../runtime/internal/cli/testdata");
try {
  const files = {
    "SKILL.md": "---\nname: fixture\ndescription: Portable fixture\n---\n\nFixture.\n",
    "empty.txt": "",
    "scripts/run.sh": "#!/bin/sh\r\necho fixture\r\n",
    "references/café.md": "Unicode: café, 日本語.\n",
    [`references/${"long-".repeat(28)}.md`]: "Long name requiring PAX.\n",
  };
  for (const [name, body] of Object.entries(files)) {
    await mkdir(join(directory, name, ".."), { recursive: true });
    await writeFile(join(directory, name), body);
  }
  const result = await packDir(directory);
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "canonical-package.json"), JSON.stringify({ files, checksum: result.checksum }, null, 2) + "\n");
} finally { await rm(directory, { recursive: true, force: true }); }
