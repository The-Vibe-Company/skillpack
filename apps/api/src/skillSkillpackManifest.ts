import {
  skillpackDependencySlugs,
  skillpackManifestJson,
  skillpackManifestSchema,
  fallbackSkillpackManifest,
  type SkillpackDisplay,
  type SkillpackManifest,
  type SkillIcon,
  type SkillRequirement,
  type SkillDatabaseDeclaration,
} from "@skillpack/contracts";

export function uploadDependencyValues(input: {
  queryDependencies: string[];
  skillpackManifestPath: string | null | undefined;
  skillpackManifest?: SkillpackManifest;
}): string[] {
  if (input.skillpackManifestPath !== null && input.skillpackManifest) {
    return skillpackDependencySlugs(input.skillpackManifest);
  }
  return input.queryDependencies;
}

export function withResolvedManifestDependencies(
  manifest: SkillpackManifest,
  dependencies: string[] | Record<string, string>,
): SkillpackManifest {
  return skillpackManifestSchema.parse({
    ...skillpackManifestJson(manifest),
    dependencies,
  });
}

export function buildInlineSkillpackManifest(input: {
  description: string;
  carriedDisplay?: SkillpackDisplay | null;
  carriedNotes?: string | null;
  carriedIcon?: SkillIcon | null;
  carriedRequirements: SkillRequirement[];
  carriedDependencies: string[] | Record<string, string>;
  carriedDatabase?: SkillDatabaseDeclaration;
  name?: string;
  version?: string;
  companionSkillId?: string;
}): SkillpackManifest {
  const previousSummary = input.carriedDisplay?.summary?.trim();
  const previousDescription = input.carriedDisplay?.description?.trim();
  const hasRichDescription = previousDescription && previousDescription !== previousSummary;
  const carriedNotes = input.carriedNotes?.trim() || (hasRichDescription ? previousDescription : undefined);
  return fallbackSkillpackManifest({
    summary: input.description,
    display: {
      name: input.carriedDisplay?.name,
      summary: input.description,
    },
    notes: carriedNotes,
    requirements: input.carriedRequirements,
    dependencies: input.carriedDependencies,
    database: input.carriedDatabase,
    name: input.name,
    version: input.version,
    icon: input.carriedIcon ?? undefined,
    companionSkillId: input.companionSkillId,
    changelog: input.version
      ? [{ version: input.version, date: new Date().toISOString().slice(0, 10), changes: [`Publish version ${input.version}.`] }]
      : undefined,
  });
}
