import { createHash, randomBytes } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveApiToken } from "@skillpack/core/services";
import { registerCliLoginRoutes } from "../../src/cliLoginRoutes";
import type { ApiVariables } from "../../src/context";
import { createIntegrationFixture, integrationSql, type IntegrationFixture } from "./testDatabase";

describe("CLI browser approval with real database and token authority", () => {
  let fixture: IntegrationFixture;
  beforeAll(async () => { fixture = await createIntegrationFixture(); });
  afterAll(async () => { if (fixture) await fixture.cleanup(); await integrationSql.end(); });

  it("binds approval to membership and a private one-time verifier", async () => {
    const app = new Hono<{ Variables: ApiVariables }>();
    app.use("*", async (c, next) => {
      const who = c.req.header("x-test-user");
      const identity = who === "owner" ? fixture.owner : who === "outsider" ? fixture.outsider : null;
      c.set("user", identity ? { ...identity, emailVerified: true, createdAt: new Date(), updatedAt: new Date(), image: null } : null);
      c.set("programmaticAuthKind", null);
      await next();
    });
    registerCliLoginRoutes(app);
    const id = randomBytes(32).toString("hex");
    const verifier = randomBytes(32).toString("hex");
    const hash = createHash("sha256").update(verifier).digest("hex");
    const post = (path: string, body: Record<string, string>, who?: string) => {
      const headers = new Headers({ "content-type": "application/json", origin: "http://127.0.0.1:3000" });
      if (who) headers.set("x-test-user", who);
      return app.request(path, { method: "POST", headers, body: JSON.stringify(body) });
    };

    const started = await post("/v1/cli-login/start", { request_id: id, verifier_hash: hash });
    expect(started.status).toBe(200);
    const startBody = z.object({ verification_uri: z.string() }).parse(await started.json());
    expect(startBody.verification_uri).toContain(id);
    expect(startBody.verification_uri).not.toContain(verifier);

    const wrongProof = await post("/v1/cli-login/poll", { request_id: id, verifier: "f".repeat(64) });
    expect(wrongProof.status).toBe(404);
    const deniedOrg = await post("/v1/cli-login/decision", { request_id: id, decision: "approve", workspace_id: fixture.orgA }, "outsider");
    expect(deniedOrg.status).toBe(403);
    const approved = await post("/v1/cli-login/decision", { request_id: id, decision: "approve", workspace_id: fixture.orgA }, "owner");
    expect(approved.status).toBe(200);
    expect(JSON.stringify(await approved.json())).not.toContain("cmp_pat_");

    const redeemed = await post("/v1/cli-login/poll", { request_id: id, verifier });
    expect(redeemed.status).toBe(200);
    const body = z.object({ status: z.string(), token: z.string() }).parse(await redeemed.json());
    expect(body.status).toBe("approved");
    expect(body.token).toMatch(/^cmp_pat_/);
    const resolved = await resolveApiToken(body.token);
    expect(resolved?.orgId).toBe(fixture.orgA);
    expect(resolved?.actor.id).toBe(fixture.owner.id);
    expect(resolved?.scopes).toContain("database:write");
    expect((await post("/v1/cli-login/poll", { request_id: id, verifier })).status).toBe(404);
  });
});
