/** Proves anonymous append-only collection and tenant/private reads under real NOBYPASSRLS roles.
 * Dropping the scope policy, membership check, definer grants, or expiry filter breaks this suite. */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { schema, withTenantContextOn } from "@skillpack/db";
import { expireSkillUsage, getSkillUsage, reportSkillUsage } from "@skillpack/core";
import { extractRuntimeRoleGrantBlock, resolveRuntimeRoleGrantsFile } from "../../src/migrate";
import { readFile } from "node:fs/promises";
import { createIntegrationFixture, integrationDb, integrationSql, seedSkill, type IntegrationFixture, type TestActor } from "./testDatabase";

const suffix = randomUUID().replaceAll("-", "");
const apiRole = `usage_api_${suffix}`;
const workerRole = `usage_worker_${suffix}`;
const runtimeRole = `usage_runtime_${suffix}`;
const adminUrl = process.env.DATABASE_URL!;
const apiUrl = new URL(adminUrl); apiUrl.username = apiRole; apiUrl.password = "usage-test";
const workerUrl = new URL(adminUrl); workerUrl.username = workerRole; workerUrl.password = "usage-test";
const apiSql = postgres(apiUrl.toString(), { max: 2 });
const workerSql = postgres(workerUrl.toString(), { max: 1 });
const apiDb = drizzle(apiSql, { schema });
const workerDb = drizzle(workerSql, { schema });
let fixture: IntegrationFixture;
let orgSkill: Awaited<ReturnType<typeof seedSkill>>;
let privateSkill: Awaited<ReturnType<typeof seedSkill>>;
const event = (skillId: string) => ({ event_id: randomUUID(), skill_id: skillId, version: "1.0.0" });
const usage = (actor: TestActor, skill: typeof orgSkill, orgId = fixture.orgA) =>
  withTenantContextOn(apiDb, { orgId, userId: actor.id }, (database) => getSkillUsage({ actor, orgId, slug: skill.slug, database }));

beforeAll(async () => {
  fixture = await createIntegrationFixture();
  await integrationSql.unsafe(`create role ${apiRole} login password 'usage-test' nosuperuser nobypassrls noinherit;
    create role ${workerRole} login password 'usage-test' nosuperuser nobypassrls noinherit;
    create role ${runtimeRole} login password 'usage-test' nosuperuser nobypassrls noinherit;`);
  const grants = extractRuntimeRoleGrantBlock(await readFile(await resolveRuntimeRoleGrantsFile(), "utf8"));
  await integrationSql.begin(async (tx) => {
    await tx`select set_config('companion.api_role', ${apiRole}, true), set_config('companion.worker_role', ${workerRole}, true), set_config('companion.companion_runtime_role', ${runtimeRole}, true)`;
    await tx.unsafe(grants);
  });
  orgSkill = await seedSkill({ orgId: fixture.orgA, creator: fixture.owner, slug: `usage-org-${fixture.suffix}`, scope: "org" });
  privateSkill = await seedSkill({ orgId: fixture.orgA, creator: fixture.owner, slug: `usage-private-${fixture.suffix}`, scope: "personal" });
});
afterAll(async () => {
  await apiSql.end(); await workerSql.end();
  await fixture?.cleanup();
  for (const role of [apiRole, workerRole, runtimeRole]) {
    await integrationSql.unsafe(`drop owned by ${role}; drop role ${role};`);
  }
});

describe("skill usage boundary", () => {
  it("accepts unauthenticated anonymous and identified reports, ignores unknown versions, and deduplicates", async () => {
    const first = event(orgSkill.id);
    await reportSkillUsage(first, apiDb);
    await reportSkillUsage(first, apiDb);
    await reportSkillUsage({ ...event(orgSkill.id), agent: "pi", environment: "sandbox", identity: { email: "Bot@example.test", source: "git-local" } }, apiDb);
    await reportSkillUsage(event(randomUUID()), apiDb);
    await reportSkillUsage({ ...event(orgSkill.id), version: "99.0.0" }, apiDb);
    const result = await usage(fixture.developer, orgSkill);
    expect(result?.total).toBe(2);
    expect(result?.anonymous).toBe(1);
    expect(result?.identities).toEqual([{ email: "bot@example.test", user_id: null, source: "git-local", count: 1 }]);
    expect(result?.agents).toContainEqual({ label: "pi", count: 1 });
  });
  it("hides personal usage from administrators and non-members, including direct RLS reads", async () => {
    await reportSkillUsage(event(privateSkill.id), apiDb);
    expect((await usage(fixture.owner, privateSkill))?.total).toBe(1);
    expect(await usage(fixture.admin, privateSkill)).toBeNull();
    expect(await usage(fixture.outsider, privateSkill, fixture.orgB)).toBeNull();
    await expect(usage(fixture.outsider, privateSkill)).rejects.toThrow();
    for (const actor of [fixture.admin, fixture.outsider]) {
      const rows = await withTenantContextOn(apiDb, { orgId: fixture.orgA, userId: actor.id }, (database) =>
        database.select().from(schema.skillUsageEvents).where(eq(schema.skillUsageEvents.skillId, privateSkill.id)));
      expect(rows).toEqual([]);
    }
    expect(await apiDb.select().from(schema.skillUsageEvents)).toEqual([]);
  });
  it("immediately rejects a removed member", async () => {
    await integrationDb.delete(schema.memberships).where(and(eq(schema.memberships.orgId, fixture.orgA), eq(schema.memberships.userId, fixture.developer.id)));
    await expect(usage(fixture.developer, orgSkill)).rejects.toThrow();
  });
  it("expires data and gives cleanup only to the worker, without direct event access", async () => {
    const old = event(orgSkill.id);
    await reportSkillUsage(old, apiDb);
    await integrationDb.update(schema.skillUsageEvents).set({ receivedAt: new Date(Date.now() - 91 * 86400_000) }).where(eq(schema.skillUsageEvents.eventId, old.event_id));
    expect((await usage(fixture.owner, orgSkill))?.total).toBe(2);
    await expect(expireSkillUsage(apiDb)).rejects.toThrow();
    await expect(reportSkillUsage(event(orgSkill.id), workerDb)).rejects.toThrow();
    await expect(workerDb.select().from(schema.skillUsageEvents)).rejects.toThrow();
    expect(await expireSkillUsage(workerDb)).toBeGreaterThanOrEqual(1);
    expect(await integrationDb.select().from(schema.skillUsageEvents).where(eq(schema.skillUsageEvents.eventId, old.event_id))).toEqual([]);
    await expect(apiDb.execute(sql`delete from skill_usage_events`)).rejects.toThrow();
  });
  it("caps intake per skill across independent connections", async () => {
    const limited = await seedSkill({ orgId: fixture.orgA, creator: fixture.owner, slug: `limited-${fixture.suffix}`, scope: "org" });
    await Promise.all(Array.from({ length: 125 }, () => reportSkillUsage(event(limited.id), apiDb)));
    expect((await usage(fixture.owner, limited))?.total).toBe(120);
  });
});
