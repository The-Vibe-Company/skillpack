import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { catalogReporterHash, createCatalogReportingRoutes } from "./catalogReportingRoutes";

const path = "/v1/public/catalog/skills/test-org/test-skill/reports";
type ReportRequestFixture = { reason?: string; details?: string | number; org_id?: string };
const request = (body: ReportRequestFixture = { reason: "spam" }) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
describe("anonymous catalog reporting", () => {
  beforeEach(() => vi.stubEnv("SKILLPACK_PUBLIC_CATALOG", "true"));
  afterEach(() => vi.unstubAllEnvs());
  function routes(result: "accepted" | "not_found" | "rate_limited" = "accepted", now = () => 0) {
    const report = vi.fn(async () => result);
    return { report, app: createCatalogReportingRoutes({ report, address: () => "192.0.2.1", secret: () => "x".repeat(32), now }) };
  }
  it("accepts anonymous bounded input and never returns report details or its abuse hash", async () => {
    const { app, report } = routes();
    const response = await app.request(path, request({ reason: "secret_exposure", details: "  sensitive text  " }));
    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true });
    expect(report).toHaveBeenCalledWith({ orgSlug: "test-org", skillSlug: "test-skill", reason: "secret_exposure", details: "sensitive text", reporterHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });
  it("validates reason, details, extra fields, JSON and body byte limit before persistence", async () => {
    const { app, report } = routes();
    for (const body of [{}, { reason: "other" }, { reason: "spam", details: 1 }, { reason: "spam", details: "x".repeat(2001) }, { reason: "spam", org_id: "injected" }]) {
      expect((await app.request(path, request(body))).status).toBe(400);
    }
    expect((await app.request(path, { method: "POST", body: "{" })).status).toBe(400);
    expect((await app.request(path, request({ reason: "spam", details: "x".repeat(17000) }))).status).toBe(413);
    expect(report).not.toHaveBeenCalled();
    for (const reason of ["malicious", "license", "spam"]) expect((await app.request(path, request({ reason }))).status).toBe(201);
  });
  it("returns 404 when disabled or not published and 503 on unavailable abuse identity/storage", async () => {
    const { app, report } = routes();
    vi.stubEnv("SKILLPACK_PUBLIC_CATALOG", "false");
    expect((await app.request(path, request())).status).toBe(404);
    expect(report).not.toHaveBeenCalled();
    vi.stubEnv("SKILLPACK_PUBLIC_CATALOG", "true");
    expect((await routes("not_found").app.request(path, request())).status).toBe(404);
    expect((await app.request(path.replace("test-org", "INVALID"), request())).status).toBe(404);
    const unavailable = createCatalogReportingRoutes({ report, address: () => undefined });
    expect((await unavailable.request(path, request())).status).toBe(503);
    report.mockRejectedValueOnce(new Error("storage unavailable"));
    expect((await app.request(path, request())).status).toBe(503);
  });
  it("applies persistent quota results and process admission limits with Retry-After", async () => {
    const limited = await routes("rate_limited").app.request(path, request());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("3600");
    let time = 0;
    const { app, report } = routes("accepted", () => time);
    for (let i = 0; i < 60; i++) expect((await app.request(path, request({}))).status).toBe(400);
    const response = await app.request(path, request());
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(report).not.toHaveBeenCalled();
    time = 60_000;
    expect((await app.request(path, request())).status).toBe(201);
  });
  it("hashes only trusted connection addresses and normalizes mapped IPv4", async () => {
    const key = "x".repeat(32);
    expect(catalogReporterHash("::ffff:192.0.2.1", key)).toBe(catalogReporterHash("192.0.2.1", key));
    expect(catalogReporterHash("192.0.2.2", key)).not.toBe(catalogReporterHash("192.0.2.1", key));
    expect(catalogReporterHash("192.0.2.1", "short")).toBeNull();
    expect(catalogReporterHash("invalid", key)).toBeNull();
    const { app, report } = routes();
    await app.request(path, { ...request(), headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.9", "X-Real-IP": "203.0.113.9" } });
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ reporterHash: catalogReporterHash("192.0.2.1", key) }));
  });
});
