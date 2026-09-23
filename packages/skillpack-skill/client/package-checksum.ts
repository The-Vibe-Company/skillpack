import { readFileSync } from "node:fs";
import { z } from "zod";
import { packDir } from "@skillpack/skills";

// Local-only helper: no credentials, API access, or execution of packaged scripts.
const input = z.object({ directory: z.string().min(1) }).strict().parse(JSON.parse(readFileSync(0, "utf8")));
try {
  process.stdout.write(JSON.stringify({ checksum: (await packDir(input.directory)).checksum }));
} catch {
  process.stdout.write(JSON.stringify({ error: "Package checksum verification failed" }));
  process.exitCode = 1;
}
