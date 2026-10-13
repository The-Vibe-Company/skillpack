import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// oxlint-disable-next-line anti-slop/no-module-mocking -- this server-only marker has no runtime behavior in the loader test.
vi.mock("server-only", () => ({}));
// oxlint-disable-next-line anti-slop/no-module-mocking -- navigation is replaced so redirect and 404 outcomes are observable in isolation.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("not-found");
  }),
}));

const serverApiFetch = vi.fn();
const loadServerAuth = vi.fn();

// oxlint-disable-next-line anti-slop/no-module-mocking -- the API is supplied by deterministic response fixtures; ServerApiError stays real.
vi.mock("@/lib/apiServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./apiServer")>();
  return { ...actual, serverApiFetch };
});
// oxlint-disable-next-line anti-slop/no-module-mocking -- session lookup is supplied by deterministic fixtures.
vi.mock("@/lib/serverAuth", () => ({ loadServerAuth }));

const { ServerApiError } = await import("./apiServer");
const { loadCatalogModerationPage } = await import("./catalogModerationData");

function row(index: number) {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    org_id: "2b7d8a30-1c5e-4f7a-8f43-0b0d3c2a1e10",
    skill_id: "5f3e2d1c-0b9a-4876-9543-2a1b0c9d8e7f",
    skill_version_id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
    package_checksum: `sha256:${"b".repeat(64)}`,
    status: "proposed",
    kind: "submission",
    rejection_reason: null,
    created_at: "2026-10-01T09:00:00.000Z",
    decided_at: null,
    check_status: "failed",
    check_reason: "GPL-3.0 is not an accepted license",
  };
}

function apiError(status: number) {
  return new ServerApiError({ status, path: "/v1/platform/catalog/submissions", message: "denied" });
}

describe("loadCatalogModerationPage", () => {
  beforeEach(() => {
    vi.stubEnv("SKILLPACK_PUBLIC_CATALOG", "true");
    serverApiFetch.mockReset();
    loadServerAuth.mockReset();
    loadServerAuth.mockResolvedValue({ status: "authenticated", user: { userId: "user_1" } });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is a 404 without touching the session or API while the public catalog is disabled", async () => {
    vi.stubEnv("SKILLPACK_PUBLIC_CATALOG", "false");

    await expect(loadCatalogModerationPage({})).rejects.toThrow("not-found");
    expect(loadServerAuth).not.toHaveBeenCalled();
    expect(serverApiFetch).not.toHaveBeenCalled();
  });

  it("sends signed-out visitors to login before asking for the queue", async () => {
    loadServerAuth.mockResolvedValue({ status: "unauthenticated" });

    await expect(loadCatalogModerationPage({})).rejects.toThrow("redirect:/login");
    expect(serverApiFetch).not.toHaveBeenCalled();
  });

  it("keeps the session when auth is temporarily unavailable", async () => {
    loadServerAuth.mockResolvedValue({ status: "unavailable" });

    await expect(loadCatalogModerationPage({})).resolves.toEqual({ kind: "auth-unavailable" });
  });

  it.each([403, 404])("hides the screen as a 404 when the API answers %i (non-moderator, revoked grant, or disabled API)", async (status) => {
    serverApiFetch.mockRejectedValue(apiError(status));

    await expect(loadCatalogModerationPage({ status: "validated" })).rejects.toThrow("not-found");
  });

  it("hides the Reports tab from non-moderators too", async () => {
    serverApiFetch.mockRejectedValue(apiError(403));

    await expect(loadCatalogModerationPage({ view: "reports" })).rejects.toThrow("not-found");
    expect(serverApiFetch).toHaveBeenCalledWith("/v1/platform/catalog/reports?limit=20&offset=0");
  });

  it("redirects to login when the API session expired between checks", async () => {
    serverApiFetch.mockRejectedValue(apiError(401));

    await expect(loadCatalogModerationPage({})).rejects.toThrow("redirect:/login");
  });

  it("shows a retryable error for outages and malformed queue payloads", async () => {
    serverApiFetch.mockRejectedValueOnce(apiError(503));
    await expect(loadCatalogModerationPage({})).resolves.toEqual({ kind: "load-error" });

    serverApiFetch.mockResolvedValueOnce({ submissions: [{ id: "x" }] });
    await expect(loadCatalogModerationPage({})).resolves.toEqual({ kind: "load-error" });
  });

  it("loads the requested status page with check summaries and pagination", async () => {
    serverApiFetch.mockResolvedValue({ submissions: Array.from({ length: 20 }, (_, index) => row(index)) });

    const data = await loadCatalogModerationPage({ status: "proposed", offset: "20" });

    expect(serverApiFetch).toHaveBeenCalledWith("/v1/platform/catalog/submissions?status=proposed&limit=20&offset=20");
    expect(data).toMatchObject({ kind: "ready", view: { view: "queue", status: "proposed", offset: 20 }, hasNextPage: true });
    expect(data.kind === "ready" && data.submissions[0]).toMatchObject({ check_status: "failed", check_reason: "GPL-3.0 is not an accepted license" });
  });

  it("loads the reports API and preserves pagination", async () => {
    const report = { id: "report-1", org_id: "org-1", skill_id: "skill-1", submission_id: null,
      org_slug: "acme", skill_slug: "release-helper", reason: "spam", details: "Duplicate", created_at: "2026-10-13T00:00:00.000Z" };
    serverApiFetch.mockResolvedValue({ reports: Array.from({ length: 20 }, () => report) });
    await expect(loadCatalogModerationPage({ view: "reports", offset: "20" })).resolves.toMatchObject({
      kind: "ready", view: { view: "reports", offset: 20 }, submissions: [], hasNextPage: true,
      reports: { status: "ready", reports: [report, ...Array.from({ length: 19 }, () => report)] },
    });
    expect(serverApiFetch).toHaveBeenCalledWith("/v1/platform/catalog/reports?limit=20&offset=20");
  });

  it("shows a retryable error when report data is unavailable or malformed", async () => {
    serverApiFetch.mockRejectedValueOnce(apiError(503));
    await expect(loadCatalogModerationPage({ view: "reports" })).resolves.toEqual({ kind: "load-error" });
    serverApiFetch.mockResolvedValueOnce({ reports: [{ id: "invalid" }] });
    await expect(loadCatalogModerationPage({ view: "reports" })).resolves.toEqual({ kind: "load-error" });
  });
});
