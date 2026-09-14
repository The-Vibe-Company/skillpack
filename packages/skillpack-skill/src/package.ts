import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  SKILLPACK_SKILL_KEY,
  COMPANION_SKILL_MANIFEST,
  skillpackSkillChanges,
  skillpackSkillDir,
} from "./index";
import { computeLocalSkillStatus, type LocalSkillInstall } from "@skillpack/core/services";
import { localSkillIntegrityFilesSchema, type LocalSkillPrompts, type LocalSkillRow } from "@skillpack/contracts";
import { packDir, tarGzToZip } from "@skillpack/skills";
import { z } from "zod";

export interface SkillpackSkillPackage {
  key: string;
  /** Exact `.zip` bytes served by `/local-skills/skillpack/package`. */
  zip: Buffer;
  /** Canonical package checksum computed from the deterministic package archive. */
  checksum: string;
  sizeBytes: number;
  /** Authoritative version, read from the bundled companion.json `version`. */
  version: string;
  integrity: LocalSkillRow["integrity"];
}

let cached: Promise<SkillpackSkillPackage> | null = null;

const skillpackIntegrityBaselineSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.string(),
  files: localSkillIntegrityFilesSchema.refine((files) => Object.keys(files).length > 0, "integrity baseline must include files"),
});

/**
 * Pack the bundled Skillpack skill once and cache the result (archive + checksum + version). The
 * source never changes at runtime, so this is computed at most once per process.
 */
export function getSkillpackSkillPackage(): Promise<SkillpackSkillPackage> {
  if (!cached) {
    cached = buildPackage().catch((error) => {
      cached = null; // allow a retry on the next request
      throw error;
    });
  }
  return cached;
}

async function buildPackage(): Promise<SkillpackSkillPackage> {
  const dir = skillpackSkillDir();
  const packed = await packDir(dir);
  const zip = await tarGzToZip(packed.archive);
  const packageChecksum = packed.checksum;
  // SAFETY: the repository-owned bundled manifest declares its semver version.
  const manifest = JSON.parse(await readFile(join(dir, "companion.json"), "utf8")) as { version?: string };
  const version = manifest.version;
  if (!version) throw new Error("bundled companion skill is missing companion.json version");
  const baseline = skillpackIntegrityBaselineSchema.parse(JSON.parse(await readFile(join(dir, "companion.integrity.json"), "utf8")));
  if (baseline.version !== version) throw new Error("bundled companion integrity baseline version does not match companion.json");
  const files = { ...baseline.files };
  for (const relPath of [...Object.keys(baseline.files), "companion.integrity.json"]) {
    const bytes = await readFile(join(dir, relPath));
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (relPath !== "companion.integrity.json" && baseline.files[relPath] !== digest) {
      throw new Error(`bundled companion integrity baseline is stale for ${relPath}`);
    }
    files[relPath] = digest;
  }
  return {
    key: SKILLPACK_SKILL_KEY,
    zip,
    checksum: packageChecksum,
    sizeBytes: zip.length,
    version,
    integrity: {
      packageChecksum,
      files,
    },
  };
}

