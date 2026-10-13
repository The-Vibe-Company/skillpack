import { z } from "zod";
import { sql } from "drizzle-orm";
import { db, type Db } from "@skillpack/db";
import { catalogReportSchema, catalogReportQueueQuerySchema, publicCatalogPathSchema, type CatalogReportInput } from "@skillpack/contracts";
import { assertCatalogModerator, CatalogModerationError } from "./catalogModeration";

/** Only the trusted API computes the abuse hash; neither raw IP nor caller identity is stored. */
export async function reportCatalogSkill(input: CatalogReportInput & {
  orgSlug: string; skillSlug: string; reporterHash: string; database?: Db;
}): Promise<"accepted" | "not_found" | "rate_limited"> {
  if (process.env.SKILLPACK_PUBLIC_CATALOG !== "true") return "not_found";
  const path = publicCatalogPathSchema.parse({ orgSlug: input.orgSlug, skillSlug: input.skillSlug });
  const report = catalogReportSchema.parse({ reason: input.reason, details: input.details });
  if (!/^[0-9a-f]{64}$/.test(input.reporterHash)) throw new Error("invalid reporter hash");
  const rows = await (input.database ?? db).execute<{ result: "accepted" | "not_found" | "rate_limited" }>(sql`
    select public.skillpack_report_catalog_skill(${path.orgSlug}, ${path.skillSlug},
      ${report.reason}, ${report.details || null}, ${input.reporterHash}) as result
  `);
  if (!rows[0]) throw new Error("catalog report unavailable");
  return rows[0].result;
}

export async function listCatalogReports(input: { actorId: string; limit?: number; offset?: number; database?: Db }) {
  const database = input.database ?? db;
  await assertCatalogModerator({ actorId: input.actorId, database });
  const query = catalogReportQueueQuerySchema.parse({ limit: input.limit, offset: input.offset });
  const configured = (process.env.SKILLPACK_CATALOG_MODERATOR_USER_IDS ?? "").split(",").map(value => value.trim()).includes(input.actorId);
  try {
    const rows = await database.execute<{
      id: string; org_id: string; skill_id: string; submission_id: string; org_slug: string;
      skill_slug: string; reason: CatalogReportInput["reason"]; details: string | null; created_at: Date | string;
    }>(sql`select * from public.skillpack_catalog_report_queue(${input.actorId}, ${configured}, ${query.limit}, ${query.offset})`);
    return Array.from(rows, row => ({ ...row, created_at: new Date(row.created_at).toISOString() }));
  } catch (error) {
    let cause: unknown = error;
    while (cause instanceof Error && cause.cause) cause = cause.cause;
    const parsed = z.object({ code: z.string() }).passthrough().safeParse(cause);
    if (parsed.success && parsed.data.code === "42501") {
      throw new CatalogModerationError("platform moderator required", 403);
    }
    throw error;
  }
}
