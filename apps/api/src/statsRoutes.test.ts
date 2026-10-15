import { afterEach, describe, expect, it, vi } from "vitest";
import { createStatsRoutes } from "./statsRoutes";

afterEach(() => vi.unstubAllEnvs());

describe("GET /v1/stats", () => {
  it.each([undefined, "Bearer wrong", "Bearer a-longer-wrong-token", "Basic stats-test-token", "Bearer"])(
    "rejects missing or invalid authorization (%s) before reading data", async (authorization) => {
      vi.stubEnv("STATS_TOKEN", "stats-test-token");
      const read = vi.fn();
      const response = await createStatsRoutes({ read }).request("/v1/stats", {
        headers: authorization ? { authorization } : {},
      });
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(read).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, ""])("is disabled when STATS_TOKEN is %s", async (token) => {
    vi.stubEnv("STATS_TOKEN", token);
    const read = vi.fn();
    const response = await createStatsRoutes({ read }).request("/v1/stats", {
      headers: { authorization: "Bearer stats-test-token" },
    });
    expect(response.status).toBe(401);
    expect(read).not.toHaveBeenCalled();
  });

  it("returns integer counts and null activity with the configured bearer token", async () => {
    vi.stubEnv("STATS_TOKEN", "stats-test-token");
    const counts = { total_users: 12, new_users_1d: 2, new_users_7d: 5, active_users_1d: null, active_users_7d: null };
    const read = vi.fn().mockResolvedValue(counts);
    const response = await createStatsRoutes({ read }).request("/v1/stats", {
      headers: { authorization: "Bearer stats-test-token" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(counts);
    expect(read).toHaveBeenCalledOnce();
  });
});
