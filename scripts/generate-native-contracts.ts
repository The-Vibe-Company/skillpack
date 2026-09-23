/** Build-time only: native clients consume the existing portable contracts, never a Node runtime. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { COMPANION_AGENT_OPERATION_REGISTRY } from "../packages/contracts/src/agentOperations";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputs = new Map<string, string>([
 ["runtime-release.json", readFileSync(resolve(root, "packages/skillpack-skill/skill/runtime-release.json"), "utf8")],
 ["opencode-runtime.mjs", readFileSync(resolve(root, "packages/skillpack-skill/skill/scripts/opencode-runtime.mjs"), "utf8")],
  ["operations.json", `${JSON.stringify(COMPANION_AGENT_OPERATION_REGISTRY, null, 2)}\n`],
  ["manifest.schema.json", readFileSync(resolve(root, "packages/contracts/schemas/companion-manifest.v2.schema.json"), "utf8")],
  ["tools.json", readFileSync(resolve(root, "packages/skillpack-skill/skill/scripts/tools.json"), "utf8")],
]);
const target = resolve(root, "runtime/internal/cli/contracts");
mkdirSync(target, { recursive: true });
for (const [name, expected] of outputs) {
  const path = resolve(target, name);
  if (process.argv.includes("--check")) {
    if (readFileSync(path, "utf8") !== expected) throw new Error(`Native contract is stale: ${name}`);
  } else writeFileSync(path, expected);
}
