/** Refresh portable repo setup assets. --patch-skills migrates tracked old emitters once. */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { bumpSemver, packDir, withSkillUsageInstructions } from "../packages/skills/src/index";

const root = resolve(import.meta.dirname, "..");
const destination = join(root, ".agents/skillpack/usage");
await mkdir(destination, { recursive: true });
const source = join(root, "packages/skillpack-skill/skill");
for (const name of ["runtime_setup.py", "runtime_lock.py", "runtime_command.py", "verify-runtime-release.mjs", "skillpack-runtime-launch.py"]) {
  await copyFile(join(source, "scripts", name), join(destination, name));
}
await copyFile(join(source, "runtime-release.json"), join(destination, "runtime-release.json"));
await mkdir(join(root, ".opencode/plugins"), { recursive: true });
await copyFile(join(source, "scripts/opencode-runtime.mjs"), join(root, ".opencode/plugins/skillpack-runtime.js"));
const skills = [];
for (const name of (await readdir(join(root, ".agents/skills"))).sort()) {
  const directory = join(root, ".agents/skills", name);
  let manifest;
  try { manifest = JSON.parse(await readFile(join(directory, "companion.json"), "utf8")); } catch { continue; }
  if (process.argv.includes("--patch-skills") && manifest.metadata?.companionSkillId && manifest.metadata?.usage?.schemaVersion !== 1) {
    const parentVersion = manifest.version;
    const parentChecksum = (await packDir(directory)).checksum;
    manifest.version = bumpSemver(parentVersion, "patch");
    manifest.metadata.usage = { schemaVersion: 1, skillId: manifest.metadata.companionSkillId,
      version: manifest.version, origin: "https://skillpack.app", migration: { parentVersion, parentChecksum } };
    manifest.metadata.changelog.unshift({ version: manifest.version, date: new Date().toISOString().slice(0, 10), changes: ["Replace model activation reporting with automatic Skillpack runtime collection."] });
    const markdown = await readFile(join(directory, "SKILL.md"), "utf8");
    const frontmatter = markdown.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)([\s\S]*)$/);
    if (!frontmatter) throw new Error(`Missing frontmatter: ${name}`);
    await writeFile(join(directory, "SKILL.md"), frontmatter[1] + "\n" + withSkillUsageInstructions(frontmatter[2]!, {
      skillId: manifest.metadata.companionSkillId, version: manifest.version, instanceUrl: "https://skillpack.app",
    }) + "\n");
    await writeFile(join(directory, "companion.json"), JSON.stringify(manifest, null, 2) + "\n");
  }
  if (!manifest.metadata?.usage) continue;
  const files: Record<string, string> = {};
  async function visit(path: string, prefix: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (["__pycache__", ".DS_Store", ".git"].includes(entry.name)) continue;
      const relative = prefix + entry.name;
      if (entry.isDirectory()) await visit(join(path, entry.name), relative + "/");
      else if (entry.isFile()) files[relative] = createHash("sha256").update(await readFile(join(path, entry.name))).digest("hex");
      else throw new Error(`Unexpected symlink in verified skill: ${name}/${relative}`);
    }
  }
  await visit(directory, "");
  skills.push({ path: `.agents/skills/${name}`, skillId: manifest.metadata.companionSkillId, version: manifest.version,
    origin: "https://skillpack.app", files });
}
await writeFile(join(destination, "inventory.json"), JSON.stringify({ schemaVersion: 1, origins: ["https://skillpack.app"], skills }, null, 2) + "\n");
console.log(`Prepared portable inventory for ${skills.length} repository skills.`);
