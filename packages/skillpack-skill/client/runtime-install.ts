import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { z } from "zod";

const manifestIdentity = z.object({ version: z.string(), metadata: z.object({ companionSkillId: z.string().uuid() }) });
function stateDirectory() {
  return process.env.SKILLPACK_RUNTIME_HOME || (process.platform === "darwin" ? join(homedir(), "Library/Application Support/skillpack")
    : process.platform === "win32" ? join(process.env.APPDATA || join(homedir(), "AppData/Roaming"), "skillpack")
      : join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "skillpack"));
}

function directoryChecksum(directory: string) {
  const files: string[] = [];
  function visit(path: string, prefix: string) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isDirectory()) visit(join(path, entry.name), prefix + entry.name + "/");
      else if (entry.isFile()) files.push(prefix + entry.name);
      else throw new Error("verified install contains a symlink");
    }
  }
  visit(directory, "");
  const hash = createHash("sha256");
  for (const name of files.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) hash.update(name).update("\0").update(readFileSync(join(directory, name))).update("\0");
  return `sha256:${hash.digest("hex")}`;
}

/** Called only AFTER the official transport verifies and installs the selected archive. */
export function registerVerifiedInstall(input: { destination: string; origin: string; slug: string; version: string; pinned: string | null; scope: string; state?: string }) {
  try {
    const directory = realpathSync(input.destination);
    const manifest = manifestIdentity.parse(JSON.parse(readFileSync(join(directory, "companion.json"), "utf8")));
    if (manifest.version !== input.version) throw new Error("verified install version mismatch");
    const origin = new URL(input.origin);
    if (origin.protocol !== "https:" || origin.username || origin.password) throw new Error("runtime origin requires HTTPS");
    const state = resolve(input.state ?? stateDirectory());
    const receipts = join(state, "installs");
    mkdirSync(receipts, { recursive: true, mode: 0o700 });
    const receipt = { schemaVersion: 1, origin: origin.origin, slug: input.slug, skillId: manifest.metadata.companionSkillId,
      version: input.version, pinned: input.pinned, scope: input.scope, path: directory, checksum: directoryChecksum(directory) };
    const key = createHash("sha256").update(directory).digest("hex");
    const temporary = join(receipts, `.${randomUUID()}.tmp`);
    writeFileSync(temporary, JSON.stringify(receipt) + "\n", { mode: 0o600, flag: "wx" });
    renameSync(temporary, join(receipts, `${key}.json`));
    if (!existsSync(join(state, "active.json"))) return { status: "setup_required" };
    const active = z.object({ binary: z.string(), binarySha256: z.string() }).parse(JSON.parse(readFileSync(join(state, "active.json"), "utf8")));
    const binary = realpathSync(resolve(state, active.binary));
    const inside = relative(realpathSync(join(state, "versions")), binary);
    if (isAbsolute(inside) || inside.startsWith("..") || createHash("sha256").update(readFileSync(binary)).digest("hex") !== active.binarySha256) throw new Error("invalid active runtime");
    const inventoryPath = join(state, `.inventory-${randomUUID()}.json`);
    try {
      writeFileSync(inventoryPath, JSON.stringify({ schema_version: 1, origins: [origin.origin], skills: [{ path: directory, skill_id: receipt.skillId, version: input.version, origin: origin.origin }] }), { mode: 0o600, flag: "wx" });
      const result = spawnSync(binary, ["--state-dir", state, "register", "--inventory", inventoryPath], { stdio: "ignore", timeout: 10_000 });
      return { status: result.status === 0 ? "registered" : "registration_failed" };
    } finally { rmSync(inventoryPath, { force: true }); }
  } catch { return { status: "registration_failed" }; }
}
