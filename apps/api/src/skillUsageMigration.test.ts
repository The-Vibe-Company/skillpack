import { describe, expect, it } from "vitest";
import { runtimeMigrationConfiguration } from "./skillUsageMigration";

describe("release usage migration configuration", () => {
  it("requires an explicit organization, actor and public origin together", () => {
    expect(runtimeMigrationConfiguration({})).toBeNull();
    expect(() => runtimeMigrationConfiguration({ SKILLPACK_USAGE_MIGRATION_ORG_ID: "org" })).toThrow(/together/);
    const configured = { SKILLPACK_USAGE_MIGRATION_ORG_ID: "org", SKILLPACK_USAGE_MIGRATION_ACTOR_ID: "actor", SKILLPACK_USAGE_MIGRATION_ORIGIN: "https://skills.example.test" };
    expect(runtimeMigrationConfiguration(configured)).toEqual({ orgId: "org", actorId: "actor", origin: "https://skills.example.test" });
    expect(() => runtimeMigrationConfiguration({ ...configured, SKILLPACK_USAGE_MIGRATION_ORIGIN: "https://user:secret@skills.example.test" })).toThrow();
    expect(() => runtimeMigrationConfiguration({ ...configured, SKILLPACK_USAGE_MIGRATION_ORIGIN: "http://skills.example.test" })).toThrow();
  });
});
