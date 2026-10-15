import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@skillpack/db";
import { issueApiToken, revokeApiToken } from "@skillpack/core/services";
import { zipSync, strToU8 } from "fflate";
import { validateSkillArchive } from "@skillpack/skills";
import { createIntegrationFixture, integrationDb, seedSkill, type IntegrationFixture } from "./testDatabase";

/** Protect the CLI's --share-org boundary through the real existing publishing API. */
describe("GitHub snapshot organization publishing", () => {
  let fixture: IntegrationFixture;
  let apiProcess: ChildProcess;
  let objectStorage: Server;
  let api: string;
  const archives = new Map<string, Buffer>();
  let ownerKey: Awaited<ReturnType<typeof issueApiToken>>;
  let developerKey: Awaited<ReturnType<typeof issueApiToken>>;
  let otherKey: Awaited<ReturnType<typeof issueApiToken>>;
  beforeAll(async () => {
    fixture = await createIntegrationFixture();
    objectStorage = createServer(async (request, response) => {
      const path = request.url ?? "/";
      if (request.method === "PUT") {
        if (archives.has(path) && request.headers["if-none-match"] === "*") { response.writeHead(412).end(); return; }
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        archives.set(path, Buffer.concat(chunks));
        response.writeHead(200, { etag: '"fixture"' }).end();
      } else if (request.method === "DELETE") { archives.delete(path); response.writeHead(204).end(); }
      else { response.writeHead(404).end(); }
    });
    objectStorage.listen(0, "127.0.0.1");
    await once(objectStorage, "listening");
    const storagePort = z.object({ port: z.number() }).parse(objectStorage.address()).port;
    const reservation = createServer();
    reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
    const apiPort = z.object({ port: z.number() }).parse(reservation.address()).port;
    await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
    api = `http://127.0.0.1:${apiPort}`;
    apiProcess = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
      cwd: process.cwd(), stdio: "ignore", env: {
        ...process.env, COMPANION_BILLING_MODE: "off", COMPANION_API_HOST: "127.0.0.1", COMPANION_API_PORT: String(apiPort),
        BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), BETTER_AUTH_URL: api, COMPANION_API_URL: api,
        S3_ENDPOINT: `http://127.0.0.1:${storagePort}`, S3_ACCESS_KEY_ID: randomBytes(16).toString("hex"), S3_SECRET_ACCESS_KEY: randomBytes(32).toString("hex"), S3_FORCE_PATH_STYLE: "true",
      },
    });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await fetch(`${api}/health`, { signal: AbortSignal.timeout(200) }); ready = true; break; } catch { await delay(50); }
    }
    if (!ready) throw new Error("isolated API failed to start");
    ownerKey = await issueApiToken({ actor: fixture.owner, orgId: fixture.orgA, database: integrationDb });
    developerKey = await issueApiToken({ actor: fixture.developer, orgId: fixture.orgA, database: integrationDb });
    otherKey = await issueApiToken({ actor: fixture.outsider, orgId: fixture.orgB, database: integrationDb });
  });
  afterAll(async () => {
    if (apiProcess && apiProcess.exitCode === null) { apiProcess.kill(); await once(apiProcess, "exit"); }
    if (objectStorage) { objectStorage.closeAllConnections(); await new Promise<void>((resolve) => objectStorage.close(() => resolve())); }
    if (fixture) await fixture.cleanup();
  });
  async function publish(slug: string, key: string, orgId = fixture.orgA) {
    const archive = Buffer.from(zipSync({ "SKILL.md": strToU8(`---\nname: ${slug}\ndescription: Public GitHub fixture\nlicense: MIT\nmetadata:\n  github_repository: acme/skills\n  github_path: review\n  github_ref: main\n  github_commit: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n---\nReview the code.\n`) }));
    const headers = new Headers({ "x-companion-org": orgId, "content-type": "application/zip" });
    if (key) headers.set("authorization", `Bearer ${key}`);
    return fetch(`${api}/v1/skills?action=publish&scope=org&expect_slug=${slug}`, {
      method: "POST", headers, body: new Uint8Array(archive),
    });
  }
  it("normalizes a new immutable org copy while retaining upstream license and provenance", async () => {
    const slug = `github-${fixture.suffix}`;
    const response = await publish(slug, developerKey.token);
    expect(response.status).toBe(200);
    const published = z.object({ ok: z.boolean(), slug: z.string(), version: z.string(), id: z.string() }).parse(await response.json());
    expect(published).toMatchObject({ ok: true, slug, version: "1.0.0" });
    const row = await integrationDb.query.skills.findFirst({ where: and(eq(schema.skills.orgId, fixture.orgA), eq(schema.skills.slug, slug)) });
    expect(row).toMatchObject({ scope: "org", creatorId: fixture.developer.id });
    const validation = await validateSkillArchive([...archives.values()].at(-1)!);
    expect(validation.ok).toBe(true);
    expect(validation.frontmatter).toMatchObject({ license: "MIT", metadata: { github_repository: "acme/skills", github_commit: "a".repeat(40) } });
    expect(validation.companion_manifest?.metadata.companionSkillId).toBe(published.id);
    // A race after the CLI's absence check cannot silently create a new version.
    const retry = await publish(slug, developerKey.token);
    expect(retry.status).toBeGreaterThanOrEqual(400);
    expect(await integrationDb.query.skillVersions.findMany({ where: and(eq(schema.skillVersions.orgId, fixture.orgA), eq(schema.skillVersions.skillId, published.id)) })).toHaveLength(1);
  });
  it("rejects anonymous callers and binds publication to the token tenant despite a different org header", async () => {
    const slug = `github-denied-${fixture.suffix}`;
    const before = archives.size;
    const response = await publish(slug, "");
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(archives.size).toBe(before);
    const other = await publish(slug, otherKey.token);
    expect(other.status).toBe(200);
    expect(await integrationDb.query.skills.findMany({ where: and(eq(schema.skills.slug, slug), eq(schema.skills.orgId, fixture.orgA)) })).toHaveLength(0);
    expect(await integrationDb.query.skills.findMany({ where: and(eq(schema.skills.slug, slug), eq(schema.skills.orgId, fixture.orgB)) })).toHaveLength(1);
  });
  it("refuses a private slug collision without sharing or modifying the owner's skill", async () => {
    const slug = `github-private-${fixture.suffix}`;
    const personal = await seedSkill({ orgId: fixture.orgA, creator: fixture.owner, slug, scope: "personal" });
    const response = await publish(slug, developerKey.token);
    expect(response.status).toBeGreaterThanOrEqual(400);
    const row = await integrationDb.query.skills.findFirst({ where: eq(schema.skills.id, personal.id) });
    expect(row).toMatchObject({ scope: "personal", creatorId: fixture.owner.id, currentVersionId: personal.versionId });
  });
  it("rechecks removed membership and revoked authority on publication", async () => {
    await integrationDb.delete(schema.memberships).where(and(eq(schema.memberships.orgId, fixture.orgA), eq(schema.memberships.userId, fixture.developer.id)));
    const removed = await publish(`github-removed-${fixture.suffix}`, developerKey.token);
    expect(removed.status).toBeGreaterThanOrEqual(400);
    await revokeApiToken({ actor: fixture.owner, orgId: fixture.orgA, tokenId: ownerKey.id, database: integrationDb });
    const revoked = await publish(`github-revoked-${fixture.suffix}`, ownerKey.token);
    expect(revoked.status).toBeGreaterThanOrEqual(400);
  });
});
