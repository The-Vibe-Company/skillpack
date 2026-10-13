import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { createDatabase, schema, withTenantContextOn } from "@skillpack/db";
import postgres from "postgres";
import {
  autoApproveCatalogSubmission, configureCatalogCheckReader, listCatalogSubmissions, moderateCatalog,
  getPublicCatalogSkill, requestSkillPublicListing, setSkillPublicListing, type CatalogCheckReader,
} from "@skillpack/core";
import { setSkillPublicVersion } from "@skillpack/core/services";
import { createCatalogModerationRoutes } from "../../src/catalogModerationRoutes";
import type { ApiVariables } from "../../src/context";
import { createIntegrationFixture, integrationDb, integrationSql, seedSkill, type IntegrationFixture } from "./testDatabase";

const passed: CatalogCheckReader = async ({ database: _database, ...identity }) => ({ ...identity, status: "passed", reason: null });
const failed: CatalogCheckReader = async ({ database: _database, ...identity }) => ({ ...identity, status: "failed", reason: "Only MIT and Apache-2.0 are accepted" });

describe("platform catalog moderation", () => {
  let fixture: IntegrationFixture;
  beforeEach(async () => {
    fixture = await createIntegrationFixture();
    vi.stubEnv("SKILLPACK_PUBLIC_CATALOG", "true");
    vi.stubEnv("SKILLPACK_CATALOG_MODERATOR_USER_IDS", "");
    vi.stubEnv("SKILLPACK_CATALOG_AUTO_APPROVE_ORG_IDS", "");
    await integrationDb.insert(schema.platformModerators).values({ userId: fixture.outsider.id });
    configureCatalogCheckReader(async () => null);
  });
  afterEach(async () => {
    configureCatalogCheckReader(async () => null);
    vi.unstubAllEnvs();
    await fixture.cleanup();
  });
  async function proposal() {
    const skill = await seedSkill({ orgId: fixture.orgA, creator: fixture.owner, scope: "org", slug: `moderation-${randomUUID().slice(0, 8)}` });
    await setSkillPublicVersion({ actor: fixture.owner, orgId: fixture.orgA, slug: skill.slug, version: "1.0.0",
      packageChecksum: `sha256:${"a".repeat(64)}`, packageSizeBytes: 256, packageFiles: [{ path: "SKILL.md", size_bytes: 128 }], database: integrationDb });
    const result = await setSkillPublicListing({ actor: fixture.owner, orgId: fixture.orgA, slug: skill.slug, listed: true, database: integrationDb });
    return { skill, submissionId: result.latest_submission!.id };
  }
  const decision = (submissionId: string) => ({ actorId: fixture.outsider.id, orgId: fixture.orgA, submissionId, database: integrationDb });
  async function status(submissionId: string) {
    return integrationDb.query.catalogSubmissions.findFirst({ where: and(eq(schema.catalogSubmissions.orgId, fixture.orgA), eq(schema.catalogSubmissions.id, submissionId)) });
  }
  function routes(actor = fixture.owner, authMode: "session" | "pat" | "agent" | "anonymous" = "session") {
    const app = new Hono<{ Variables: ApiVariables }>();
    app.use("*", async (c, next) => {
      // The external session identity is the only mocked boundary; authorization uses PostgreSQL.
      if (authMode === "session") c.set("user", { ...actor, emailVerified: true, createdAt: new Date(), updatedAt: new Date(), image: null });
      if (authMode === "pat" || authMode === "agent") {
        c.set("tokenActor", actor);
        c.set("programmaticAuthKind", authMode);
      }
      await next();
    });
    app.route("/", createCatalogModerationRoutes({ database: integrationDb }));
    return app;
  }
  function path(submissionId: string, action: string) {
    return `/v1/platform/catalog/organizations/${fixture.orgA}/submissions/${submissionId}/${action}`;
  }

  it("returns 403 for every org role, permits a platform moderator without tenant membership, and rechecks revocation", async () => {
    const { submissionId } = await proposal();
    for (const actor of [fixture.owner, fixture.admin, fixture.developer]) {
      const app = routes(actor);
      expect((await app.request("/v1/platform/catalog/submissions")).status).toBe(403);
      for (const action of ["validate", "reject", "remove"]) {
        expect((await app.request(path(submissionId, action), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "review" }) })).status).toBe(403);
      }
      expect((await app.request(`/v1/platform/catalog/organizations/${fixture.orgA}/ban`, { method: "POST", body: '{"reason":"review"}' })).status).toBe(403);
    }
    expect((await routes(fixture.outsider).request("/v1/platform/catalog/submissions")).status).toBe(200);
    for (const mode of ["pat", "agent"] as const) expect((await routes(fixture.outsider, mode).request("/v1/platform/catalog/submissions")).status).toBe(403);
    expect((await routes(fixture.outsider, "anonymous").request("/v1/platform/catalog/submissions")).status).toBe(401);
    await integrationDb.delete(schema.platformModerators).where(eq(schema.platformModerators.userId, fixture.outsider.id));
    expect((await routes(fixture.outsider).request("/v1/platform/catalog/submissions")).status).toBe(403);
    vi.stubEnv("SKILLPACK_CATALOG_MODERATOR_USER_IDS", fixture.outsider.id);
    expect((await routes(fixture.outsider).request("/v1/platform/catalog/submissions")).status).toBe(200);
    vi.stubEnv("SKILLPACK_PUBLIC_CATALOG", "false");
    expect((await routes(fixture.outsider).request("/v1/platform/catalog/submissions")).status).toBe(404);
    await expect(moderateCatalog({ ...decision(submissionId), action: "validate", checks: passed })).rejects.toMatchObject({ status: 404 });
  });

  it("requires passing checks for the exact frozen identity, reflects failures, and audits validation and rejection", async () => {
    const { skill, submissionId } = await proposal();
    await expect(moderateCatalog({ ...decision(submissionId), action: "validate" })).rejects.toMatchObject({ status: 409 });
    expect((await routes(fixture.outsider).request(path(submissionId, "validate"), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(409);
    expect((await routes(fixture.outsider).request(path(submissionId, "reject"), { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"reason":" "}' })).status).toBe(400);
    await expect(moderateCatalog({ ...decision(submissionId), action: "validate", checks: failed })).rejects.toMatchObject({ status: 409 });
    const stale: CatalogCheckReader = async input => ({ ...(await passed(input))!, packageChecksum: `sha256:${"b".repeat(64)}` });
    await expect(moderateCatalog({ ...decision(submissionId), action: "validate", checks: stale })).rejects.toMatchObject({ status: 409 });
    const changing: CatalogCheckReader = async input => {
      await integrationDb.update(schema.catalogSubmissions).set({ packageChecksum: `sha256:${"b".repeat(64)}` })
        .where(and(eq(schema.catalogSubmissions.orgId, fixture.orgA), eq(schema.catalogSubmissions.id, submissionId)));
      return passed(input);
    };
    await expect(moderateCatalog({ ...decision(submissionId), action: "validate", checks: changing })).rejects.toMatchObject({ status: 409 });
    await integrationDb.update(schema.catalogSubmissions).set({ packageChecksum: `sha256:${"a".repeat(64)}` })
      .where(and(eq(schema.catalogSubmissions.orgId, fixture.orgA), eq(schema.catalogSubmissions.id, submissionId)));
    const queue = await listCatalogSubmissions({ actorId: fixture.outsider.id, database: integrationDb, checks: failed });
    expect(queue.find(row => row.id === submissionId)).toMatchObject({ status: "proposed", check_status: "failed", check_reason: "Only MIT and Apache-2.0 are accepted" });
    expect(JSON.stringify(queue)).not.toMatch(/share_token|storage_path|email/);
    await expect(moderateCatalog({ ...decision(submissionId), orgId: fixture.orgB, action: "validate", checks: passed })).rejects.toMatchObject({ status: 404 });
    configureCatalogCheckReader(passed);
    expect((await routes(fixture.outsider).request(path(submissionId, "validate"), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(200);
    configureCatalogCheckReader(async () => null);
    expect(await status(submissionId)).toMatchObject({ status: "validated", decidedBy: fixture.outsider.id });
    expect(await getPublicCatalogSkill({ orgSlug: `integration-a-${fixture.suffix}`, skillSlug: skill.slug, database: integrationDb })).not.toBeNull();
    await expect(moderateCatalog({ ...decision(submissionId), action: "reject", reason: "late" })).rejects.toMatchObject({ status: 409 });
    const next = await setSkillPublicListing({ actor: fixture.owner, orgId: fixture.orgA, slug: skill.slug, listed: true, database: integrationDb });
    await expect(moderateCatalog({ ...decision(next.latest_submission!.id), action: "reject", reason: " " })).rejects.toThrow();
    await moderateCatalog({ ...decision(next.latest_submission!.id), action: "reject", reason: "Unsupported license" });
    expect(await status(next.latest_submission!.id)).toMatchObject({ status: "rejected", rejectionReason: "Unsupported license" });
    const audits = await integrationDb.select().from(schema.auditLog).where(eq(schema.auditLog.orgId, fixture.orgA));
    expect(audits.map(row => row.action)).toEqual(expect.arrayContaining(["catalog_submission.validated", "catalog_submission.rejected", "skill.public_listing.set"]));
  });

  it("removes a published skill, closes pending candidates, retains its release, and cannot resurrect it", async () => {
    const { skill, submissionId } = await proposal();
    await moderateCatalog({ ...decision(submissionId), action: "validate", checks: passed });
    const pending = await setSkillPublicListing({ actor: fixture.owner, orgId: fixture.orgA, slug: skill.slug, listed: true, database: integrationDb });
    await moderateCatalog({ ...decision(submissionId), action: "remove", reason: "Unsafe instructions" });
    expect(await status(submissionId)).toMatchObject({ status: "removed", rejectionReason: "Unsafe instructions" });
    expect(await status(pending.latest_submission!.id)).toMatchObject({ status: "rejected" });
    const row = await integrationDb.query.skills.findFirst({ where: eq(schema.skills.id, skill.id) });
    expect(row).toMatchObject({ listedPublicly: false, listedAt: null, publicVersionId: skill.versionId, shareToken: expect.any(String) });
    await expect(moderateCatalog({ ...decision(pending.latest_submission!.id), action: "validate", checks: passed })).rejects.toMatchObject({ status: 409 });
    expect((await listCatalogSubmissions({ actorId: fixture.outsider.id, status: "removed", database: integrationDb })).some(value => value.id === submissionId)).toBe(true);
  });

  it("bans publishing atomically, unlists org skills, rejects proposals, and prevents new submissions", async () => {
    const first = await proposal();
    const second = await proposal();
    await moderateCatalog({ ...decision(first.submissionId), action: "validate", checks: passed });
    await moderateCatalog({ actorId: fixture.outsider.id, orgId: fixture.orgA, action: "ban", reason: "Publishing abuse", database: integrationDb });
    expect(await status(first.submissionId)).toMatchObject({ status: "removed" });
    expect(await status(second.submissionId)).toMatchObject({ status: "rejected" });
    await expect(setSkillPublicListing({ actor: fixture.owner, orgId: fixture.orgA, slug: second.skill.slug, listed: true, database: integrationDb })).rejects.toThrow("banned");
    await expect(moderateCatalog({ ...decision(second.submissionId), action: "validate", checks: passed })).rejects.toMatchObject({ status: 409 });
    expect(await autoApproveCatalogSubmission({ orgId: fixture.orgA, submissionId: second.submissionId, checks: passed, database: integrationDb })).toBe(false);
    const audits = await integrationDb.select().from(schema.auditLog).where(eq(schema.auditLog.orgId, fixture.orgA));
    expect(audits.map(row => row.action)).toEqual(expect.arrayContaining(["organization.catalog_publishing.banned", "catalog_submission.removed", "catalog_submission.rejected", "skill.public_listing.clear"]));
  });

  it("auto-validates only allowlisted organizations after a matching pass, including report callbacks and existing reports", async () => {
    const first = await proposal();
    expect(await autoApproveCatalogSubmission({ orgId: fixture.orgA, submissionId: first.submissionId, checks: passed, database: integrationDb })).toBe(false);
    await integrationDb.insert(schema.catalogPublishingPolicies).values({ orgId: fixture.orgA, autoApprove: true })
      .onConflictDoUpdate({ target: schema.catalogPublishingPolicies.orgId, set: { autoApprove: true } });
    expect(await autoApproveCatalogSubmission({ orgId: fixture.orgA, submissionId: first.submissionId, database: integrationDb })).toBe(false);
    expect(await autoApproveCatalogSubmission({ orgId: fixture.orgA, submissionId: first.submissionId, checks: failed, database: integrationDb })).toBe(false);
    const revoked: CatalogCheckReader = async input => {
      await integrationDb.update(schema.catalogPublishingPolicies).set({ autoApprove: false }).where(eq(schema.catalogPublishingPolicies.orgId, fixture.orgA));
      return passed(input);
    };
    expect(await autoApproveCatalogSubmission({ orgId: fixture.orgA, submissionId: first.submissionId, checks: revoked, database: integrationDb })).toBe(false);
    expect(await status(first.submissionId)).toMatchObject({ status: "proposed" });
    await integrationDb.update(schema.catalogPublishingPolicies).set({ autoApprove: true }).where(eq(schema.catalogPublishingPolicies.orgId, fixture.orgA));
    expect(await autoApproveCatalogSubmission({ orgId: fixture.orgA, submissionId: first.submissionId, checks: passed, database: integrationDb })).toBe(true);
    expect(await autoApproveCatalogSubmission({ orgId: fixture.orgA, submissionId: first.submissionId, checks: passed, database: integrationDb })).toBe(false);
    configureCatalogCheckReader(passed);
    const next = await proposal();
    expect(await status(next.submissionId)).toMatchObject({ status: "validated" });
    await integrationDb.update(schema.catalogPublishingPolicies).set({ autoApprove: false }).where(eq(schema.catalogPublishingPolicies.orgId, fixture.orgA));
    vi.stubEnv("SKILLPACK_CATALOG_AUTO_APPROVE_ORG_IDS", fixture.orgA);
    expect(await status((await proposal()).submissionId)).toMatchObject({ status: "validated" });
    const audits = await integrationDb.select().from(schema.auditLog).where(and(eq(schema.auditLog.orgId, fixture.orgA), eq(schema.auditLog.action, "catalog_submission.validated")));
    for (const row of audits) expect(row.metadata).toMatchObject({ automatic: true });
  });

  it("excludes personal skills and developer requests even when checks pass", async () => {
    const { skill } = await proposal();
    await setSkillPublicListing({ actor: fixture.owner, orgId: fixture.orgA, slug: skill.slug, listed: false, database: integrationDb });
    const request = await requestSkillPublicListing({ actor: fixture.developer, orgId: fixture.orgA, slug: skill.slug, database: integrationDb });
    vi.stubEnv("SKILLPACK_CATALOG_AUTO_APPROVE_ORG_IDS", fixture.orgA);
    expect(await autoApproveCatalogSubmission({ orgId: fixture.orgA, submissionId: request.latest_submission!.id, checks: passed, database: integrationDb })).toBe(false);
    await expect(moderateCatalog({ ...decision(request.latest_submission!.id), action: "validate", checks: passed })).rejects.toMatchObject({ status: 409 });
    const personal = await seedSkill({ orgId: fixture.orgA, creator: fixture.developer, scope: "personal", slug: `private-${randomUUID().slice(0, 8)}` });
    // Deliberately inconsistent operator fixture proves the platform projection also excludes private rows.
    const [row] = await integrationDb.insert(schema.catalogSubmissions).values({ orgId: fixture.orgA, skillId: personal.id,
      skillVersionId: personal.versionId, packageChecksum: `sha256:${"a".repeat(64)}`, packageSizeBytes: 256,
      packageFiles: [], kind: "submission", submittedBy: fixture.developer.id }).returning();
    const queue = await listCatalogSubmissions({ actorId: fixture.outsider.id, database: integrationDb, checks: passed });
    expect(queue.some(value => value.id === row!.id || value.id === request.latest_submission!.id)).toBe(false);
    await expect(moderateCatalog({ ...decision(row!.id), action: "validate", checks: passed })).rejects.toMatchObject({ status: 409 });
  });

  it("uses API-only definer grants without giving runtime roles policy or moderator writes", async () => {
    const { submissionId } = await proposal();
    const runtimeUrl = new URL(process.env.DATABASE_URL!);
    runtimeUrl.username = "companion_api";
    runtimeUrl.password = "companion-api";
    const runtimeSql = postgres(runtimeUrl.toString(), { max: 1 });
    try {
      const database = createDatabase(runtimeSql);
      await moderateCatalog({ ...decision(submissionId), action: "validate", checks: passed, database });
      expect((await listCatalogSubmissions({ actorId: fixture.outsider.id, status: "validated", database })).some(value => value.id === submissionId)).toBe(true);
      await withTenantContextOn(database, { orgId: fixture.orgA, userId: fixture.owner.id }, async tenantDatabase => {
        await expect(setSkillPublicListing({ actor: fixture.owner, orgId: fixture.orgA, slug: "absent", listed: true, database: tenantDatabase })).rejects.toThrow("skill not found");
      });
    } finally { await runtimeSql.end({ timeout: 1 }); }
    for (const role of ["companion_api", "companion_worker"]) {
      await expect(integrationSql.begin(async tx => {
        if (role === "companion_api") await tx`set local role companion_api`;
        else await tx`set local role companion_worker`;
        await tx`insert into public.platform_moderators(user_id) values (${fixture.owner.id})`;
      })).rejects.toThrow("permission denied");
      await expect(integrationSql.begin(async tx => {
        if (role === "companion_api") await tx`set local role companion_api`;
        else await tx`set local role companion_worker`;
        await tx`update public.catalog_publishing_policies set banned = false where org_id = ${fixture.orgA}`;
      })).rejects.toThrow("permission denied");
    }
    await expect(integrationSql.begin(async tx => {
      await tx`set local role companion_worker`;
      await tx`select * from public.skillpack_catalog_moderation_queue(${fixture.outsider.id}, false, 'proposed', 20, 0)`;
    })).rejects.toThrow("permission denied");
  });
});
