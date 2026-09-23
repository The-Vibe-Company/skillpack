import { z } from "zod";
import { SEMVER_RE, SKILL_NAME_RE, SKILL_REQUIREMENT_KEY_RE, skillRequirementSchema, type SkillRequirement } from "./frontmatter";
import { skillDatabaseDeclarationSchema, type SkillDatabaseDeclaration } from "./skillDatabase";

export const COMPANION_MANIFEST_SCHEMA_URL = "https://skillpack.app/schemas/companion-manifest.v2.schema.json";

/**
 * Curated Lucide glyphs that a portable skill may use as its catalog icon. Control, navigation,
 * destructive-action, and transient-state glyphs stay out of this package-facing vocabulary.
 */
export const SKILL_ICONS = [
  "activity",
  "bookmark",
  "bot",
  "box",
  "boxes",
  "braces",
  "building-2",
  "calendar",
  "clock",
  "code",
  "cpu",
  "file",
  "file-code",
  "file-text",
  "flame",
  "globe",
  "hash",
  "heart",
  "image",
  "key",
  "layers",
  "mail",
  "megaphone",
  "message-square",
  "monitor",
  "package",
  "palette",
  "pen-tool",
  "plug-zap",
  "rocket",
  "shield",
  "sparkles",
  "square-stack",
  "star",
  "tag",
  "terminal",
  "users",
  "zap",
] as const;
export type SkillIcon = (typeof SKILL_ICONS)[number];
export const skillIconSchema = z.enum(SKILL_ICONS);

export const skillpackDisplaySchema = z
  .object({
    name: z.string().min(1, "display name must not be empty").max(120, "display name must be at most 120 characters").optional(),
    summary: z.string().min(1, "display summary must not be empty").max(1024, "display summary must be at most 1024 characters").optional(),
    description: z.string().min(1, "display description must not be empty").max(4000, "display description must be at most 4000 characters").optional(),
  })
  .strip()
  .default({});

export type SkillpackDisplay = z.infer<typeof skillpackDisplaySchema>;

export const skillpackEnvironmentDeclarationSchema = z
  .object({
    required: z.boolean().default(true),
    description: z.string().max(2000, "environment description must be at most 2000 characters").default(""),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    if ("value" in value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "environment declarations must not include values",
      });
    }
  })
  .transform((value) => ({
    required: value.required,
    description: value.description,
  }));

export type SkillpackEnvironmentDeclaration = z.infer<typeof skillpackEnvironmentDeclarationSchema>;

export type SkillpackSecretDeclaration = SkillpackEnvironmentDeclaration & { slotId?: string };

export const skillpackSecretDeclarationSchema = z
  .object({
    slotId: z.string().uuid("secret slotId must be a UUID").optional(),
    required: z.boolean().default(true),
    description: z.string().max(2000, "environment description must be at most 2000 characters").default(""),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    if ("value" in value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "environment declarations must not include values",
      });
    }
  })
  .transform((value): SkillpackSecretDeclaration => {
    const declaration: SkillpackSecretDeclaration = {
      required: value.required,
      description: value.description,
    };
    if (value.slotId) declaration.slotId = value.slotId;
    return declaration;
  });

const envDeclarationRecordSchema = z
  .record(
    z.string().regex(SKILL_REQUIREMENT_KEY_RE, "environment keys must look like environment variables"),
    skillpackEnvironmentDeclarationSchema,
  )
  .default({});

const secretDeclarationRecordSchema = z
  .record(
    z.string().regex(SKILL_REQUIREMENT_KEY_RE, "environment keys must look like environment variables"),
    skillpackSecretDeclarationSchema,
  )
  .default({});

export const skillpackEnvironmentSchema = z
  .object({
    env: envDeclarationRecordSchema,
    secrets: secretDeclarationRecordSchema,
  })
  .strip()
  .default({ env: {}, secrets: {} });

export type SkillpackEnvironment = z.infer<typeof skillpackEnvironmentSchema>;

export const skillpackChangelogEntrySchema = z
  .object({
    version: z.string().regex(SEMVER_RE, "changelog version must be valid semver"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "changelog date must be YYYY-MM-DD").optional(),
    changes: z.array(z.string().min(1).max(1000)).min(1, "changelog entry must include at least one change").max(50),
  })
  .strip();

export type SkillpackChangelogEntry = z.infer<typeof skillpackChangelogEntrySchema>;

