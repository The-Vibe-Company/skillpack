import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearTelemetryIdentity, saveTelemetryIdentity } from "./telemetryIdentity";

afterEach(() => vi.unstubAllEnvs());
describe("non-secret reporting identity", () => {
  it("stores only ID/email and preserves another profile's identity on logout", async () => {
    const dir = await mkdtemp(join(tmpdir(), "usage-identity-")); const path = join(dir, "telemetry.json");
    try {
      await saveTelemetryIdentity({ id: "user-a", email: "a@example.test" }, path);
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ user_id: "user-a", email: "a@example.test" });
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      await clearTelemetryIdentity("user-b", path);
      expect(await readFile(path, "utf8")).toContain("user-a");
      await clearTelemetryIdentity("user-a", path);
      await expect(stat(path)).rejects.toThrow();
      vi.stubEnv("SKILLPACK_TELEMETRY", "0");
      await saveTelemetryIdentity({ id: "user-a", email: "a@example.test" }, path);
      await expect(stat(path)).rejects.toThrow();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
