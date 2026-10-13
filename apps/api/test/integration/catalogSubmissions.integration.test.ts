import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDatabase, schema, type Db } from "@skillpack/db";
import postgres from "postgres";
import {
  applyValidatedSubmission, getPublicCatalogSkill, getSkillPublicListing,
  requestSkillPublicListing, setSkillPublicListing,
} from "@skillpack/core";
import { archiveSkill, clearSkillPublicVersion, setSkillPublicVersion } from "@skillpack/core/services";
import { createIntegrationFixture, integrationDb, integrationSql, seedSkill, type IntegrationFixture, type SeededSkill } from "./testDatabase";

process.env.COMPANION_BILLING_MODE = "off";
const checksum = `sha256:${"a".repeat(64)}`;
const files = [{ path: "SKILL.md", size_bytes: 128 }];

describe("catalog submissions", () => {
  let fixture: IntegrationFixture;
  beforeAll(async () => { fixture = await createIntegrationFixture(); });
  afterAll(async () => { await fixture.cleanup(); });

  async function release() {
    const skill = await seedSkill({ orgId: fixture.orgA, creator: fixture.owner,
      slug: `submission-${randomUUID().slice(0, 8)}`, scope: "org" });
    await setSkillPublicVersion({ actor: fixture.owner, orgId: fixture.orgA, slug: skill.slug,
      version: "1.0.0", packageChecksum: checksum, packageSizeBytes: 256, packageFiles: files, database: integrationDb });
    return skill;
  }
  const input = (skill: SeededSkill, actor = fixture.owner) => ({ actor, orgId: skill.orgId, slug: skill.slug, database: integrationDb });
  async function submission(id: string) {
    return integrationDb.query.catalogSubmissions.findFirst({ where: and(eq(schema.catalogSubmissions.orgId, fixture.orgA), eq(schema.catalogSubmissions.id, id)) });
  }
  async function catalog(skill: SeededSkill) {
    return getPublicCatalogSkill({ orgSlug: `integration-a-${fixture.suffix}`, skillSlug: skill.slug, database: integrationDb });
  }
  async function validate(id: string) {
    await applyValidatedSubmission({ orgId: fixture.orgA, submissionId: id, decidedBy: fixture.owner.id, database: integrationDb });
  }

  it("Owner/Admin proposals freeze release metadata and become visible only through validation", async () => {
    for (const actor of [fixture.owner, fixture.admin]) {
      const skill = await release();
      const result = await setSkillPublicListing({ ...input(skill, actor), listed: true });
      expect(result).toMatchObject({ listed_publicly: false, listed_at: null, latest_submission: { status: "proposed", kind: "submission" }, can_manage_listing: true });
      const id = result.latest_submission!.id;
      expect(await submission(id)).toMatchObject({ skillVersionId: skill.versionId, packageChecksum: checksum, packageSizeBytes: 256, packageFiles: files, submittedBy: actor.id, requestedBy: null });
      expect(await catalog(skill)).toBeNull();
      expect(await setSkillPublicListing({ ...input(skill, actor), listed: true })).toMatchObject({ changed: false, latest_submission: { id } });
      await validate(id);
      expect(await catalog(skill)).toMatchObject({ version: "1.0.0", checksum, files });
      expect(await submission(id)).toMatchObject({ status: "validated", decidedBy: fixture.owner.id, decidedAt: expect.any(Date) });
      expect(JSON.stringify(await getSkillPublicListing(input(skill, fixture.developer)))).not.toContain("share_token");
    }
  });

  it("Developer requests require admin submission, preserve requester, and audit each transition", async () => {
    const skill = await release();
    await expect(setSkillPublicListing({ ...input(skill, fixture.developer), listed: true })).rejects.toThrow("Owner/Admin");
    await expect(setSkillPublicListing({ ...input(skill, fixture.developer), listed: false })).rejects.toThrow("Owner/Admin");
    const request = await requestSkillPublicListing(input(skill, fixture.developer));
    const id = request.latest_submission!.id;
    expect(request).toMatchObject({ listed_publicly: false, latest_submission: { kind: "publish_request", status: "proposed" }, can_manage_listing: false });
    expect(await submission(id)).toMatchObject({ requestedBy: fixture.developer.id, submittedBy: null });
    expect(await requestSkillPublicListing(input(skill, fixture.developer))).toMatchObject({ changed: false, latest_submission: { id } });
    await expect(validate(id)).rejects.toThrow("active proposed submission");
    const submitted = await setSkillPublicListing({ ...input(skill, fixture.admin), listed: true });
    expect(submitted.latest_submission).toEqual({ id, kind: "submission", status: "proposed" });
    expect(await submission(id)).toMatchObject({ requestedBy: fixture.developer.id, submittedBy: fixture.admin.id });
    expect(await catalog(skill)).toBeNull();
    await validate(id);
    await setSkillPublicListing({ ...input(skill), listed: false });
    const next = await setSkillPublicListing({ ...input(skill), listed: true });
    await setSkillPublicListing({ ...input(skill), listed: false });
    expect(await submission(next.latest_submission!.id)).toMatchObject({ status: "withdrawn" });
    const auditRows = await integrationDb.select().from(schema.auditLog).where(eq(schema.auditLog.orgId, fixture.orgA));
    const transitions = auditRows.filter(row => row.targetId === id).map(row => row.action);
    expect(transitions).toHaveLength(3);
    expect(transitions).toEqual(expect.arrayContaining([
      "catalog_submission.requested", "catalog_submission.submitted", "catalog_submission.validated",
    ]));
    expect(auditRows.some(row => row.targetId === next.latest_submission!.id && row.action === "catalog_submission.withdrawn")).toBe(true);
    expect(auditRows.filter(row => row.targetId === skill.id).map(row => row.action)).toEqual(expect.arrayContaining(["skill.public_listing.set", "skill.public_listing.clear"]));
  });

  it("fences cross-tenant access, non-members, revoked authority, and personal privacy", async () => {
    const skill = await release();
    for (const operation of [getSkillPublicListing, requestSkillPublicListing, (value: ReturnType<typeof input>) => setSkillPublicListing({ ...value, listed: true })]) {
      await expect(operation(input(skill, fixture.outsider))).rejects.toThrow("not a member");
      await expect(operation({ ...input(skill, fixture.outsider), orgId: fixture.orgB })).rejects.toThrow("skill not found");
    }
    for (const actor of [fixture.owner, fixture.admin]) await expect(requestSkillPublicListing(input(skill, actor))).rejects.toThrow("only a Developer");
    const personal = await seedSkill({ orgId: fixture.orgA, creator: fixture.developer, slug: `personal-submission-${randomUUID().slice(0, 8)}`, scope: "personal" });
    for (const actor of [fixture.owner, fixture.admin, fixture.developer]) {
      for (const operation of [getSkillPublicListing, requestSkillPublicListing]) await expect(operation(input(personal, actor))).rejects.toThrow(actor.id === fixture.developer.id ? "personal skill" : "skill not found");
    }
    await integrationDb.delete(schema.memberships).where(and(eq(schema.memberships.orgId, fixture.orgA), eq(schema.memberships.userId, fixture.developer.id)));
    try {
      await expect(getSkillPublicListing(input(skill, fixture.developer))).rejects.toThrow("not a member");
      await expect(requestSkillPublicListing(input(skill, fixture.developer))).rejects.toThrow("not a member");
    } finally {
      await integrationDb.insert(schema.memberships).values({ orgId: fixture.orgA, userId: fixture.developer.id, orgRole: "developer" });
    }
  });

  it("keeps validated content while a newer release is proposed and atomically replaces it on validation", async () => {
    const skill = await release();
    const first = await setSkillPublicListing({ ...input(skill), listed: true });
    await validate(first.latest_submission!.id);
    const nextVersionId = randomUUID();
    await integrationDb.insert(schema.skillVersions).values({ id: nextVersionId, orgId: fixture.orgA, skillId: skill.id,
      version: "2.0.0", frontmatter: JSON.stringify({ name: skill.slug, description: "New release" }), body: "New body",
      sizeBytes: 150, checksum: `sha256:${"b".repeat(64)}`, storagePath: "integration/new.tar.gz", createdBy: fixture.owner.id });
    await integrationDb.update(schema.skills).set({ currentVersionId: nextVersionId }).where(and(eq(schema.skills.orgId, fixture.orgA), eq(schema.skills.id, skill.id)));
    const nextChecksum = `sha256:${"b".repeat(64)}`;
    // Even promotion without file metadata must preserve the frozen catalog version.
    await setSkillPublicVersion({ ...input(skill), version: "2.0.0", packageChecksum: nextChecksum, packageSizeBytes: 300 });
    expect(await catalog(skill)).toMatchObject({ version: "1.0.0", checksum, files });
    const second = await setSkillPublicListing({ ...input(skill), listed: true, packageFiles: [{ path: "SKILL.md", size_bytes: 150 }] });
    expect(second).toMatchObject({ listed_publicly: true, latest_submission: { status: "proposed" } });
    expect(await catalog(skill)).toMatchObject({ version: "1.0.0", checksum, files });
    await validate(second.latest_submission!.id);
    expect(await catalog(skill)).toMatchObject({ version: "2.0.0", checksum: nextChecksum, body: "New body", files: [{ path: "SKILL.md", size_bytes: 150 }] });
    await expect(validate(first.latest_submission!.id)).rejects.toThrow("active proposed submission");
  });

  it("unlisting, release withdrawal, and archive prevent pending submissions from resurrecting listings", async () => {
    for (const action of ["unlist", "release", "archive"]) {
      const skill = await release();
      const proposed = await setSkillPublicListing({ ...input(skill), listed: true });
      const before = await integrationDb.query.skills.findFirst({ where: eq(schema.skills.id, skill.id) });
      if (action === "unlist") await setSkillPublicListing({ ...input(skill), listed: false });
      if (action === "release") await clearSkillPublicVersion(input(skill));
      if (action === "archive") await archiveSkill(input(skill));
      expect(await submission(proposed.latest_submission!.id)).toMatchObject({ status: "withdrawn" });
      await expect(validate(proposed.latest_submission!.id)).rejects.toThrow("active proposed submission");
      const after = await integrationDb.query.skills.findFirst({ where: eq(schema.skills.id, skill.id) });
      expect(after?.listedPublicly).toBe(false);
      expect(after?.shareToken).toBe(before?.shareToken);
      if (action === "unlist") expect(after?.publicVersionId).toBe(skill.versionId);
    }
  });

  it("reports a rejected latest submission and permits a fresh proposal", async () => {
    const skill = await release();
    const proposed = await setSkillPublicListing({ ...input(skill), listed: true });
    // Fixture only: moderator API/rejection transition belongs to PR 4.
    await integrationDb.update(schema.catalogSubmissions).set({ status: "rejected", decidedBy: fixture.owner.id,
      decidedAt: new Date(), rejectionReason: "Unsupported license" }).where(eq(schema.catalogSubmissions.id, proposed.latest_submission!.id));
    expect(await getSkillPublicListing(input(skill))).toMatchObject({ rejection_reason: "Unsupported license", latest_submission: { status: "rejected" } });
    const next = await setSkillPublicListing({ ...input(skill), listed: true });
    expect(next.latest_submission?.id).not.toBe(proposed.latest_submission!.id);
    expect(next.rejection_reason).toBeNull();
  });

  it("audits immediate release withdrawal even when validation commits while withdrawal waits", async () => {
    const skill = await release();
    const proposed = await setSkillPublicListing({ ...input(skill), listed: true });
    const applicationName = `catalog-withdraw-race-${randomUUID()}`;
    const connection = postgres(process.env.DATABASE_URL!, { max: 1, connection: { application_name: applicationName } });
    let clearing: ReturnType<typeof clearSkillPublicVersion> | undefined;
    try {
      await integrationDb.transaction(async tx => {
        await tx.select().from(schema.skills).where(and(eq(schema.skills.orgId, fixture.orgA), eq(schema.skills.id, skill.id))).for("update");
        clearing = clearSkillPublicVersion({ ...input(skill), database: createDatabase(connection) });
        let waiting = false;
        for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
          const [activity] = await integrationSql<{ waiting: boolean }[]>`
            select exists(select 1 from pg_stat_activity where application_name = ${applicationName}
              and wait_event_type = 'Lock') as waiting`;
          waiting = activity?.waiting ?? false;
          if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
        }
        if (!waiting) throw new Error("withdrawal never waited on the locked skill");
        const transactionDatabase: unknown = tx;
        // SAFETY: the transaction exposes the same schema/query contract as Db.
        const database = transactionDatabase as Db;
        await applyValidatedSubmission({ orgId: fixture.orgA, submissionId: proposed.latest_submission!.id,
          decidedBy: fixture.owner.id, database });
      });
      await clearing;
      expect(await catalog(skill)).toBeNull();
      const auditRows = await integrationDb.select().from(schema.auditLog).where(and(
        eq(schema.auditLog.orgId, fixture.orgA), eq(schema.auditLog.targetId, skill.id),
      ));
      expect(auditRows.map(row => row.action)).toEqual(expect.arrayContaining(["skill.public_listing.set", "skill.public_listing.clear"]));
    } finally {
      await clearing?.catch(() => undefined);
      await connection.end({ timeout: 1 });
    }
  });

  it("serializes concurrent proposals and enforces unique open submissions, tenant FKs, and RLS", async () => {
    const skill = await release();
    const results = await Promise.all([fixture.owner, fixture.admin].map(actor => setSkillPublicListing({ ...input(skill, actor), listed: true })));
    expect(new Set(results.map(result => result.latest_submission!.id)).size).toBe(1);
    const snapshot = { orgId: fixture.orgA, skillId: skill.id, skillVersionId: skill.versionId, packageChecksum: checksum,
      packageSizeBytes: 256, packageFiles: files, kind: "submission" as const, submittedBy: fixture.owner.id };
    await expect(integrationDb.insert(schema.catalogSubmissions).values(snapshot)).rejects.toThrow();
    const other = await seedSkill({ orgId: fixture.orgB, creator: fixture.outsider, slug: `foreign-${randomUUID().slice(0, 8)}`, scope: "org" });
    await expect(integrationDb.insert(schema.catalogSubmissions).values({ ...snapshot, status: "withdrawn", skillVersionId: other.versionId })).rejects.toThrow();
    await integrationSql.begin(async tx => {
      await tx`set local role companion_api`;
      await tx`select set_config('app.org_id', ${fixture.orgB}, true), set_config('app.user_id', ${fixture.outsider.id}, true)`;
      expect(await tx`select id from public.catalog_submissions where org_id = ${fixture.orgA}`).toHaveLength(0);
    });
    await expect(integrationSql.begin(async tx => {
      await tx`set local role companion_api`;
      await tx`select set_config('app.org_id', ${fixture.orgB}, true), set_config('app.user_id', ${fixture.outsider.id}, true)`;
      await tx`insert into public.catalog_submissions (org_id, skill_id, skill_version_id, package_checksum, package_size_bytes, package_files, kind, submitted_by)
        values (${fixture.orgA}, ${skill.id}, ${skill.versionId}, ${checksum}, 256, '[]'::jsonb, 'submission', ${fixture.owner.id})`;
    })).rejects.toThrow("row-level security");
    await integrationSql.begin(async tx => {
      await tx`set local role companion_api`;
      await tx`select set_config('app.org_id', ${fixture.orgA}, true), set_config('app.user_id', ${fixture.owner.id}, true)`;
      expect(await tx`select id from public.catalog_submissions where skill_id = ${skill.id}`).toHaveLength(1);
    });
  });
});
