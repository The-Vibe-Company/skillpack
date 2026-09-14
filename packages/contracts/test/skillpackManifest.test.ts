import { describe, expect, it } from "vitest";
import {
  COMPANION_MANIFEST_SCHEMA_URL,
  skillpackDependencySlugs,
  skillpackEnvironmentToRequirements,
  skillpackManifestJson,
  skillpackManifestSchema,
  fallbackSkillpackManifest,
  SKILL_ICONS,
} from "../src/skillpackManifest";
import { skillpackManifestV2JsonSchema } from "../src/skillpackManifestJsonSchema";

describe("skillpackManifestSchema", () => {
  it("parses manifest v2 fields", () => {
    const parsed = skillpackManifestSchema.parse({
      $schema: COMPANION_MANIFEST_SCHEMA_URL,
      name: "incident-summary",
      version: "1.2.0",
      icon: "bot",
      title: "Incident summary",
      description: "Generate clean incident handoffs from raw notes.",
      notes: "## Notes\n\nMarkdown notes.",
      metadata: {
        companionSkillId: "84d8bee1-5ad3-4676-8c16-730e2a15ba70",
        changelog: [{ version: "1.2.0", date: "2026-06-24", changes: ["Ship manifest v2."] }],
      },
      environment: {
        env: { OPENAI_BASE_URL: { required: false, description: "Optional gateway." } },
        secrets: {
          OPENAI_API_KEY: {
            slotId: "df80d275-30c9-5f0d-9a46-d77e6fca8448",
            required: true,
            description: "Ask an admin.",
          },
        },
      },
      database: {
        tables: {
          processed_tickets: {
            audience: "organization",
            columns: { ticket_id: { type: "text", nullable: false } },
            primary_key: ["ticket_id"],
          },
        },
      },
      dependencies: { "markdown-report": "84d8bee1-5ad3-4676-8c16-730e2a15ba70" },
      commands: [{ name: "Publish", desc: "Publish safely." }],
      checks: { updates: { runtime: "python", script: "scripts/check_updates.py", timeoutSeconds: 30 } },
    });

    expect(parsed.name).toBe("incident-summary");
    expect(parsed.version).toBe("1.2.0");
    expect(parsed.icon).toBe("bot");
    expect(parsed.metadata.companionSkillId).toBe("84d8bee1-5ad3-4676-8c16-730e2a15ba70");
    expect(skillpackDependencySlugs(parsed)).toEqual(["markdown-report"]);
    expect(skillpackEnvironmentToRequirements(parsed.environment).map((r) => r.key)).toEqual([
      "OPENAI_API_KEY",
      "OPENAI_BASE_URL",
    ]);
    expect(skillpackEnvironmentToRequirements(parsed.environment)[0]?.slot_id).toBe(
      "df80d275-30c9-5f0d-9a46-d77e6fca8448",
    );
    expect(parsed.notes).toBe("## Notes\n\nMarkdown notes.");
    expect(parsed.database.tables.processed_tickets?.primary_key).toEqual(["ticket_id"]);
    expect(parsed.display.summary).toBe("Generate clean incident handoffs from raw notes.");
    expect(skillpackManifestJson(parsed)).toMatchObject({
      icon: "bot",
      database: { tables: { processed_tickets: { audience: "organization" } } },
      checks: { updates: { runtime: "python", script: "scripts/check_updates.py", timeoutSeconds: 30 } },
    });
    expect(parsed.display.description).toBeUndefined();
  });

  it("accepts legacy display, requirements, and dependency arrays for migration", () => {
    const parsed = skillpackManifestSchema.parse({
      display: {
        name: "Incident summary",
        summary: "Generate clean incident handoffs from raw notes.",
        description: "Longer human-readable description shown in Skillpack.",
      },
      requirements: [{ key: "OPENAI_API_KEY", type: "secret", required: true, note: "Ask an admin." }],
      dependencies: ["markdown-report", { slug: "log-parser" }, "markdown-report"],
    });

    expect(parsed.title).toBe("Incident summary");
    expect(parsed.notes).toBe("Longer human-readable description shown in Skillpack.");
    expect(parsed.display.description).toBe("Longer human-readable description shown in Skillpack.");
    expect(parsed.requirements).toEqual([{ key: "OPENAI_API_KEY", type: "secret", required: true, note: "Ask an admin." }]);
    expect(parsed.dependencies).toEqual({});
    expect(parsed.legacyDependencySlugs).toEqual(["log-parser", "markdown-report"]);
    expect(skillpackDependencySlugs(parsed)).toEqual(["log-parser", "markdown-report"]);
  });

  it("rejects duplicate legacy requirement keys and invalid dependency names", () => {
    expect(() =>
      skillpackManifestSchema.parse({
        requirements: [{ key: "DUP" }, { key: "DUP" }],
      }),
    ).toThrow(/duplicate requirement key/);

    expect(() => skillpackManifestSchema.parse({ dependencies: ["Not A Slug"] })).toThrow(/dependency slug/);
    expect(() => skillpackManifestSchema.parse({ dependencies: { "markdown-report": "" } })).toThrow(/UUID/);
    expect(() =>
      skillpackManifestSchema.parse({
        dependencies: Object.fromEntries(
          Array.from({ length: 65 }, (_, i) => [`dep-${i}`, "84d8bee1-5ad3-4676-8c16-730e2a15ba70"]),
        ),
      }),
    ).toThrow(/64 dependencies/);
  });

  it("accepts only the curated skill icon catalog", () => {
    expect(skillpackManifestSchema.parse({ icon: "sparkles" }).icon).toBe("sparkles");
    expect(() => skillpackManifestSchema.parse({ icon: "trash-2" })).toThrow();
    expect((skillpackManifestV2JsonSchema.properties.icon as { enum: string[] }).enum).toEqual(SKILL_ICONS);
  });

  it("rejects unsafe local update check declarations", () => {
    expect(() =>
      skillpackManifestSchema.parse({
        checks: { updates: { runtime: "node", script: "scripts/check_updates.py" } },
      }),
    ).toThrow();
    expect(() =>
      skillpackManifestSchema.parse({
        checks: { updates: { runtime: "python", script: "/tmp/check.py" } },
      }),
    ).toThrow(/relative/);
    expect(() =>
      skillpackManifestSchema.parse({
        checks: { updates: { runtime: "python", script: "../check.py" } },
      }),
    ).toThrow(/dot-dot/);
    expect(() =>
      skillpackManifestSchema.parse({
        checks: { updates: { runtime: "python", script: "scripts\\check.py" } },
      }),
    ).toThrow(/forward slashes/);
  });

  it("rejects secret values and missing changelog for v2 versions", () => {
    expect(() =>
      skillpackManifestSchema.parse({
        $schema: COMPANION_MANIFEST_SCHEMA_URL,
        name: "bad",
        version: "1.0.0",
        description: "Bad manifest.",
        metadata: { changelog: [] },
      }),
    ).toThrow(/changelog/);

    expect(() =>
      skillpackManifestSchema.parse({
        environment: {
          env: {},
          secrets: {
            API_KEY: { required: true, description: "Never store values.", value: "secret" },
          },
        },
      }),
    ).toThrow(/must not include values/);
  });

  it("builds a fallback manifest from SKILL.md data", () => {
    const manifest = fallbackSkillpackManifest({
      summary: "Fallback summary.",
      icon: "terminal",
      requirements: [{ key: "SOME_TOKEN", type: "secret", required: true, note: "" }],
    });

    expect(manifest.description).toBe("Fallback summary.");
    expect(manifest.icon).toBe("terminal");
    expect(manifest.requirements.map((r) => r.key)).toEqual(["SOME_TOKEN"]);
    expect(manifest.dependencies).toEqual({});
  });

  it("preserves database declarations through fallback reconstruction and JSON serialization", () => {
    const manifest = fallbackSkillpackManifest({
      summary: "Keeps state.",
      database: {
        tables: {
          member_state: {
            audience: "personal",
            columns: { key: { type: "text", nullable: false }, value: { type: "json", nullable: true } },
            primary_key: ["key"],
            unique: [],
          },
        },
      },
    });

    expect(skillpackManifestSchema.parse(skillpackManifestJson(manifest)).database).toEqual(manifest.database);
  });

  it("documents and enforces database constraint references beyond static JSON Schema", () => {
    expect(() => skillpackManifestSchema.parse({
      database: {
        tables: {
          notes: {
            columns: { id: { type: "integer" } },
            primary_key: ["missing"],
          },
        },
      },
    })).toThrow(/constraint references undeclared column/);
    const table = skillpackManifestV2JsonSchema.$defs.databaseTable.properties;
    expect(table.primary_key.description).toContain("semantic enforcement");
    expect(table.unique.description).toContain("semantic enforcement");
  });
});
