import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { packDir, prepareSkillDirForPublish } from "@skillpack/skills";
import { emptyLockfile, loadLockfile, saveLockfile } from "../lib/lockfile";
const execFileAsync = promisify(execFile);

describe("publication normalization compatibility", () => {
  it.each([undefined, "https://public.example.test"])("matches the server checksum with reporting URL %s", async (instanceUrl) => {
    const root = await mkdtemp(join(tmpdir(), "skill-publish-"));
    const local = join(root, "local");
    const server = join(root, "server");
    const skillId = "733fd021-274c-48ac-a843-95ee78b47759";
    const api = createServer((req, res) => {
      req.resume();
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/auth/whoami") res.end(JSON.stringify({ userId: "test", email: "test@example.test", org: { org_id: "org-test" } }));
      else if (req.url === "/v1/skills" && req.method === "POST") res.end(published);
      else { res.statusCode = 404; res.end("{}"); }
    });
    let published = "";
    try {
      for (const dir of [local, server]) {
        await mkdir(dir);
        await writeFile(join(dir, "SKILL.md"), "---\nname: demo\ndescription: Demo skill\n---\n\n# Demo\nRead the code.\n");
      }
      await saveLockfile(root, emptyLockfile());
      await prepareSkillDirForPublish(server, { skillId, version: "1.0.0", instanceUrl });
      const canonical = await packDir(server);
      published = JSON.stringify({ id: skillId, checksum: canonical.checksum, sizeBytes: canonical.sizeBytes, usage_instance_url: instanceUrl });
      await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
      const address = api.address();
      if (!(address instanceof Object)) throw new Error("Missing HTTP listener");
      const apiUrl = `http://127.0.0.1:${address.port}`;
      const config = join(root, "config");
      await mkdir(config);
      await writeFile(join(config, "session.json"), JSON.stringify({ cookie: "session=test" }));
      await execFileAsync(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../index.ts", import.meta.url)), "skills", "push", local, "--json"], {
        env: { ...process.env, COMPANION_HOME: config, COMPANION_API_URL: apiUrl },
      });
      expect((await packDir(local)).checksum).toBe(canonical.checksum);
      expect((await loadLockfile(root)).skills.demo?.checksum).toBe(canonical.checksum);
      const text = await readFile(join(local, "SKILL.md"), "utf8");
      expect(text.includes("skillpack:usage:start")).toBe(Boolean(instanceUrl));
      if (instanceUrl) expect(text).toContain(`${instanceUrl}/v1/skill-usage`);
      expect(text).not.toContain(apiUrl);
    } finally {
      api.closeAllConnections();
      await new Promise<void>((resolve) => api.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });
});
