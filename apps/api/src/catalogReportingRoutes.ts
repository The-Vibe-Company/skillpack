import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { catalogReportSchema, publicCatalogPathSchema } from "@skillpack/contracts";
import { reportCatalogSkill } from "@skillpack/core";

/** Connection metadata only: client-supplied forwarding headers never grant a fresh quota. */
export function catalogReporterHash(address: string | undefined, secret: string | undefined): string | null {
  if (!address || !secret || secret.length < 32) return null;
  const normalized = address.startsWith("::ffff:") && isIP(address.slice(7)) === 4 ? address.slice(7) : address;
  if (!isIP(normalized)) return null;
  return createHmac("sha256", secret).update(`catalog-report\0${normalized}`).digest("hex");
}

export function createCatalogReportingRoutes(input: {
  report?: typeof reportCatalogSkill;
  address?: (c: Context) => string | undefined;
  secret?: () => string | undefined;
  now?: () => number;
} = {}) {
  const app = new Hono();
  const report = input.report ?? reportCatalogSkill;
  const address = input.address ?? (c => getConnInfo(c).remote.address);
  const now = input.now ?? Date.now;
  let window = -1;
  let count = 0;
  const path = "/v1/public/catalog/skills/:orgSlug/:skillSlug/reports";
  app.post(path, async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (process.env.SKILLPACK_PUBLIC_CATALOG !== "true") return c.json({ error: "not found" }, 404);
    const current = Math.floor(now() / 60_000);
    if (current !== window) { window = current; count = 0; }
    if (++count > 60) {
      c.header("Retry-After", "60");
      return c.json({ error: "report rate limit exceeded" }, 429);
    }
    await next();
  }, bodyLimit({ maxSize: 16 * 1024, onError: c => c.json({ error: "report exceeds 16 KB" }, 413) }), async c => {
    const target = publicCatalogPathSchema.safeParse(c.req.param());
    if (!target.success) return c.json({ error: "not found" }, 404);
    let body: unknown;
    try { body = await c.req.json(); }
    catch { return c.json({ error: "invalid report" }, 400); }
    const parsed = catalogReportSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "invalid report" }, 400);
    try {
      const reporterHash = catalogReporterHash(address(c), (input.secret ?? (() => process.env.BETTER_AUTH_SECRET))());
      if (!reporterHash) return c.json({ error: "reporting temporarily unavailable" }, 503);
      const result = await report({ ...target.data, ...parsed.data, reporterHash });
      if (result === "not_found") return c.json({ error: "not found" }, 404);
      if (result === "rate_limited") {
        c.header("Retry-After", "3600");
        return c.json({ error: "report rate limit exceeded" }, 429);
      }
      return c.json({ ok: true }, 201);
    } catch {
      // Do not log bodies: a secret-exposure report can itself contain confidential text.
      return c.json({ error: "reporting temporarily unavailable" }, 503);
    }
  });
  return app;
}
