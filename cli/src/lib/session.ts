import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { saveTelemetryIdentity, clearTelemetryIdentity } from "./telemetryIdentity";
import { COMPANION_HOME, sessionPath } from "./paths";

export interface Session {
  cookie: string;
  orgId?: string;
  user?: { id: string; email: string };
}

export async function loadSession(profile: string): Promise<Session | null> {
  try {
    // SAFETY: This existing private session store is written only by saveSession.
    return JSON.parse(await readFile(sessionPath(profile), "utf8")) as Session;
  } catch {
    return null;
  }
}

export async function saveSession(profile: string, s: Session): Promise<void> {
  await mkdir(COMPANION_HOME, { recursive: true });
  await writeFile(sessionPath(profile), JSON.stringify(s, null, 2));
  if (s.user) await saveTelemetryIdentity(s.user).catch(() => undefined);
  try {
    await chmod(sessionPath(profile), 0o600);
  } catch {
    // best effort
  }
}

export async function clearSession(profile: string): Promise<void> {
  const session = await loadSession(profile);
  if (session?.user) await clearTelemetryIdentity(session.user.id).catch(() => undefined);
  try {
    await rm(sessionPath(profile));
  } catch {
    // already gone
  }
}
