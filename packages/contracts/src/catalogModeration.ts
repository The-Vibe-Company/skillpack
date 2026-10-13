import { z } from "zod";

export const catalogModerationQuerySchema = z.object({
  status: z.enum(["proposed", "validated", "rejected", "removed"]).default("proposed"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
}).strict();
export const catalogModerationTargetSchema = z.object({
  orgId: z.string().uuid(), submissionId: z.string().uuid(),
});
export const catalogModerationReasonSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
}).strict();

/** PR 3 owns production/report storage. A pass includes org scope and MIT/Apache-2.0 checks. */
export const catalogCheckReportSchema = z.object({
  orgId: z.string().uuid(),
  submissionId: z.string().uuid(),
  skillVersionId: z.string().uuid(),
  packageChecksum: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  status: z.enum(["pending", "passed", "failed"]),
  reason: z.string().max(2000).nullable(),
}).strict();
export type CatalogCheckReport = z.infer<typeof catalogCheckReportSchema>;
