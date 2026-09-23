import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const defaultPath = () => join(homedir(), ".skillpack", "telemetry.json");

/** Separate from the session file so reporting agents never have to inspect a cookie. */
export async function saveTelemetryIdentity(user: { id: string; email: string }, path = defaultPath()): Promise<void> {
  if (process.env.SKILLPACK_TELEMETRY === "0") return;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify({ user_id: user.id, email: user.email }) + "\n", { mode: 0o600 });
}

/** Logging out a different CLI profile must not remove the last signed-in identity. */
export async function clearTelemetryIdentity(userId: string, path = defaultPath()): Promise<void> {
  const raw = await readFile(path, "utf8").catch(() => null);
  if (!raw) return;
  const parsed: { user_id?: string } = JSON.parse(raw);
  if (parsed.user_id === userId) await rm(path, { force: true });
}
