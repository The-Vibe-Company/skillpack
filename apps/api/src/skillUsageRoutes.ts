import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { skillUsageEventSchema } from "@skillpack/contracts";
import { reportSkillUsage } from "@skillpack/core";

/** Process admission cap needs no IP storage and does not trust spoofable forwarding headers.
 * PostgreSQL separately bounds reports per skill across all replicas. */
export function createSkillUsageRoutes(input: { report?: typeof reportSkillUsage; now?: () => number } = {}) {
  const app = new Hono();
  const report = input.report ?? reportSkillUsage;
  const now = input.now ?? Date.now;
  let window = 0;
  let count = 0;
  app.post("/v1/skill-usage", async (c, next) => {
    c.header("Cache-Control", "no-store");
    const current = Math.floor(now() / 60_000);
    if (current !== window) { window = current; count = 0; }
    if (++count > 600) {
      c.header("Retry-After", "60");
      return c.json({ error: "reporting rate limit exceeded" }, 429);
    }
    await next();
  }, bodyLimit({ maxSize: 4096, onError: (c) => c.json({ error: "report exceeds 4 KB" }, 413) }), async (c) => {
    const parsed = skillUsageEventSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid activation report" }, 400);
    try {
      await report(parsed.data);
    } catch {
      // Never pass a database error (which may contain parameter values) to logs/Sentry.
      return c.json({ error: "reporting temporarily unavailable" }, 503);
    }
    return c.body(null, 202);
  });
  return app;
}
