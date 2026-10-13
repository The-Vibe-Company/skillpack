import { describe, expect, it, vi } from "vitest";
import {
  catalogModerationHref,
  catalogModerationQueuePath,
  hasNextCatalogModerationPage,
  parseCatalogModerationView,
  submitCatalogModerationDecision,
  type CatalogModerationSubmission,
} from "./catalogModeration";

const submission: CatalogModerationSubmission = {
  id: "8d4c5a52-4ad6-4c43-9d1b-6b6fbc0f0c01",
  org_id: "2b7d8a30-1c5e-4f7a-8f43-0b0d3c2a1e10",
  skill_id: "5f3e2d1c-0b9a-4876-9543-2a1b0c9d8e7f",
  skill_version_id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  package_checksum: `sha256:${"a".repeat(64)}`,
  status: "proposed",
  kind: "submission",
  rejection_reason: null,
  created_at: "2026-10-01T09:00:00.000Z",
  decided_at: null,
  check_status: "passed",
  check_reason: null,
};

function recordingFetch() {
  return vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({ ok: true }));
}

describe("catalog moderation navigation", () => {
  it("defaults unknown or hostile params to the first page of proposals", () => {
    expect(parseCatalogModerationView({})).toEqual({ view: "queue", status: "proposed", offset: 0 });
    expect(parseCatalogModerationView({ status: "withdrawn", offset: "-20" })).toEqual({ view: "queue", status: "proposed", offset: 0 });
    expect(parseCatalogModerationView({ status: "validated", offset: "10020" })).toEqual({ view: "queue", status: "validated", offset: 0 });
    expect(parseCatalogModerationView({ status: ["rejected", "removed"], offset: "45" })).toEqual({ view: "queue", status: "rejected", offset: 40 });
    expect(parseCatalogModerationView({ view: "reports", status: "removed" })).toEqual({ view: "reports", offset: 0 });
  });

  it("round-trips views through page links and asks the API for one bounded page", () => {
    expect(catalogModerationHref({ view: "queue", status: "removed", offset: 40 })).toBe("/platform/catalog?status=removed&offset=40");
    expect(catalogModerationHref({ view: "queue", status: "proposed", offset: 0 })).toBe("/platform/catalog?status=proposed");
    expect(catalogModerationHref({ view: "reports" })).toBe("/platform/catalog?view=reports");
    expect(catalogModerationHref({ view: "reports", offset: 20 })).toBe("/platform/catalog?view=reports&offset=20");
    expect(catalogModerationQueuePath("validated", 20)).toBe("/v1/platform/catalog/submissions?status=validated&limit=20&offset=20");
  });

  it("offers a next page only after a full page that stays inside the API offset bound", () => {
    expect(hasNextCatalogModerationPage(0, 20)).toBe(true);
    expect(hasNextCatalogModerationPage(0, 19)).toBe(false);
    expect(hasNextCatalogModerationPage(9_980, 20)).toBe(true);
    expect(hasNextCatalogModerationPage(10_000, 20)).toBe(false);
  });
});

describe("catalog moderation decisions", () => {
  it("validates with the strict empty body the API requires", async () => {
    const fetchMock = recordingFetch();
    vi.stubGlobal("fetch", fetchMock);

    await submitCatalogModerationDecision({ action: "validate", submission });

    const [path, init] = fetchMock.mock.calls[0]!;
    expect(path).toBe(`/v1/platform/catalog/organizations/${submission.org_id}/submissions/${submission.id}/validate`);
    expect(init).toMatchObject({ method: "POST", body: "{}", credentials: "same-origin" });
  });

  it("sends trimmed reasons for reject, remove and organization bans", async () => {
    const fetchMock = recordingFetch();
    vi.stubGlobal("fetch", fetchMock);

    await submitCatalogModerationDecision({ action: "reject", submission, reason: "  Unsupported license \n" });
    await submitCatalogModerationDecision({ action: "remove", submission, reason: "Malware" });
    await submitCatalogModerationDecision({ action: "ban", orgId: submission.org_id, reason: "Repeated abuse" });

    expect(fetchMock.mock.calls.map(([path, init]) => [path, init?.body])).toEqual([
      [`/v1/platform/catalog/organizations/${submission.org_id}/submissions/${submission.id}/reject`, JSON.stringify({ reason: "Unsupported license" })],
      [`/v1/platform/catalog/organizations/${submission.org_id}/submissions/${submission.id}/remove`, JSON.stringify({ reason: "Malware" })],
      [`/v1/platform/catalog/organizations/${submission.org_id}/ban`, JSON.stringify({ reason: "Repeated abuse" })],
    ]);
  });

  it("surfaces the API's conflict message so the moderator sees why a decision failed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "a passing automatic check report is required" }, { status: 409 })));

    await expect(submitCatalogModerationDecision({ action: "validate", submission }))
      .rejects.toMatchObject({ name: "ApiFetchError", status: 409, message: "a passing automatic check report is required" });
  });
});
