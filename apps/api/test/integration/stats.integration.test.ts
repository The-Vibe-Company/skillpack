import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { readUserStats } from "../../src/statsRoutes";
import { integrationDb } from "./testDatabase";

describe("operator user statistics", () => {
  it("counts global users and inclusive rolling signup windows without inferring activity", async () => {
    await integrationDb.transaction(async (tx) => {
      // A temporary auth table keeps exact counts independent of parallel integration fixtures.
      await tx.execute(sql`create temporary table "user" (like public."user" including defaults) on commit drop`);
      expect(await readUserStats(tx)).toEqual({
        total_users: 0, new_users_1d: 0, new_users_7d: 0, active_users_1d: null, active_users_7d: null,
      });
      for (const age of ["0 days", "1 day", "2 days", "7 days", "8 days", "-1 day"]) {
        const id = randomUUID();
        await tx.execute(sql`insert into "user" (id, name, email, created_at)
          values (${id}, 'Stats fixture', ${`${id}@example.test`}, now() - ${age}::interval)`);
      }
      expect(await readUserStats(tx)).toEqual({
        total_users: 6, new_users_1d: 2, new_users_7d: 4, active_users_1d: null, active_users_7d: null,
      });
    });
  });
});