export const skillRuntimeUsageSchema = z.object({
  schemaVersion: z.literal(1),
  skillId: z.string().uuid(),
  version: z.string().regex(SEMVER_RE),
  origin: z.string().url().regex(/^https?:\/\/[^/?#@]+$/, "usage origin must be an HTTP(S) origin without credentials"),
  migration: z.object({ parentVersion: z.string().regex(SEMVER_RE), parentChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).optional(),
}).strict();
export type SkillRuntimeUsage = z.infer<typeof skillRuntimeUsageSchema>;

export const skillpackMetadataSchema = z
  .object({
    companionSkillId: z.string().uuid("companionSkillId must be a UUID").optional(),
    usage: skillRuntimeUsageSchema.optional(),
    changelog: z.array(skillpackChangelogEntrySchema).max(200, "at most 200 changelog entries are allowed").default([]),
  })
  .strip()
  .default({ changelog: [] });

export type SkillpackMetadata = z.infer<typeof skillpackMetadataSchema>;

export const skillpackCommandSchema = z
  .object({
    name: z.string().min(1).max(120),
    desc: z.string().min(1).max(500),
  })
  .strip();

export type SkillpackCommand = z.infer<typeof skillpackCommandSchema>;

export const skillpackUpdateCheckSchema = z
  .object({
    runtime: z.literal("python"),
    script: z
      .string()
      .min(1, "check script path is required")
      .max(260, "check script path must be at most 260 characters")
      .refine((value) => !value.includes("\\"), "check script path must use forward slashes")
      .refine((value) => !value.startsWith("/"), "check script path must be relative")
      .refine((value) => !/^[a-zA-Z]:/.test(value), "check script path must be relative")
      .refine(
        (value) => value.split("/").every((segment) => segment && segment !== "." && segment !== ".."),
        "check script path must not contain empty, dot, or dot-dot segments",
      ),
    timeoutSeconds: z.number().int().min(1).max(300).default(30),
  })
  .strip();

export type SkillpackUpdateCheck = z.infer<typeof skillpackUpdateCheckSchema>;

export const skillpackChecksSchema = z
  .object({
    updates: skillpackUpdateCheckSchema.optional(),
  })
  .strip()
  .default({});

export type SkillpackChecks = z.infer<typeof skillpackChecksSchema>;

const legacyDependencySchema = z
  .union([
    z.string().regex(SKILL_NAME_RE, "dependency slug must be kebab-case"),
    z.object({ slug: z.string().regex(SKILL_NAME_RE, "dependency slug must be kebab-case") }).strip().transform((value) => value.slug),
  ]);

const dependencyMapSchema = z
  .record(
    z.string().regex(SKILL_NAME_RE, "dependency name must be kebab-case"),
    z.string().uuid("dependency id must be a UUID"),
  );

const legacyDependencyArraySchema = z
  .array(legacyDependencySchema)
  .transform((value) => [...new Set(value)].sort((a, b) => a.localeCompare(b)));

const skillpackDependenciesInputSchema = z
  .unknown()
  .default({})
  .superRefine((value, ctx) => {
    const parsed = Array.isArray(value) ? legacyDependencyArraySchema.safeParse(value) : dependencyMapSchema.safeParse(value);
    if (parsed.success) {
      const count = Array.isArray(parsed.data) ? parsed.data.length : Object.keys(parsed.data).length;
      if (count > 64) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "at most 64 dependencies are allowed",
        });
      }
      return;
    }
    for (const issue of parsed.error.issues) ctx.addIssue(issue);
  })
  .transform((value) => {
    const parsed = Array.isArray(value) ? legacyDependencyArraySchema.parse(value) : dependencyMapSchema.parse(value);
    if (Array.isArray(parsed)) return parsed;
    return Object.fromEntries(Object.entries(parsed).sort(([a], [b]) => a.localeCompare(b)));
  });

export type SkillpackDependencies = Record<string, string>;

function requirementsToEnvironment(requirements: SkillRequirement[] | undefined): SkillpackEnvironment {
  const env: Record<string, SkillpackEnvironmentDeclaration> = {};
  const secrets: Record<string, SkillpackSecretDeclaration> = {};
  for (const requirement of requirements ?? []) {
    const target = requirement.type === "env" ? env : secrets;
    const declaration = {
      slotId: requirement.type === "secret" ? requirement.slot_id : undefined,
      required: requirement.required,
      description: requirement.note,
    };
    target[requirement.key] = declaration;
  }
  return skillpackEnvironmentSchema.parse({ env, secrets });
}

export function skillpackEnvironmentToRequirements(environment: SkillpackEnvironment): SkillRequirement[] {
  return [
    ...Object.entries(environment.env).map(([key, value]) => ({
      key,
      type: "env" as const,
      required: value.required,
      note: value.description,
    })),
    ...Object.entries(environment.secrets).map(([key, value]) => ({
      key,
      type: "secret" as const,
      slot_id: value.slotId,
      required: value.required,
      note: value.description,
    })),
  ].sort((a, b) => a.key.localeCompare(b.key));
}

