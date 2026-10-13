import { z } from "zod";
import { SKILL_NAME_RE } from "./frontmatter";

/** Deliberately excludes tokens, identities, declarations and internal version metadata. */
export const publicCatalogSkillSchema = z.object({
  org_name: z.string(),
  org_slug: z.string(),
  skill_slug: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string(),
  released_at: z.string().datetime(),
  checksum: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  size_bytes: z.number().int().nonnegative(),
  body: z.string(),
  files: z.array(z.object({ path: z.string(), size_bytes: z.number().int().nonnegative() }).strip()),
}).strip();
export type PublicCatalogSkill = z.infer<typeof publicCatalogSkillSchema>;

export const publicCatalogListSchema = z.object({
  skills: z.array(publicCatalogSkillSchema),
  next_offset: z.number().int().nonnegative().nullable(),
}).strip();

export const publicCatalogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
  label: z.string().min(1).max(256).optional(),
}).strict();

export const publicCatalogPathSchema = z.object({
  orgSlug: z.string().max(128).regex(SKILL_NAME_RE),
  skillSlug: z.string().max(128).regex(SKILL_NAME_RE),
});

export const setSkillPublicListingInputSchema = z.object({ listed: z.boolean() }).strict();
export const catalogSubmissionStatusSchema = z.enum(["proposed", "validated", "rejected", "withdrawn", "removed"]);
export const catalogSubmissionKindSchema = z.enum(["publish_request", "submission"]);

export const skillPublicListingStatusSchema = z.object({
  listed_publicly: z.boolean(),
  listed_at: z.string().datetime().nullable(),
  latest_submission: z.object({
    id: z.string().uuid(),
    status: catalogSubmissionStatusSchema,
    kind: catalogSubmissionKindSchema,
  }).strip().nullable(),
  rejection_reason: z.string().nullable(),
  can_manage_listing: z.boolean(),
}).strip();
export type SkillPublicListingStatus = z.infer<typeof skillPublicListingStatusSchema>;

export const skillPublicListingResultSchema = skillPublicListingStatusSchema.extend({
  changed: z.boolean(),
}).strip();
export type SkillPublicListingResult = z.infer<typeof skillPublicListingResultSchema>;
export const requestSkillPublicListingInputSchema = z.object({}).strict();
