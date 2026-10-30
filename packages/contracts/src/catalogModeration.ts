import { z } from "zod";

export const catalogModerationQuerySchema = z.object({
  status: z.enum(["proposed", "validated", "rejected", "removed"]).default("proposed"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
}).strict();
export const catalogModerationTargetSchema = z.object({
  orgId: z.guid(), submissionId: z.guid(),
});
export const catalogModerationReasonSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
}).strict();

/**
 * Moderation's persisted-check adapter result. The checks engine stores the value-free
 * `{ version, passed, findings }` report from `publicCatalog.ts`; moderation adds the frozen
 * identity and a small status/reason projection when it reads that report.
 */
export const catalogModerationCheckReportSchema = z.object({
  orgId: z.guid(),
  submissionId: z.guid(),
  skillVersionId: z.guid(),
  packageChecksum: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  status: z.enum(["pending", "passed", "failed"]),
  reason: z.string().max(2000).nullable(),
}).strict();
export type CatalogModerationCheckReport = z.infer<typeof catalogModerationCheckReportSchema>;
