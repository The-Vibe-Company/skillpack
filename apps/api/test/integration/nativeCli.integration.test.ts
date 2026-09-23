/**
 * Real-process acceptance: the same name-only API key publishes a package,
 * projects a required secret, and writes/reads the actual remote SQLite database.
 * Run against the isolated dev-conductor stack, never a shared deployment.
 */
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@skillpack/db";
import { issueApiToken, revokeApiToken } from "@skillpack/core/services";
import { createIntegrationFixture, integrationDb, integrationSql, type IntegrationFixture } from "./testDatabase";

const api = process.env.SKILLPACK_NATIVE_API_URL;
const binary = process.env.SKILLPACK_NATIVE_BINARY;

describe.runIf(Boolean(api && binary))("native CLI through real API and storage", () => {
  let fixture: IntegrationFixture;
  let directory: string;
  let token: Awaited<ReturnType<typeof issueApiToken>>;
  let env: NodeJS.ProcessEnv;
  const secret = "synthetic-integration-value";
  beforeAll(async () => {
    if (!api || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(api)) throw new Error("requires disposable loopback API");
    directory = await mkdtemp(join(tmpdir(), "skillpack-native-e2e-"));
    fixture = await createIntegrationFixture();
    token = await issueApiToken({ actor: fixture.owner, orgId: fixture.orgA, name: "Native acceptance", database: integrationDb });
    env = {
      PATH: join(directory, "empty-path"), HOME: directory,
      SKILLPACK_HOME: join(directory, "client"), SKILLPACK_RUNTIME_HOME: join(directory, "runtime"),
      SKILLPACK_LEGACY_HOME: join(directory, "legacy"), SKILLPACK_API_URL: api,
      SKILLPACK_API_KEY: token.token,
    };
  });
  afterAll(async () => {
    if (fixture) await fixture.cleanup();
    if (directory) await rm(directory, { recursive: true, force: true });
    await integrationSql.end();
  });
  type Input = { [key: string]: string | number | boolean | null | Array<string | number | boolean | null> };
  async function cli(args: string[], input?: Input, selected = env) {
    const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolveResult) => {
      const child = execFile(binary!, [...args, "--json"], { env: selected, timeout: 30_000 }, (error, stdout, stderr) => {
        resolveResult({ code: error ? Number(error.code) || 1 : 0, stdout, stderr });
      });
      child.stdin?.end(input === undefined ? undefined : JSON.stringify(input));
    });
    expect(result.stdout + result.stderr).not.toContain(token.token);
    expect(result.stdout + result.stderr).not.toContain(secret);
    return result;
  }
  async function ok(args: string[], input?: Input) {
    const result = await cli(args, input);
    if (result.code !== 0) throw new Error(`${args.slice(0, 2).join(" ")} failed (${result.code}): ${result.stderr}`);
    return JSON.parse(result.stdout);
  }
  it.runIf(Boolean(process.env.SKILLPACK_LEGACY_FIXTURE))("finishes the genuine 1.118.2 bootstrap after replacing its own folder", async () => {
    const legacyHome = join(directory, "legacy-user");
    const installed = join(legacyHome, ".codex", "skills", "skillpack");
    await cp(process.env.SKILLPACK_LEGACY_FIXTURE!, installed, { recursive: true });
    expect(JSON.parse(await readFile(join(installed, "companion.json"), "utf8")).version).toBe("1.118.2");
    const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolveResult) => {
      execFile(process.env.SKILLPACK_LEGACY_PYTHON || "python3", [join(installed, "scripts", "bootstrap.py"), "--json", "--auto-update-skillpack"], {
        cwd: legacyHome, timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, HOME: legacyHome, USERPROFILE: legacyHome,
          COMPANION_SKILL_DIR: installed, COMPANION_HOME: join(legacyHome, ".companion"),
          COMPANION_AUTH_MODE: "legacy-pat", COMPANION_API_URL: api + "/v1",
          COMPANION_TOKEN: token.token, COMPANION_WORKSPACE_ID: fixture.orgA,
          SKILLPACK_RUNTIME_HOME: join(legacyHome, "runtime"), CODEX_HOME: join(legacyHome, ".codex"),
          CLAUDE_CONFIG_DIR: join(legacyHome, ".claude"), OPENCODE_CONFIG_DIR: join(legacyHome, ".opencode"),
        },
      }, (error, stdout, stderr) => resolveResult({ code: error ? Number(error.code) || 1 : 0, stdout, stderr }));
    });
    expect(result.code).toBe(0);
    expect(result.stdout + result.stderr).not.toContain(token.token);
    const context = JSON.parse(result.stdout);
    expect(context.companion.autoUpdate.applied).toBe(true);
    expect(context.companion.localVersion).toBe("1.119.0");
    expect(context.errors).toEqual([]);
    expect(await readFile(join(installed, "scripts", "companion-agent-client.mjs"), "utf8")).toContain("node");
    const metadata = await ok(["api", "GET", "/v1/local-skills/skillpack"]);
    expect(metadata.installedVersion).toBe("1.119.0");
    const setup = await ok(["setup", "--tools", "codex,claude-code,opencode", "--project", directory]);
    expect(setup.hooks.codex).toBe("requires_host_approval");
  }, 150_000);
  it("uses one key for publication, projection, real SQLite and safe revocation with no interpreters in PATH", async () => {
    const slug = `native-${fixture.suffix}`;
    const folder = join(directory, slug);
    await mkdir(folder);
    await writeFile(join(folder, "SKILL.md"), `---\nname: ${slug}\ndescription: Native acceptance fixture\n---\nUse the declared state and secret.\n`);
    await writeFile(join(folder, "companion.json"), JSON.stringify({
      $schema: "https://skillpack.app/schemas/companion-manifest.v2.schema.json", name: slug, version: "1.0.0",
      description: "Native acceptance fixture", metadata: { changelog: [{ version: "1.0.0", changes: ["Initial fixture"] }] },
      environment: { env: {}, secrets: { TEST_KEY: { required: true, description: "Synthetic test credential" } } }, dependencies: {},
      database: { tables: { notes: { audience: "organization", columns: { id: { type: "integer", nullable: false }, body: { type: "text", nullable: false } }, primary_key: ["id"], unique: [] } } },
    }));
    const login = await new Promise<{ code: number; stdout: string; stderr: string }>((resolveResult) => {
      const child = execFile(binary!, ["auth", "login", "--api-url", api!, "--token-stdin", "--json"],
        { env, timeout: 30_000 }, (error, stdout, stderr) => resolveResult({ code: error ? Number(error.code) || 1 : 0, stdout, stderr }));
      child.stdin?.end(token.token + "\n");
    });
    expect(login.code).toBe(0);
    expect(login.stdout + login.stderr).not.toContain(token.token);
    // Subsequent processes must use the privately persisted profile, without an injected key.
    env = { ...env, SKILLPACK_API_KEY: "", SKILLPACK_API_URL: "" };
    const status = await ok(["auth", "status"]);
    expect(status.workspace.id).toBe(fixture.orgA);
    await ok(["skills", "validate", folder]);
    await ok(["skills", "publish", folder, "--scope", "org"]);
    const created = await ok(["secrets", "create", "--input", "-"], { name: "Native fixture", key: "TEST_KEY", value: secret, audience: "organization" });
    const configuration = await ok(["secrets", "configuration", slug]);
    const slot = configuration.slots.find((item: { key?: string; env_key?: string }) => (item.key ?? item.env_key) === "TEST_KEY");
    expect(slot).toBeTruthy();
    await ok(["secrets", "bind", slug, slot.slot_id, "--input", "-"], { secret_id: created.id });
    const project = join(directory, "project"); await mkdir(project);
    await ok(["install", slug, "--scope", "project", "--project", project, "--tools", "codex,claude-code,opencode"]);
    expect(await readFile(join(directory, "legacy", "secrets", fixture.orgA, slug, ".env"), "utf8")).toContain(`TEST_KEY="${secret}"`);
    await ok(["db", "execute", slug, "--input", "-"], { audience: "organization", sql: "INSERT INTO notes (id, body) VALUES (?, ?)", params: [7, "native round trip"] });
    const query = await ok(["db", "query", slug, "--input", "-"], { audience: "organization", sql: "SELECT id, body FROM notes WHERE id = ?", params: [7] });
    expect(JSON.stringify(query)).toContain("native round trip");
    expect(JSON.stringify(query)).toContain("7");
    const frozen = await cli(["sync", "--frozen", "--project", project], undefined, { ...env, SKILLPACK_API_KEY: "", SKILLPACK_API_URL: "" });
    expect(frozen.code).toBe(0);
    const manifestPath = join(folder, "companion.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.version = "1.0.1";
    manifest.metadata.changelog.unshift({ version: "1.0.1", changes: ["Native update verification"] });
    await writeFile(manifestPath, JSON.stringify(manifest));
    await ok(["skills", "publish", folder, "--scope", "org"]);
    await ok(["update", slug, "--scope", "project", "--project", project]);
    expect(JSON.parse(await readFile(join(project, ".agents", "skills", slug, "companion.json"), "utf8")).version).toBe("1.0.1");
    const pinnedProject = join(directory, "pinned-project"); await mkdir(pinnedProject);
    await ok(["install", slug, "--version", "1.0.0", "--scope", "project", "--project", pinnedProject]);
    const pinnedUpdate = await ok(["update", "--all", "--scope", "project", "--project", pinnedProject]);
    expect(pinnedUpdate.results[0].status).toBe("pinned");
    const modified = join(project, ".agents", "skills", slug, "SKILL.md");
    await writeFile(modified, "local customization");
    const conflict = await cli(["update", slug, "--scope", "project", "--project", project]);
    expect(conflict.code).not.toBe(0);
    expect(await readFile(modified, "utf8")).toBe("local customization");
    const limited = await issueApiToken({ actor: fixture.owner, orgId: fixture.orgA, scopes: ["skills:read"], database: integrationDb });
    const denied = await cli(["db", "query", slug, "--input", "-"], { sql: "SELECT * FROM notes", params: [] }, { ...env, SKILLPACK_API_KEY: limited.token });
    expect(denied.code).toBe(7);
    const otherOrg = await issueApiToken({ actor: fixture.outsider, orgId: fixture.orgB, database: integrationDb });
    const crossOrg = await cli(["db", "query", slug, "--input", "-"], { sql: "SELECT * FROM notes", params: [] }, { ...env, SKILLPACK_API_KEY: otherOrg.token });
    expect(crossOrg.code).toBe(4);
    const formerMember = await issueApiToken({ actor: fixture.developer, orgId: fixture.orgA, database: integrationDb });
    await integrationDb.delete(schema.memberships).where(and(eq(schema.memberships.orgId, fixture.orgA), eq(schema.memberships.userId, fixture.developer.id)));
    const removed = await cli(["auth", "status"], undefined, { ...env, SKILLPACK_API_KEY: formerMember.token });
    expect(removed.code).toBe(3);
    await revokeApiToken({ actor: fixture.owner, orgId: fixture.orgA, tokenId: token.id, database: integrationDb });
    expect((await cli(["auth", "status"])).code).toBe(3);
  }, 120_000);
});
