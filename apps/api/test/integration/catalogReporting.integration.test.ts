import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import postgres from "postgres";
import { createDatabase, schema, withTenantContextOn } from "@skillpack/db";
import { applyValidatedSubmission, listCatalogReports, reportCatalogSkill, setSkillPublicListing } from "@skillpack/core";
import { setSkillPublicVersion } from "@skillpack/core/services";
import { createCatalogReportingRoutes } from "../../src/catalogReportingRoutes";
import { createCatalogModerationRoutes } from "../../src/catalogModerationRoutes";
import type { ApiVariables } from "../../src/context";
import { createIntegrationFixture, integrationDb, integrationSql, seedSkill, type IntegrationFixture } from "./testDatabase";

describe("catalog reports persistence and moderation privacy", () => {
  let fixture: IntegrationFixture;
  let skill: Awaited<ReturnType<typeof seedSkill>>;
  let submissionId: string;
  let source: string;
  let orgSlug: string;
  beforeEach(async () => {
    fixture = await createIntegrationFixture();
    vi.stubEnv("SKILLPACK_PUBLIC_CATALOG", "true");
    vi.stubEnv("SKILLPACK_CATALOG_MODERATOR_USER_IDS", "");
    source = randomUUID().replaceAll("-", "").repeat(2);
    orgSlug = `integration-a-${fixture.suffix}`;
    skill = await seedSkill({ orgId: fixture.orgA, creator: fixture.owner, scope: "org", slug: `report-${fixture.suffix}` });
    await setSkillPublicVersion({ actor: fixture.owner, orgId: fixture.orgA, slug: skill.slug, version: "1.0.0", packageChecksum: `sha256:${"a".repeat(64)}`, packageSizeBytes: 256, packageFiles: [{ path: "SKILL.md", size_bytes: 128 }], database: integrationDb });
    const proposal = await setSkillPublicListing({ actor: fixture.owner, orgId: fixture.orgA, slug: skill.slug, listed: true, database: integrationDb });
    submissionId = proposal.latest_submission!.id;
    await applyValidatedSubmission({ orgId: fixture.orgA, submissionId, decidedBy: fixture.owner.id, database: integrationDb });
    await integrationDb.insert(schema.platformModerators).values({ userId: fixture.outsider.id });
  });
  afterEach(async () => { vi.unstubAllEnvs(); await fixture.cleanup(); });
  const report = () => ({ orgSlug, skillSlug: skill.slug, reason: "spam" as const, reporterHash: source, database: integrationDb });
  function moderation(actor = fixture.owner, mode: "session" | "anonymous" | "pat" | "agent" = "session") {
    const app = new Hono<{ Variables: ApiVariables }>();
    app.use("*", async (c, next) => {
      if (mode === "session") c.set("user", { ...actor, emailVerified: true, createdAt: new Date(), updatedAt: new Date(), image: null });
      if (mode === "pat" || mode === "agent") { c.set("tokenActor", actor); c.set("programmaticAuthKind", mode); }
      await next();
    });
    app.route("/", createCatalogModerationRoutes({ database: integrationDb }));
    return app;
  }
  it("accepts anonymous reports and exposes the frozen target only to live platform moderators", async () => {
    const app = createCatalogReportingRoutes({ report: input => reportCatalogSkill({ ...input, database: integrationDb }), address: () => "192.0.2.8", secret: () => "x".repeat(32) });
    const response = await app.request(`/v1/public/catalog/skills/${orgSlug}/${skill.slug}/reports`, { method: "POST", body: '{"reason":"secret_exposure","details":"Please remove exposed credential"}' });
    expect(response.status).toBe(201);
    const queue = "/v1/platform/catalog/reports";
    for (const actor of [fixture.owner, fixture.admin, fixture.developer]) expect((await moderation(actor).request(queue)).status).toBe(403);
    expect((await moderation(fixture.outsider, "anonymous").request(queue)).status).toBe(401);
    for (const mode of ["pat", "agent"] as const) expect((await moderation(fixture.outsider, mode).request(queue)).status).toBe(403);
    const moderatorResponse = await moderation(fixture.outsider).request(queue);
    expect(moderatorResponse.status).toBe(200);
    expect(moderatorResponse.headers.get("Cache-Control")).toBe("no-store");
    const body = await moderatorResponse.json();
    expect(body).toMatchObject({ reports: expect.arrayContaining([expect.objectContaining({ org_id: fixture.orgA, skill_id: skill.id, submission_id: submissionId, org_slug: orgSlug, skill_slug: skill.slug, reason: "secret_exposure", details: "Please remove exposed credential", created_at: expect.any(String) })]) });
    expect(JSON.stringify(body)).not.toMatch(/reporter_hash|192\.0\.2|share_token/);
    await integrationDb.delete(schema.platformModerators).where(eq(schema.platformModerators.userId, fixture.outsider.id));
    expect((await moderation(fixture.outsider).request(queue)).status).toBe(403);
    await expect(listCatalogReports({ actorId: fixture.owner.id, database: integrationDb })).rejects.toMatchObject({ status: 403 });
    vi.stubEnv("SKILLPACK_PUBLIC_CATALOG", "false");
    expect((await moderation(fixture.outsider).request(queue)).status).toBe(404);
    expect((await app.request(`/v1/public/catalog/skills/${orgSlug}/${skill.slug}/reports`, { method: "POST", body: '{"reason":"spam"}' })).status).toBe(404);
  });
  it("enforces a durable five/hour quota under concurrent requests across skills and API instances", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => reportCatalogSkill(report())));
    expect(results.filter(result => result === "accepted")).toHaveLength(5);
    expect(results.filter(result => result === "rate_limited")).toHaveLength(5);
    expect(await reportCatalogSkill({ ...report(), reporterHash: "b".repeat(64) })).toBe("accepted");
    expect(await reportCatalogSkill({ ...report(), skillSlug: "different" })).toBe("rate_limited");
    await integrationDb.execute(sql`update public.catalog_reports set created_at = now() - interval '61 minutes' where reporter_hash = ${source}`);
    expect(await reportCatalogSkill(report())).toBe("accepted");
  });
  it("rejects invalid input and all non-public targets; reports survive unlisting for moderation", async () => {
    // SAFETY: deliberately violate the static reason union to verify the runtime validator rejects it.
    await expect(reportCatalogSkill({ ...report(), reason: "invalid" as "spam" })).rejects.toThrow();
    await expect(reportCatalogSkill({ ...report(), details: "x".repeat(2001) })).rejects.toThrow();
    expect(await reportCatalogSkill({ ...report(), orgSlug: `integration-b-${fixture.suffix}` })).toBe("not_found");
    expect(await reportCatalogSkill(report())).toBe("accepted");
    await setSkillPublicListing({ actor: fixture.owner, orgId: fixture.orgA, slug: skill.slug, listed: false, database: integrationDb });
    expect(await reportCatalogSkill(report())).toBe("not_found");
    expect((await listCatalogReports({ actorId: fixture.outsider.id, database: integrationDb })).some(row => row.submission_id === submissionId)).toBe(true);
    const personal = await seedSkill({ orgId: fixture.orgA, creator: fixture.developer, scope: "personal", slug: `personal-${fixture.suffix}` });
    expect(await reportCatalogSkill({ ...report(), skillSlug: personal.slug })).toBe("not_found");
  });
  it("restricts raw rows to the operator and functions to the API even with tenant context", async () => {
    const url = new URL(process.env.DATABASE_URL!);
    url.username = "companion_api"; url.password = "companion-api";
    const client = postgres(url.toString(), { max: 1 });
    try {
      const database = createDatabase(client);
      expect(await reportCatalogSkill({ ...report(), database })).toBe("accepted");
      expect((await listCatalogReports({ actorId: fixture.outsider.id, database })).some(row => row.submission_id === submissionId)).toBe(true);
      await expect(withTenantContextOn(database, { orgId: fixture.orgA, userId: fixture.owner.id }, tenant => tenant.select().from(schema.catalogReports))).rejects.toMatchObject({ cause: { code: "42501" } });
      await expect(database.execute(sql`select * from public.skillpack_catalog_report_queue(${fixture.owner.id}, false, 20, 0)`)).rejects.toMatchObject({ cause: { code: "42501" } });
    } finally { await client.end({ timeout: 1 }); }
    for (const role of ["companion_api", "companion_worker"]) {
      await expect(integrationSql.begin(async tx => {
        await tx.unsafe(`set local role ${role}`);
        await tx`select * from public.catalog_reports`;
      })).rejects.toThrow("permission denied");
    }
    await expect(integrationSql.begin(async tx => {
      await tx`set local role companion_worker`;
      await tx`select public.skillpack_report_catalog_skill(${orgSlug}, ${skill.slug}, 'spam', null, ${source})`;
    })).rejects.toThrow("permission denied");
  });
});
