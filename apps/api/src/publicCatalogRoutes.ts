import { createHash } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  publicCatalogListSchema,
  publicCatalogPathSchema,
  publicCatalogQuerySchema,
  publicCatalogSkillSchema,
} from "@skillpack/contracts";
import { getPublicCatalogPackage, getPublicCatalogSkill, listPublicCatalog } from "@skillpack/core";

import { getSkillArchive, publicSkillReleaseKey } from "@skillpack/storage";

/** Shared anonymous admission cap, matching public usage receipt routes without trusting IP headers. */
export function createPublicCatalogRoutes(input: {
  list?: typeof listPublicCatalog;
  get?: typeof getPublicCatalogSkill;
  resolvePackage?: typeof getPublicCatalogPackage;
  readArchive?: typeof getSkillArchive;
  enabled?: () => boolean;
  now?: () => number;
} = {}) {
  const app = new Hono();
  const list = input.list ?? listPublicCatalog;
  const get = input.get ?? getPublicCatalogSkill;
  const resolvePackage = input.resolvePackage ?? getPublicCatalogPackage;
  const readArchive = input.readArchive ?? getSkillArchive;
  const enabled = input.enabled ?? (() => process.env.SKILLPACK_PUBLIC_CATALOG === "true");
  const now = input.now ?? Date.now;
  let window = -1;
  let count = 0;

  app.use("/v1/public/catalog/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (!enabled()) return c.json({ error: "not found" }, 404);
    const current = Math.floor(now() / 60_000);
    if (current !== window) { window = current; count = 0; }
    if (++count > 600) {
      c.header("Retry-After", "60");
      return c.json({ error: "catalog rate limit exceeded" }, 429);
    }
    await next();
  });

  app.get("/v1/public/catalog/skills", async (c) => {
    const parsed = publicCatalogQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: "invalid catalog query" }, 400);
    try {
      const rows = await list(parsed.data);
      const response = publicCatalogListSchema.parse({
        skills: rows,
        next_offset: rows.length === parsed.data.limit && parsed.data.offset + rows.length <= 10_000
          ? parsed.data.offset + rows.length : null,
      });
      return cachedCatalogResponse(c, JSON.stringify(response));
    } catch {
      return c.json({ error: "catalog temporarily unavailable" }, 503);
    }
  });

  app.get("/v1/public/catalog/skills/:orgSlug/:skillSlug", async (c) => {
    const parsed = publicCatalogPathSchema.safeParse(c.req.param());
    if (!parsed.success) return c.json({ error: "not found" }, 404);
    try {
      const skill = await get(parsed.data);
      if (!skill) return c.json({ error: "not found" }, 404);
      return cachedCatalogResponse(c, JSON.stringify(publicCatalogSkillSchema.parse(skill)));
    } catch {
      return c.json({ error: "catalog temporarily unavailable" }, 503);
    }
  });
  app.get("/v1/public/catalog/skills/:orgSlug/:skillSlug/versions/:version/package", async (c) => {
    const parsed = publicCatalogPathSchema.safeParse({ orgSlug: c.req.param("orgSlug"), skillSlug: c.req.param("skillSlug") });
    if (!parsed.success) return c.json({ error: "not found" }, 404);
    try {
      const found = await resolvePackage(parsed.data);
      if (!found || found.version !== c.req.param("version")) return c.json({ error: "not found" }, 404);
      const zip = await readArchive({ key: publicSkillReleaseKey({ orgId: found.orgId, checksum: found.checksum }) });
      // Storage can take time: withdrawal, moderation, or a replacement validation must take effect
      // before delivery, even when the bytes were already read from the immutable snapshot.
      const current = await resolvePackage(parsed.data);
      if (!enabled() || !current || current.orgId !== found.orgId || current.version !== found.version
        || current.checksum !== found.checksum || current.sizeBytes !== found.sizeBytes) {
        return c.json({ error: "not found" }, 404);
      }
      if (zip.length !== found.sizeBytes || `sha256:${createHash("sha256").update(zip).digest("hex")}` !== found.checksum) {
        return c.json({ error: "catalog package integrity mismatch" }, 409);
      }
      return new Response(new Uint8Array(zip), { headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${parsed.data.skillSlug}.zip"`,
        "Content-Length": String(zip.length),
        "Cache-Control": "no-store",
        "x-companion-package-checksum": found.checksum,
        "x-companion-package-size": String(found.sizeBytes),
        "x-companion-public-version": found.version,
      } });
    } catch {
      return c.json({ error: "catalog temporarily unavailable" }, 503);
    }
  });
  return app;
}

/** Store representations, but re-prove listing consent before every reuse (including 304s). */
function cachedCatalogResponse(c: Context, body: string): Response {
  const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
  c.header("Cache-Control", "public, max-age=0, must-revalidate");
  c.header("ETag", etag);
  const validators = c.req.header("If-None-Match")?.split(",").map((value) => value.trim().replace(/^W\//, ""));
  if (validators?.includes(etag) || validators?.includes("*")) return c.body(null, 304);
  return c.body(body, 200, { "Content-Type": "application/json; charset=UTF-8" });
}
