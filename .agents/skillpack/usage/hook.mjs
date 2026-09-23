// Fast, offline hook bridge. Setup is an explicit image/workspace step.
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";
try {
  const state = process.env.SKILLPACK_RUNTIME_HOME || (process.platform === "darwin"
    ? join(homedir(), "Library/Application Support/skillpack")
    : process.platform === "win32" ? join(process.env.APPDATA || join(homedir(), "AppData/Roaming"), "skillpack")
      : join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "skillpack"));
  const active = JSON.parse(readFileSync(join(state, "active.json"), "utf8"));
  const binary = realpathSync(resolve(state, active.binary));
  const inside = relative(realpathSync(join(state, "versions")), binary);
  if (isAbsolute(inside) || inside.startsWith("..")) throw new Error("invalid active binary");
  spawnSync(binary, ["--state-dir", state, "hook", "--agent", process.argv[2]], { stdio: ["inherit", "ignore", "ignore"], timeout: 2000 });
} catch { /* Missing runtime never blocks the agent; run setup/doctor to diagnose. */ }
