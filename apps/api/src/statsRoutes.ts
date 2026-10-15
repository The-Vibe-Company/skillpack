import { createHash, timingSafeEqual } from "node:crypto";
import { db, user, type Db } from "@skillpack/db";
import { sql } from "drizzle-orm";
import { Hono } from "hono";

/** Instance-wide account counts; the auth user table has no tenant scope. */
export async function readUserStats(database: Pick<Db, "select"> = db) {
  const [counts] = await database.select({
    total_users: sql<number>`count(*)`.mapWith(Number),
    new_users_1d: sql<number>`count(*) filter (where ${user.createdAt} >= now() - interval '24 hours' and ${user.createdAt} <= now())`.mapWith(Number),
    new_users_7d: sql<number>`count(*) filter (where ${user.createdAt} >= now() - interval '168 hours' and ${user.createdAt} <= now())`.mapWith(Number),
  }).from(user);
  if (!counts) throw new Error("user statistics unavailable");
  // Session refreshes, profile updates and declared usage identities are not user activity tracking.
  return { ...counts, active_users_1d: null, active_users_7d: null };
}

export function createStatsRoutes(input: { read?: typeof readUserStats } = {}) {
  const app = new Hono();
  const read = input.read ?? readUserStats;
  app.get("/v1/stats", async (c) => {
    c.header("Cache-Control", "no-store");
    const expected = process.env.STATS_TOKEN;
    const supplied = /^Bearer ([^\s]+)$/i.exec(c.req.header("authorization") ?? "")?.[1];
    // Hash to fixed-size buffers so timingSafeEqual also handles different token lengths.
    if (!expected || !supplied || !timingSafeEqual(
      createHash("sha256").update(supplied).digest(),
      createHash("sha256").update(expected).digest(),
    )) return c.json({ error: "Unauthorized" }, 401);
    return c.json(await read());
  });
  return app;
}