export const skillpackManifestSchema = z
  .object({
    $schema: z.string().url().optional(),
    name: z.string().regex(SKILL_NAME_RE, "name must be kebab-case").optional(),
    version: z.string().regex(SEMVER_RE, "version must be valid semver").optional(),
    icon: skillIconSchema.optional(),
    title: z.string().min(1).max(120).optional(),
    description: z.string().min(1).max(1024).optional(),
    notes: z.string().max(8000).optional(),
    metadata: skillpackMetadataSchema,
    environment: skillpackEnvironmentSchema,
    database: skillDatabaseDeclarationSchema,
    dependencies: skillpackDependenciesInputSchema,
    commands: z.array(skillpackCommandSchema).max(64, "at most 64 commands are allowed").default([]),
    checks: skillpackChecksSchema,
    /** Legacy v1 fields. Accepted for migration, never emitted by buildSkillpackManifestJson. */
    display: skillpackDisplaySchema.optional(),
    requirements: z.array(skillRequirementSchema).max(64, "at most 64 requirements are allowed").optional(),
  })
  .strip()
  .superRefine((value, ctx) => {
    const requirementKeys = new Set<string>();
    for (const requirement of value.requirements ?? []) {
      if (requirementKeys.has(requirement.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["requirements"],
          message: `duplicate requirement key: ${requirement.key}`,
        });
      }
      requirementKeys.add(requirement.key);
    }
    if (value.version && value.$schema && !value.metadata.changelog.some((entry) => entry.version === value.version)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["metadata", "changelog"],
        message: `metadata.changelog must include an entry for version ${value.version}`,
      });
    }
  })
  .transform((value) => {
    const environment = value.requirements?.length ? requirementsToEnvironment(value.requirements) : value.environment;
    const title = value.title ?? value.display?.name;
    const description = value.description ?? value.display?.summary;
    const notes = value.notes ?? value.display?.description;
    const legacyDependencySlugs = Array.isArray(value.dependencies) ? value.dependencies : [];
    const dependencies = Array.isArray(value.dependencies) ? {} : value.dependencies;
    return {
      $schema: value.$schema,
      name: value.name,
      version: value.version,
      icon: value.icon,
      title,
      description,
      notes,
      metadata: {
        ...value.metadata,
        changelog: [...value.metadata.changelog].sort((a, b) => b.version.localeCompare(a.version)),
      },
      environment,
      database: value.database,
      dependencies,
      legacyDependencySlugs,
      commands: value.commands,
      checks: value.checks,
      // Compatibility read shape for existing UI/API code. These are not serialized to companion.json.
      display: skillpackDisplaySchema.parse({
        name: title,
        summary: description,
        description: value.display?.description,
      }),
      requirements: skillpackEnvironmentToRequirements(environment),
    };
  });

export type SkillpackManifest = z.infer<typeof skillpackManifestSchema>;

export function skillpackDependencySlugs(manifest: Pick<SkillpackManifest, "dependencies"> & Partial<Pick<SkillpackManifest, "legacyDependencySlugs">>): string[] {
  const legacy = manifest.legacyDependencySlugs ?? [];
  return [...new Set([...Object.keys(manifest.dependencies), ...legacy])].sort((a, b) => a.localeCompare(b));
}

type SerializedSkillpackManifest = Partial<Pick<SkillpackManifest, "$schema" | "name" | "version" | "icon" | "title" | "description" | "notes" | "metadata" | "environment" | "database" | "dependencies" | "commands" | "checks">>;

export function skillpackManifestJson(manifest: SkillpackManifest): SerializedSkillpackManifest {
  const out: SerializedSkillpackManifest = {
    $schema: manifest.$schema ?? COMPANION_MANIFEST_SCHEMA_URL,
  };
  if (manifest.name) out.name = manifest.name;
  if (manifest.version) out.version = manifest.version;
  if (manifest.icon) out.icon = manifest.icon;
  if (manifest.title) out.title = manifest.title;
  if (manifest.description) out.description = manifest.description;
  if (manifest.notes) out.notes = manifest.notes;
  out.metadata = manifest.metadata;
  out.environment = manifest.environment;
  if (Object.keys(manifest.database.tables).length) out.database = manifest.database;
  out.dependencies = manifest.dependencies;
  out.commands = manifest.commands;
  if (manifest.checks.updates) out.checks = manifest.checks;
  return out;
}

export function fallbackSkillpackManifest(input: {
  summary: string;
  requirements?: SkillRequirement[];
  dependencies?: string[] | Record<string, string>;
  display?: SkillpackDisplay | null;
  name?: string;
  version?: string;
  icon?: SkillIcon;
  companionSkillId?: string;
  usage?: SkillRuntimeUsage;
  changelog?: SkillpackChangelogEntry[];
  environment?: SkillpackEnvironment;
  database?: SkillDatabaseDeclaration;
  commands?: SkillpackCommand[];
  checks?: SkillpackChecks;
  notes?: string;
}): SkillpackManifest {
  const summary = input.summary.trim() || "Skill";
  const dependencies =
    input.dependencies &&
    !Array.isArray(input.dependencies) &&
    Object.keys(input.dependencies).length > 0 &&
    Object.values(input.dependencies).every((id) => id === "")
      ? Object.keys(input.dependencies)
      : input.dependencies;
  return skillpackManifestSchema.parse({
    name: input.name,
    version: input.version,
    icon: input.icon,
    title: input.display?.name,
    description: input.display?.summary ?? summary,
    notes: input.notes ?? input.display?.description,
    metadata: {
      companionSkillId: input.companionSkillId,
      usage: input.usage,
      changelog: input.changelog ?? [],
    },
    environment: input.environment ?? requirementsToEnvironment(input.requirements),
    database: input.database ?? { tables: {} },
    dependencies: dependencies ?? {},
    commands: input.commands ?? [],
    checks: input.checks ?? {},
  });
}
