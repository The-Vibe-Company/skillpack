import { Hono } from "hono";
import { z } from "zod";
import {
  catalogModerationQuerySchema, catalogModerationTargetSchema, catalogModerationReasonSchema, catalogReportQueueQuerySchema,
} from "@skillpack/contracts";
import { assertCatalogModerator, CatalogModerationError, listCatalogSubmissions, listCatalogReports, moderateCatalog } from "@skillpack/core";
import { actorFromContext, AuthenticationRequiredError, isAgentRequest, isTokenRequest, type ApiVariables } from "./context";
import type { Db } from "@skillpack/db";

export function createCatalogModerationRoutes(input: { database?: Db } = {}) {
  const app = new Hono<{ Variables: ApiVariables }>();
  app.onError((error, c) => {
    if (error instanceof CatalogModerationError) return c.json({ error: error.message }, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return c.json({ error: "invalid moderation input" }, 400);
    throw error;
  });
  app.use("/v1/platform/catalog/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (process.env.SKILLPACK_PUBLIC_CATALOG !== "true") return c.json({ error: "not found" }, 404);
    try {
      if (isTokenRequest(c) || isAgentRequest(c)) return c.json({ error: "moderation requires a browser session" }, 403);
      const actor = actorFromContext(c);
      await assertCatalogModerator({ actorId: actor.id, database: input.database });
      await next();
    } catch (error) {
      if (error instanceof AuthenticationRequiredError) return c.json({ error: "not authenticated" }, 401);
      if (error instanceof CatalogModerationError) return c.json({ error: error.message }, error.status);
      if (error instanceof z.ZodError || error instanceof SyntaxError) return c.json({ error: "invalid moderation input" }, 400);
      throw error;
    }
  });
  app.get("/v1/platform/catalog/reports", async c => {
    const query = catalogReportQueueQuerySchema.parse(c.req.query());
    const reports = await listCatalogReports({ actorId: actorFromContext(c).id, ...query, database: input.database });
    return c.json({ reports });
  });
  app.get("/v1/platform/catalog/submissions", async c => {
    const query = catalogModerationQuerySchema.parse(c.req.query());
    const submissions = await listCatalogSubmissions({ actorId: actorFromContext(c).id, ...query, database: input.database });
    return c.json({ submissions });
  });
  for (const action of ["validate", "reject", "remove"] as const) {
    app.post(`/v1/platform/catalog/organizations/:orgId/submissions/:submissionId/${action}`, async c => {
      const target = catalogModerationTargetSchema.parse(c.req.param());
      const body = await c.req.json();
      const reason = action === "validate"
        ? (z.object({}).strict().parse(body), undefined)
        : catalogModerationReasonSchema.parse(body).reason;
      await moderateCatalog({ actorId: actorFromContext(c).id, ...target, action,
        reason, database: input.database });
      return c.json({ ok: true });
    });
  }
  app.post("/v1/platform/catalog/organizations/:orgId/ban", async c => {
    const orgId = z.string().uuid().parse(c.req.param("orgId"));
    const body = catalogModerationReasonSchema.parse(await c.req.json());
    await moderateCatalog({ actorId: actorFromContext(c).id, orgId, action: "ban", reason: body.reason, database: input.database });
    return c.json({ ok: true });
  });
  return app;
}
