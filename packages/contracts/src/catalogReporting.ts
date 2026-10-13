import { z } from "zod";

export const catalogReportSchema = z.object({
  reason: z.enum(["secret_exposure", "malicious", "license", "spam"]),
  details: z.string().trim().max(2000).optional(),
}).strict();
export const catalogReportQueueQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
}).strict();
export type CatalogReportInput = z.infer<typeof catalogReportSchema>;