/** Agent-Auth-first assistant prompts. They contain no bearer secret or silent legacy fallback. */
export function buildSkillpackSkillPrompts(version: string): LocalSkillPrompts {
  const install = [
    `Install Skillpack skill ${version} for workspace {workspaceId} from {base}.`,
    "Use delegated Agent Auth; do not create or request a PAT. Pin every bootstrap command to",
    "@auth/agent-cli@0.5.1 and use device_authorization only.",
    "",
    "1. Derive the public instance origin from {base} by removing its trailing /v1, then discover it:",
    '   origin="{base}"; origin="${origin%/v1}"',
    '   npx --yes @auth/agent-cli@0.5.1 --storage-dir "$HOME/.companion/agent-auth" --url="$origin" discover "$origin"',
    "   Set --storage-dir to",
    "   ~/.companion/agent-auth, create it as 0700, and use umask 077.",
    "2. Read the non-secret agentId in schema-v3 ~/.companion/credentials.json. `connection` checks",
    "   only local key state, so run both commands with the pinned CLI:",
    '   npx --yes @auth/agent-cli@0.5.1 --storage-dir "$HOME/.companion/agent-auth" --url="$origin" connection "$agent_id"',
    '   status_response="$(npx --yes @auth/agent-cli@0.5.1 --storage-dir "$HOME/.companion/agent-auth" --url="$origin" status "$agent_id")"',
    "   Parse status_response in memory. Reuse it only when status is exactly active and",
    "   agent_capability_grants contains an active skills:read grant constrained to",
    "   workspaceId={workspaceId}.",
    "3. If the agent is active but that grant is absent or non-active, request it on the same agent:",
    '   npx --yes @auth/agent-cli@0.5.1 --storage-dir "$HOME/.companion/agent-auth" --url="$origin" request "$agent_id" --capabilities skills:read --constraints \'{"skills:read":{"workspaceId":{"eq":"{workspaceId}"}}}\' --preferred-method device_authorization --reason "Read skills in Skillpack workspace {workspaceId}"',
    "   After approval, run status again and require the active agent and exact active constrained",
    "   grant. Do not trust the cached output from connection or request.",
    '   status_response="$(npx --yes @auth/agent-cli@0.5.1 --storage-dir "$HOME/.companion/agent-auth" --url="$origin" status "$agent_id")"',
    "4. If the connection is absent, status is not active (including revoked, rejected, or expired),",
    "   or the CLI reports agent_not_found, reconnect with:",
    '   npx --yes @auth/agent-cli@0.5.1 --storage-dir "$HOME/.companion/agent-auth" --url="$origin" connect --provider "$origin" --mode delegated --preferred-method device_authorization --capabilities skills:read --constraints \'{"skills:read":{"workspaceId":{"eq":"{workspaceId}"}}}\' --name "Skillpack" --reason "Read skills in Skillpack workspace {workspaceId}"',
    "   If status or connect reports host_revoked, do not retry with that host key. Only after that",
    "   explicit server error, remove the revoked ~/.companion/agent-auth/host.json identity. If it",
    "   reports host_not_found, leave the missing identity missing. Rerun the same connect command so",
    "   the CLI generates a fresh host identity, parse its agentId, then revalidate:",
    '   status_response="$(npx --yes @auth/agent-cli@0.5.1 --storage-dir "$HOME/.companion/agent-auth" --url="$origin" status "$agent_id")"',
    "5. Persist only { issuer, agentId } plus apiUrl={base} under this workspace in credentials.json.",
    "   Migrate a schema-v2 token to schema v3 under legacyPat without using it. Write atomically with",
    "   mode 0600; private host/agent keys stay only under ~/.companion/agent-auth.",
    `6. Execute skills:read with {workspaceId, transfer:{action:"download-local",slug:"skillpack",version:"${version}"}}.`,
    "   Keep the 60-second ticket in memory. Pipe the execution JSON over stdin to a local program",
    "   that sends it only in X-Companion-Transfer-Ticket to {base}/local-skills/skillpack/package.",
    "   Never put the ticket in a URL, argv, file, log, or chat.",
    "7. Verify the exact checksum and size. Inspect the ZIP without executing scripts; reject",
    "   traversal, absolute paths, duplicate/case-colliding paths, links, and special files, and",
    "   require SKILL.md at the root.",
    "8. Ask which tool(s): Claude Code, Codex, OpenCode, Grok Bot, OpenClaw, or Hermes. For Claude Code,",
    "   Codex, OpenCode, Grok Bot, and OpenClaw, also ask global or project/workspace. Grok Bot is",
    "   Cursor's desktop assistant; Grok Bot (Cursor) uses ~/.cursor/skills globally and .cursor/skills",
    "   in a project. Hermes is global-only",
    "   at ~/.hermes/skills/<slug>; do not offer project scope for Hermes. Confirm before",
    "   replacement, stage beside the destination, and atomically swap with rollback. Install only",
    "   the root package and report declared prerequisites.",
    "9. Run the bootstrap once from the installed skillpack folder:",
    "   python3 scripts/bootstrap.py --summary",
    "10. Report installation through scripts/skillpack-agent-client.mjs over JSON stdin:",
    `   {"action":"api","method":"POST","path":"/local-skills/skillpack/installed","body":{"version":"${version}","agent":"<your assistant>"}}`,
    "   This first write may request one additional skills:write approval. Tell me when it is ready.",
  ].join("\n");

  const update = [
    `Please update the Skillpack skill to version ${version}.`,
    "Use its existing Agent Auth connection. If only a legacy PAT exists, do not use it silently;",
    "complete the delegated device connection from the install flow first.",
    "1. From the installed skillpack folder, run the safe bootstrap update:",
    "   python3 scripts/bootstrap.py --json --auto-update-skillpack",
    "   It preserves local customizations: if tracked files are modified or missing, it blocks with",
    '   reason "local_customizations" instead of overwriting them.',
    "2. The bundled client obtains a one-use skills:read transfer ticket for the exact local package;",
    "   it never sends a PAT or long-lived JWT to a binary endpoint. Verify integrity, use an atomic",
    "   swap with rollback, and remove transient archives/backups.",
    "3. Report the installed version through the bundled client. Request skills:write progressively",
    "   if absent, then tell me what changed.",
  ].join("\n");

  const use = [
    "Use the Skillpack skill to manage, validate, and publish my skills.",
    "Use the schema-v3 Agent Auth connection for workspace {workspaceId}; request capabilities only",
    "when first needed. Never fall back to a PAT unless I explicitly select legacy-pat mode.",
    "On the first Skillpack use in a conversation, run:",
    "python3 scripts/bootstrap.py --json --auto-update-skillpack",
  ].join("\n");

  const onboarding = [
    install,
    "",
    "11. Start the Skillpack guided onboarding described in SKILL.md under \"Guided onboarding",
    "    (getting started)\". Continue in my conversation language (English or French), read",
    "    GET /getting-started, and resume from first_incomplete_step. Review local skills first,",
    "    then the complete organization library, asking for every required confirmation. A step is",
    "    complete only after its POST /getting-started/steps call returns 2xx.",
    "    If the newly installed Skillpack skill can be loaded now, continue in this conversation.",
    "    If the Skillpack skill cannot be loaded in this conversation, start a new conversation in {tool} and say:",
    "    'Use the skillpack skill and resume my Skillpack getting started onboarding.'",
  ].join("\n");

  const resume = [
    "Use the Skillpack skill to resume my Skillpack getting started onboarding for workspace",
    "{workspaceId} at {base}. Run python3 scripts/bootstrap.py --json --auto-update-skillpack once,",
    "then GET /getting-started and resume from first_incomplete_step in my conversation language",
    "(English or French). If the skill is not installed locally, direct me back to the Install step.",
    "Treat a step as complete only after its POST /getting-started/steps call returns 2xx.",
    "If the Skillpack skill cannot be loaded in this conversation, start a new conversation in {tool} and say:",
    "'Use the skillpack skill and resume my Skillpack getting started onboarding.'",
  ].join("\n");

  return { install, update, use, onboarding, resume };
}

/** Compose the read row for the Skillpack skills view from the caller's install record. */
export async function buildSkillpackSkillRow(
  install: LocalSkillInstall | null,
  workspaceId: string,
): Promise<LocalSkillRow> {
  const pkg = await getSkillpackSkillPackage();
  const m = COMPANION_SKILL_MANIFEST;
  return {
    workspaceId,
    key: m.key,
    name: m.name,
    description: m.description,
    status: computeLocalSkillStatus(install?.installedVersion ?? null, pkg.version),
    installedVersion: install?.installedVersion ?? null,
    availableVersion: pkg.version,
    lastReportedAt: install ? install.lastReportedAt.toISOString() : null,
    agentLabel: install?.agentLabel ?? null,
    notes: m.notes,
    commands: m.commands,
    changes: skillpackSkillChanges(pkg.version),
    integrity: pkg.integrity,
    prompts: buildSkillpackSkillPrompts(pkg.version),
  };
}
