import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@skillpack/db";
import { installSkill, listSkills } from "@skillpack/core/services";
import { createIntegrationFixture, integrationDb, seedSkill, type IntegrationFixture } from "./testDatabase";

// Real persisted install baselines must survive same-version artifact repairs and stale reports.
describe("installed checksum tracking", () => {
  let fixture: IntegrationFixture;
  beforeAll(async () => { fixture = await createIntegrationFixture(); });
  afterAll(async () => fixture.cleanup());

  it("retains stale baselines until the repaired artifact is explicitly reported", async () => {
    const skill = await seedSkill({ orgId: fixture.orgA, creator: fixture.owner,
      slug: `checksum-${fixture.suffix}`, scope: "org" });
    const input = { actor: fixture.owner, orgId: fixture.orgA, slug: skill.slug, database: integrationDb };
    const oldChecksum = `sha256:${"a".repeat(64)}`;
    const newChecksum = `sha256:${"b".repeat(64)}`;
    expect((await installSkill({ ...input, version: "1.0.0", checksum: oldChecksum, source: "agent" })).status).toBe("installed");
    await integrationDb.update(schema.skillVersions).set({ checksum: newChecksum })
      .where(and(eq(schema.skillVersions.orgId, fixture.orgA), eq(schema.skillVersions.id, skill.versionId)));
    const listed = await listSkills({ actor: fixture.owner, orgId: fixture.orgA, database: integrationDb });
    expect(listed.find(row => row.id === skill.id)?.install_status).toBe("update");
    expect((await installSkill({ ...input, version: "1.0.0", checksum: oldChecksum, source: "agent" })).status).toBe("update");
    expect((await installSkill({ ...input, version: "1.0.0", source: "agent" })).status).toBe("update");
    expect((await installSkill({ ...input, version: "1.0.0", checksum: newChecksum, source: "agent" })).status).toBe("installed");
    const [next] = await integrationDb.insert(schema.skillVersions).values({ orgId: fixture.orgA,
      skillId: skill.id, version: "2.0.0", frontmatter: "{}", sizeBytes: 1, checksum: `sha256:${"d".repeat(64)}`,
      storagePath: "fixture/v2.tar.gz", createdBy: fixture.owner.id }).returning();
    await integrationDb.update(schema.skills).set({ currentVersionId: next!.id }).where(eq(schema.skills.id, skill.id));
    expect((await installSkill({ ...input, version: "2.0.0", source: "agent" })).status).toBe("installed");
    const [reinstalled] = await integrationDb.select().from(schema.skillInstalls).where(eq(schema.skillInstalls.skillId, skill.id));
    expect(reinstalled?.installedChecksum).toBeNull();
    const otherMember = await listSkills({ actor: fixture.admin, orgId: fixture.orgA, database: integrationDb });
    expect(otherMember.find(row => row.id === skill.id)?.install_status).toBe("none");
    await expect(installSkill({ ...input, orgId: fixture.orgB })).rejects.toThrow("not a member of this organization");
  });

  it("snapshots a manual mark and keeps personal skills private", async () => {
    const skill = await seedSkill({ orgId: fixture.orgA, creator: fixture.owner,
      slug: `manual-checksum-${fixture.suffix}`, scope: "org" });
    const input = { actor: fixture.owner, orgId: fixture.orgA, slug: skill.slug, database: integrationDb };
    await installSkill(input);
    await integrationDb.update(schema.skillVersions).set({ checksum: `sha256:${"c".repeat(64)}` })
      .where(and(eq(schema.skillVersions.orgId, fixture.orgA), eq(schema.skillVersions.id, skill.versionId)));
    const listed = await listSkills({ actor: fixture.owner, orgId: fixture.orgA, database: integrationDb });
    expect(listed.find(row => row.id === skill.id)?.install_status).toBe("update");
    const personal = await seedSkill({ orgId: fixture.orgA, creator: fixture.owner,
      slug: `personal-checksum-${fixture.suffix}`, scope: "personal" });
    await expect(installSkill({ ...input, slug: personal.slug, actor: fixture.admin })).rejects.toThrow("skill not found");
  });
});
