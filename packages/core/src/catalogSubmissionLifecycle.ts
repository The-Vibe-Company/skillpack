import { and, eq } from "drizzle-orm";
import { schema, type Db } from "@skillpack/db";

/** Caller holds the skill row lock; withdrawal and its audit share the caller's transaction. */
export async function withdrawOpenCatalogSubmissions(input: { database: Db; orgId: string; skillId: string; actorId: string }): Promise<void> {
  const withdrawn = await input.database.update(schema.catalogSubmissions).set({ status: "withdrawn" })
    .where(and(eq(schema.catalogSubmissions.orgId, input.orgId), eq(schema.catalogSubmissions.skillId, input.skillId), eq(schema.catalogSubmissions.status, "proposed")))
    .returning({ id: schema.catalogSubmissions.id, skillVersionId: schema.catalogSubmissions.skillVersionId });
  for (const submission of withdrawn) {
    await input.database.insert(schema.auditLog).values({
      orgId: input.orgId, actorId: input.actorId, action: "catalog_submission.withdrawn", targetType: "catalog_submission", targetId: submission.id,
      metadata: { skillId: input.skillId, releaseVersionId: submission.skillVersionId },
    });
  }
}
