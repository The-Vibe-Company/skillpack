import { z } from "zod";

/**
 * The signed-in member as `/v1/auth/whoami` reports them. Kept apart from `analytics.ts` so the schema,
 * and zod with it, loads only when a signup is reported instead of with every page.
 */
export const analyticsUser = z.object({
  userId: z.string().min(1),
  email: z.string(),
  org: z.object({ org_id: z.string(), name: z.string() }).nullable().optional(),
});
export type AnalyticsUser = z.infer<typeof analyticsUser>;
