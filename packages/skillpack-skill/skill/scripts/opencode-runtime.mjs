/*
 * Skillpack's OpenCode 1.18 plugin bridge.
 *
 * This file is packaged as .mjs and installed as a .js plugin because the
 * OpenCode 1.18 loader only discovers JavaScript files in its plugins folder.
 * The bridge is deliberately offline: it validates the active, digest-pinned
 * runtime and sends only a small structured hook envelope to that executable.
 */

import { createHash } from "node:crypto";
import { spawnSync as nodeSpawnSync } from "node:child_process";
import {
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import {
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

const MAX_RUNTIME_BYTES = 128 * 1024 * 1024;
const RUNTIME_TIMEOUT_MS = 2_000;

function stringValue(value) {
  // SAFETY: validate the untyped host callback or local JSON boundary before constructing a hook envelope.
  // oxlint-disable-next-line anti-slop/no-runtime-typeof
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function defaultRuntimeHome() {
  const configured = stringValue(process.env.SKILLPACK_RUNTIME_HOME);
  if (configured) return resolve(configured);
  if (process.platform === "win32") {
    return resolve(stringValue(process.env.APPDATA) || join(homedir(), "AppData", "Roaming"), "skillpack");
  }
  if (process.platform === "darwin") return resolve(join(homedir(), "Library", "Application Support", "skillpack"));
  return resolve(stringValue(process.env.XDG_CONFIG_HOME) || join(homedir(), ".config"), "skillpack");
}

function inside(parent, child) {
  const childRelative = relative(parent, child);
  return childRelative !== "" && !isAbsolute(childRelative) && childRelative !== ".." && !childRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`);
}

/**
 * Resolve and verify active.json without following a version-directory or
 * binary symlink. A corrupt or absent installation is an intentional no-op.
 */
export function resolveActiveRuntime(stateDir = defaultRuntimeHome()) {
  try {
    const state = realpathSync(resolve(stateDir));
    const active = JSON.parse(readFileSync(join(state, "active.json"), "utf8"));
    const rawBinary = stringValue(active?.binary);
    const expectedHash = stringValue(active?.binarySha256).toLowerCase();
    if (!rawBinary || isAbsolute(rawBinary) || !/^[a-f0-9]{64}$/.test(expectedHash)) return null;

    const versions = join(state, "versions");
    const versionsStat = lstatSync(versions);
    if (!versionsStat.isDirectory() || versionsStat.isSymbolicLink()) return null;
    const physicalVersions = realpathSync(versions);
    const binary = resolve(state, rawBinary);
    const binaryStat = lstatSync(binary);
    if (!binaryStat.isFile() || binaryStat.isSymbolicLink() || binaryStat.size > MAX_RUNTIME_BYTES) return null;
    const physicalBinary = realpathSync(binary);
    if (!inside(physicalVersions, physicalBinary)) return null;
    if (!statSync(physicalBinary).isFile()) return null;
    const actualHash = createHash("sha256").update(readFileSync(physicalBinary)).digest("hex");
    if (actualHash !== expectedHash) return null;
    return { stateDir: state, binary: physicalBinary };
  } catch {
    return null;
  }
}

/**
 * Convert OpenCode's native callback payload into the common runtime hook
 * envelope. Only metadata.dir/name is evidence of a successful Skill call.
 */
export function normalizeOpenCodeEvent(input, output) {
  const sessionID = stringValue(input?.sessionID ?? input?.session_id);
  if (!sessionID) return null;

  const tool = input?.tool;
  if (tool === undefined && output === undefined) {
    return {
      hook_event_name: "SessionStart",
      session_id: sessionID,
    };
  }
  // SAFETY: validate the untyped host callback or local JSON boundary before constructing a hook envelope.
  // oxlint-disable-next-line anti-slop/no-runtime-typeof
  if (typeof tool !== "string" || tool.toLowerCase() !== "skill") return null;
  // SAFETY: validate the untyped host callback or local JSON boundary before constructing a hook envelope.
  // oxlint-disable-next-line anti-slop/no-runtime-typeof
  if (!output || typeof output !== "object" || Array.isArray(output)) return null;
  if (output.error || output.isError === true || output.is_error === true || output.success === false) return null;
  const metadata = output.metadata;
  // SAFETY: validate the untyped host callback or local JSON boundary before constructing a hook envelope.
  // oxlint-disable-next-line anti-slop/no-runtime-typeof
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const name = stringValue(metadata.name);
  const dir = stringValue(metadata.dir);
  const callID = stringValue(input.callID ?? input.call_id);
  if (!name || !dir || !callID) return null;
  return {
    hook_event_name: "PostToolUse",
    session_id: sessionID,
    tool_name: "Skill",
    tool_use_id: callID,
    tool_input: { skill: dir },
    tool_response: { success: true, commandName: name },
  };
}

/**
 * Invoke the verified runtime using argv directly. `spawn` is injectable for
 * tests; production always uses Node's shell-free spawnSync.
 */
export function runRuntime(envelope, options = {}) {
  // SAFETY: validate the untyped host callback or local JSON boundary before constructing a hook envelope.
  // oxlint-disable-next-line anti-slop/no-runtime-typeof
  if (!envelope || typeof envelope !== "object") return false;
  const runtime = resolveActiveRuntime(options.stateDir ?? defaultRuntimeHome());
  if (!runtime) return false;
  const spawn = options.spawn ?? nodeSpawnSync;
  try {
    spawn(runtime.binary, ["--state-dir", runtime.stateDir, "hook", "--agent", "opencode"], {
      input: `${JSON.stringify(envelope)}\n`,
      encoding: "utf8",
      timeout: RUNTIME_TIMEOUT_MS,
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

export async function SkillpackOpenCodePlugin() {
  return {
    "chat.message": async (input) => {
      const envelope = normalizeOpenCodeEvent(input);
      if (envelope) runRuntime(envelope);
    },
    "tool.execute.after": async (input, output) => {
      const envelope = normalizeOpenCodeEvent(input, output);
      if (envelope) runRuntime(envelope);
    },
  };
}

export default {
  id: "skillpack-runtime",
  server: SkillpackOpenCodePlugin,
  setup() {},
};
