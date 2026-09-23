import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createSkillUsageRoutes } from "./skillUsageRoutes";

const event = () => ({ event_id: randomUUID(), skill_id: randomUUID(), version: "1.0.0", schema_version: 1, kind: "invocation", adapter: "codex-hook", observed_at: "2026-09-23T12:00:00Z" });
function post(app: ReturnType<typeof createSkillUsageRoutes>, body: string) {
  return app.request("/v1/skill-usage-events", { method: "POST", headers: { "Content-Type": "application/json" }, body });
}
describe("anonymous activation reporting", () => {
  it("accepts anonymous and declared identities without credentials, with a durable receipt", async () => {
    const report = vi.fn().mockResolvedValue(undefined);
    const app = createSkillUsageRoutes({ report });
    const response = await post(app, JSON.stringify(event()));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ event_id: expect.any(String) });
    expect(response.headers.get("cache-control")).toBe("no-store");
    const identified = { ...event(), agent: "pi", environment: "conductor", identity: { email: "Bot@Example.test", source: "git-local" } };
    expect((await post(app, JSON.stringify(identified))).status).toBe(202);
    expect(report.mock.calls[1]?.[0].identity.email).toBe("bot@example.test");
  });
  it("rejects tenant overrides, unsupported metadata, malformed and oversized payloads without echoing values", async () => {
    const report = vi.fn();
    const app = createSkillUsageRoutes({ report });
    for (const value of [{ ...event(), org_id: randomUUID() }, { ...event(), prompt: "private" }, { ...event(), identity: { email: "not an email", source: "configured" } }].map((value) => JSON.stringify(value)).concat("{")) {
      const response = await post(app, value);
      expect(response.status).toBe(400);
      expect(await response.text()).toBe('{"error":"invalid activation report"}');
    }
    expect((await post(app, "x".repeat(4097))).status).toBe(413);
    expect(report).not.toHaveBeenCalled();
  });
  it("limits admission without keeping IPs and resets the window", async () => {
    let now = 60_000;
    const report = vi.fn().mockResolvedValue(undefined);
    const app = createSkillUsageRoutes({ report, now: () => now });
    for (let i = 0; i < 600; i++) expect((await post(app, JSON.stringify(event()))).status).toBe(202);
    expect((await post(app, JSON.stringify(event()))).status).toBe(429);
    now += 60_000;
    expect((await post(app, JSON.stringify(event()))).status).toBe(202);
  });
  it("rejects the retired route and returns a retryable capacity response", async () => {
    const app = createSkillUsageRoutes({ report: vi.fn().mockResolvedValue(false) });
    expect((await app.request("/v1/skill-usage", { method: "POST", body: JSON.stringify(event()) })).status).toBe(404);
    const response = await post(app, JSON.stringify(event()));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
  });
  it("does not expose database parameters on failure", async () => {
    const app = createSkillUsageRoutes({ report: vi.fn().mockRejectedValue(new Error("email=private@example.test")) });
    const response = await post(app, JSON.stringify(event()));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private@example.test");
  });
});
