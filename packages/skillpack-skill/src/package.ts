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

/** Native CLI assistant prompts. Credentials stay in the CLI profile or environment, never in chat. */
export function buildSkillpackSkillPrompts(version: string): LocalSkillPrompts {
  const auth = [
    "Authentication (use the same API URL for every command):",
    "- Human setup: `skillpack auth login --api-url {base}`. The CLI reads the API key through hidden terminal input.",
    "- Automation: provide `SKILLPACK_API_KEY` and `SKILLPACK_API_URL={base}` in the process environment.",
    "- Verify before any read or write: `skillpack auth status --json`. Require an active, unexpired token",
    "  whose workspace and scopes match this request. Stop if the workspace is wrong or the token is revoked.",
    "- Never place an API key in a prompt, chat message, command argument, source file, or log.",
  ].join("\n");

  const runtime = [
    "If the native CLI is not installed, use the official Skillpack runtime installer for runtime-v0.2.0:",
    "- POSIX: download `install.sh` and the adjacent `SHA256SUMS` from `https://github.com/The-Vibe-Company/skillpack/releases/download/runtime-v0.2.0/` over HTTPS,",
    "  verify the installer's SHA-256 against its `SHA256SUMS` entry before running `sh install.sh`. The installer then verifies the pinned archive digest.",
    "- Windows PowerShell: download `install.ps1` and the adjacent `SHA256SUMS` from that same release URL,",
    "  compare `(Get-FileHash .\\install.ps1 -Algorithm SHA256).Hash` with the `install.ps1` entry before running it. The installer then verifies the pinned archive digest.",
    "Do not run an installer or archive whose checksum does not match the release metadata.",
  ].join("\n");

  const commandReference = [
    "Native command reference:",
    "- `skillpack install SLUG --version VERSION --scope user|project --tools TOOL[,TOOL...] --api-url {base}`",
    "- `skillpack setup --tools TOOL[,TOOL...]`",
    "- `skillpack update --all --dry-run --json`, then `skillpack update --all --json` after confirmation",
    "- `skillpack skills publish FOLDER --scope org --api-url {base} --json` or",
    "  `skillpack skills publish FOLDER --scope personal --api-url {base} --json`",
    "- `skillpack api METHOD /v1/path --input FILE --api-url {base}` for a registered API operation",
  ].join("\n");

  const install = [
    `Install the Skillpack management skill at version ${version} for workspace {workspaceId}.`,
    "",
    auth,
    "",
    runtime,
    "",
    `After the user chooses the destination scope, run exactly: \`skillpack install skillpack --version ${version} --scope <scope> --tools <selected> --api-url {base} --json\`.`,
    "Use the supported tool(s) and destination scope already supplied by the request; ask only for a missing choice: Claude Code, Codex, OpenCode, Grok Bot, OpenClaw, or Hermes.",
    "For Claude Code, Codex, OpenCode, Grok Bot, and OpenClaw, use the requested user-wide or current-project destination; ask only when scope is missing.",
    "Grok Bot uses ~/.cursor/skills globally or .cursor/skills in a project; OpenClaw uses its user or workspace skill directory.",
    "Hermes is global-only at ~/.hermes/skills/<slug>; do not offer project scope for Hermes.",
    "Then run `skillpack setup --tools <selected>` to register hooks and usage for the selected tools; setup does not fetch packages.",
    "Keep the package version pinned. Inspect the package safely before activation, preserve existing files",
    "until replacement is confirmed, and report the final destinations and declared prerequisites.",
    "Use secret bindings declared by the package when they already exist. Never invent or create secret configuration",
    "as an implicit part of installation; stop and report missing prerequisites for the user to decide.",
    "Use the install command's structured result as the installation report; do not invent a second report endpoint",
    "and do not include credentials in any output.",
    "",
    commandReference,
  ].join("\n");

  const update = [
    `Update the Skillpack management skill to version ${version} for workspace {workspaceId}.`,
    "",
    auth,
    "",
    runtime,
    "",
    `Inspect the existing Skillpack lock entry to preserve its current scope and tools. Preview this management skill update with \`skillpack install skillpack --version ${version} --scope <existing-scope> --tools <existing-tools> --api-url {base} --dry-run --json\`, show the planned destinations and declared prerequisites, then run the same command without \`--dry-run\` when the user has authorized the update; ask only if that authorization is missing.`,
    "Keep local customizations safe: stop on a customization conflict, preserve the old version for rollback,",
    "and report the exact result. Run `skillpack setup --tools <selected>` when tool registration needs refresh.",
    "",
    commandReference,
  ].join("\n");

  const use = [
    "Use the native Skillpack CLI to manage, validate, install, update, and publish skills for workspace {workspaceId}.",
    "",
    auth,
    "",
    "For the first operation, run `skillpack auth status --json`, then use the narrowest registered operation",
    "that matches the requested action. Preview broad changes with `skillpack update --all --dry-run --json` and",
    "ask before changing files. Keep API keys in the CLI profile or process environment only.",
    "",
    commandReference,
  ].join("\n");

  const onboarding = [
    install,
    "",
    "Continue Skillpack guided onboarding in the user's conversation language (English or French).",
    "Read the current state with `skillpack api GET /v1/getting-started --api-url {base} --json`",
    "and resume from `first_incomplete_step`. Review local skills first, then the organization library,",
    "honoring explicit user authorization and asking only for missing choices or confirmations. Mark a step complete only after the matching registered POST",
    "operation returns 2xx. Never include an API key in the onboarding conversation or request body.",
    "If the newly installed skill cannot be loaded in this conversation, start a new conversation in {tool} and say:",
    "Use the Skillpack skill and resume my Skillpack getting started onboarding.",
  ].join("\n");

  const resume = [
    "Resume Skillpack getting started onboarding for workspace {workspaceId} at {base}.",
    "",
    auth,
    "",
    "Read `GET /v1/getting-started` through `skillpack api GET /v1/getting-started --api-url {base} --json`",
    "and continue from `first_incomplete_step` in English or French. Honor explicit authorization and ask only for missing choices or confirmations. Treat a step as complete only after",
    "its registered POST operation returns 2xx. If the management skill is not installed, direct the user to",
    "the install flow first. If it cannot be loaded in this conversation, start a new conversation in {tool} and say:",
    "Use the Skillpack skill and resume my Skillpack getting started onboarding.",
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
