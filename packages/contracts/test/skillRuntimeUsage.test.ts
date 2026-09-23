import { expect, it } from "vitest";
import { fallbackSkillpackManifest, skillpackManifestJson, skillRuntimeUsageSchema } from "../src/skillpackManifest";
import { skillpackManifestV2JsonSchema } from "../src/skillpackManifestJsonSchema";

it("publishes every generated metadata field in the portable JSON Schema", () => {
  const usage = skillRuntimeUsageSchema.parse({ schemaVersion: 1, skillId: "11111111-1111-4111-8111-111111111111",
    version: "1.2.4", origin: "https://skillpack.app", migration: { parentVersion: "1.2.3", parentChecksum: `sha256:${"a".repeat(64)}` } });
  const manifest = skillpackManifestJson(fallbackSkillpackManifest({ summary: "Example", name: "example", version: "1.2.4", usage }));
  expect(manifest.metadata?.usage).toEqual(usage);
  for (const field of Object.keys(manifest.metadata ?? {})) {
    expect(Object.keys(skillpackManifestV2JsonSchema.properties.metadata.properties)).toContain(field);
  }
  expect(() => skillRuntimeUsageSchema.parse({ ...usage, prompt: "must not enter metadata" })).toThrow();
  expect(() => skillRuntimeUsageSchema.parse({ ...usage, origin: "https://user:secret@skillpack.app" })).toThrow();
});
