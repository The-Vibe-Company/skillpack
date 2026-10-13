// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicCatalogSkill, SkillPublicListingStatus } from "@skillpack/contracts";
import type { SkillVM } from "@/lib/types";
import { catalogPhase } from "./CatalogPublication";
import { PublicReleaseDialog, type PublicReleaseCatalog } from "./PublicReleaseDialog";

// SAFETY: React's test harness reads this documented global flag; the test owns its boolean value.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const ACME: PublicReleaseCatalog = { orgSlug: "acme" };

function skill(overrides: Partial<SkillVM> = {}): SkillVM {
  return {
    uuid: "skill-1",
    id: "release-helper",
    shareToken: "share-release-helper",
    version: "1.2.3",
    publicVersion: "1.2.3",
    canManagePublic: true,
    validation: "valid",
    description: "Prepare a release.",
    icon: null,
    notes: null,
    error: null,
    scope: "org",
    source: null,
    labels: [],
    authorId: "user-1",
    authorName: "Ada",
    authorInitials: "A",
    authorAvatarUrl: null,
    updaterId: "user-1",
    updaterName: "Ada",
    updaterInitials: "A",
    updaterAvatarUrl: null,
    modifiers: [],
    tools: [],
    requirements: [],
    compatibility: null,
    metadata: {},
    size: "2 KB",
    license: "MIT",
    checksum: null,
    created: "Oct 1, 2026",
    updated: "just now",
    installStatus: "none",
    installedVersion: null,
    requiresCount: 0,
    usedByCount: 0,
    depWarn: false,
    archived: false,
    ...overrides,
  };
}

const SUBMISSION_ID = "6f1c1f43-7f3a-4c1e-9d55-2b4f3f0b8a10";

function listing(overrides: Partial<SkillPublicListingStatus> = {}): SkillPublicListingStatus {
  return {
    listed_publicly: false,
    listed_at: null,
    latest_submission: null,
    rejection_reason: null,
    can_manage_listing: true,
    ...overrides,
  };
}

function submission(
  status: "proposed" | "validated" | "rejected" | "withdrawn",
  kind: "publish_request" | "submission" = "submission",
): SkillPublicListingStatus["latest_submission"] {
  return { id: SUBMISSION_ID, status, kind };
}

function catalogEntry(version: string): PublicCatalogSkill {
  return {
    org_name: "Acme",
    org_slug: "acme",
    skill_slug: "release-helper",
    name: "release-helper",
    description: "Prepare a release.",
    version,
    released_at: "2026-10-12T00:00:00.000Z",
    checksum: `sha256:${"a".repeat(64)}`,
    size_bytes: 2048,
    body: "# Release helper",
    files: [{ path: "SKILL.md", size_bytes: 16 }],
  };
}

type Route = { method: string; path: string; status: number; body: object };

/** Explicit API boundary: every request must match a declared route, in order. */
function stubApi(routes: Route[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const route = routes.shift();
    const method = init?.method ?? "GET";
    if (!route || route.method !== method || route.path !== String(input)) {
      throw new Error(`Unexpected ${method} ${String(input)}`);
    }
    return Response.json(route.body, { status: route.status });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const STATUS_PATH = "/v1/skills/release-helper/public-listing";
const REQUEST_PATH = "/v1/skills/release-helper/public-listing/request";
const CATALOG_PATH = "/v1/public/catalog/skills/acme/release-helper";

const getStatus = (body: SkillPublicListingStatus): Route => ({ method: "GET", path: STATUS_PATH, status: 200, body });
const getCatalog = (version: string): Route => ({ method: "GET", path: CATALOG_PATH, status: 200, body: catalogEntry(version) });

async function mount(target: SkillVM, catalog: PublicReleaseCatalog | null): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(React.createElement(PublicReleaseDialog, { skill: target, catalog, onClose: () => {}, onChanged: () => {} }));
  });
  await act(async () => {});
  return container;
}

function section(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(".catalog-pub");
}

function badge(container: HTMLElement): string | undefined {
  return section(container)?.querySelector(".catalog-pub__head .badge")?.textContent ?? undefined;
}

function button(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(section(container)?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
}

async function click(target: HTMLButtonElement | undefined) {
  expect(target).toBeDefined();
  await act(async () => {
    target?.click();
  });
  await act(async () => {});
}

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("catalogPhase", () => {
  it("maps listing state and the latest submission to one visible phase", () => {
    expect(catalogPhase(listing())).toBe("unpublished");
    expect(catalogPhase(listing({ latest_submission: submission("proposed", "publish_request") }))).toBe("requested");
    expect(catalogPhase(listing({ latest_submission: submission("proposed") }))).toBe("proposed");
    expect(catalogPhase(listing({ latest_submission: submission("rejected") }))).toBe("rejected");
    expect(catalogPhase(listing({ latest_submission: submission("withdrawn") }))).toBe("removed");
    // Unpublishing leaves the validated submission as history but clears discovery.
    expect(catalogPhase(listing({ latest_submission: submission("validated") }))).toBe("removed");
    // A listed skill keeps serving its validated snapshot while a newer submission is reviewed.
    expect(catalogPhase(listing({ listed_publicly: true, latest_submission: submission("proposed") }))).toBe("published");
  });
});

describe("PublicReleaseDialog catalog publication", () => {
  it("is absent, with no catalog request, when the catalog is off", async () => {
    const fetchMock = stubApi([]);
    const container = await mount(skill(), null);
    expect(section(container)).toBeNull();
    expect(container.textContent).not.toContain("Public catalog");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("explains that personal skills must be shared first, without reading or offering publication", async () => {
    const fetchMock = stubApi([]);
    const container = await mount(skill({ scope: "personal" }), ACME);
    expect(section(container)?.textContent).toContain("Personal skills can’t be published to the catalog.");
    expect(section(container)?.querySelectorAll("button")).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lets an Owner/Admin publish, then shows the frozen proposed version", async () => {
    const fetchMock = stubApi([
      getStatus(listing()),
      { method: "PUT", path: STATUS_PATH, status: 200, body: { ...listing({ latest_submission: submission("proposed") }), changed: true } },
    ]);
    const container = await mount(skill(), ACME);
    expect(badge(container)).toBe("Not published");
    expect(section(container)?.textContent).toContain("Only MIT or Apache-2.0 licensed skills are accepted.");
    expect(button(container, "Request publication")).toBeUndefined();

    await click(button(container, "Publish to catalog"));
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("PUT");
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ listed: true });
    expect(badge(container)).toBe("Proposed");
    expect(section(container)?.textContent).toContain("v1.2.3 is frozen for review");
    expect(button(container, "Publish to catalog")).toBeUndefined();
    expect(button(container, "Withdraw submission")).toBeDefined();
  });

  it("lets a Developer request publication for an admin, with no listing authority", async () => {
    const fetchMock = stubApi([
      getStatus(listing({ can_manage_listing: false })),
      {
        method: "POST",
        path: REQUEST_PATH,
        status: 200,
        body: { ...listing({ can_manage_listing: false, latest_submission: submission("proposed", "publish_request") }), changed: true },
      },
    ]);
    const container = await mount(skill(), ACME);
    expect(button(container, "Publish to catalog")).toBeUndefined();
    expect(section(container)?.textContent).toContain("Only an Owner or Admin can publish.");

    await click(button(container, "Request publication"));
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({});
    expect(badge(container)).toBe("Requested");
    expect(section(container)?.textContent).toContain("An Owner or Admin must publish it");
    // A Developer can neither resubmit nor unpublish once the request is open.
    expect(section(container)?.querySelectorAll("button")).toHaveLength(0);
  });

  it("lets an Owner/Admin publish or decline a Developer's open request", async () => {
    const fetchMock = stubApi([
      getStatus(listing({ latest_submission: submission("proposed", "publish_request") })),
      { method: "PUT", path: STATUS_PATH, status: 200, body: { ...listing({ latest_submission: submission("withdrawn", "publish_request") }), changed: true } },
    ]);
    const container = await mount(skill(), ACME);
    expect(badge(container)).toBe("Requested");
    expect(section(container)?.textContent).toContain("A Developer requested publication.");
    expect(button(container, "Publish to catalog")).toBeDefined();

    await click(button(container, "Decline request"));
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ listed: false });
    expect(badge(container)).toBe("Removed");
    expect(section(container)?.textContent).toContain("withdrawn before validation");
  });

  it("shows the frozen published version from the anonymous catalog and unpublishes it", async () => {
    const published = listing({ listed_publicly: true, listed_at: "2026-10-12T00:00:00.000Z", latest_submission: submission("validated") });
    const fetchMock = stubApi([
      getStatus(published),
      getCatalog("1.2.3"),
      { method: "PUT", path: STATUS_PATH, status: 200, body: { ...published, listed_publicly: false, listed_at: null, changed: true } },
    ]);
    const container = await mount(skill(), ACME);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ credentials: "omit", cache: "no-store" });
    expect(badge(container)).toBe("Published");
    expect(section(container)?.textContent).toContain("v1.2.3 is frozen in the catalog");
    // The listed release is already the public one, so there is nothing new to submit.
    expect(button(container, "Publish to catalog")).toBeUndefined();

    await click(button(container, "Unpublish"));
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({ listed: false });
    expect(badge(container)).toBe("Removed");
    expect(section(container)?.textContent).toContain("Unpublished.");
    expect(button(container, "Publish to catalog")).toBeDefined();
    // Unpublishing never touches the public release or its share link.
    expect(container.querySelector<HTMLInputElement>("#public-release-url")?.value).toContain("/s/share-release-helper");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("offers a new submission when a newer public version replaces the frozen one", async () => {
    stubApi([getStatus(listing({ listed_publicly: true, latest_submission: submission("validated") })), getCatalog("1.2.2")]);
    const container = await mount(skill({ publicVersion: "1.2.3" }), ACME);
    expect(section(container)?.textContent).toContain("v1.2.2 is frozen in the catalog");
    expect(button(container, "Publish to catalog")).toBeDefined();
    expect(button(container, "Unpublish")).toBeDefined();
  });

  it("shows the rejection reason and allows a fresh submission", async () => {
    stubApi([
      getStatus(listing({ latest_submission: submission("rejected"), rejection_reason: "License is GPL-3.0." })),
    ]);
    const container = await mount(skill(), ACME);
    expect(badge(container)).toBe("Rejected");
    expect(section(container)?.querySelector(".catalog-pub__reason")?.textContent).toBe("License is GPL-3.0.");
    expect(button(container, "Publish to catalog")).toBeDefined();
  });

  it("requires a public release before publication", async () => {
    stubApi([getStatus(listing())]);
    const container = await mount(skill({ publicVersion: null }), ACME);
    expect(section(container)?.textContent).toContain("Make a version public before publishing it to the catalog.");
    expect(button(container, "Publish to catalog")).toBeUndefined();
  });

  it("flags a license the catalog does not accept", async () => {
    stubApi([getStatus(listing())]);
    const container = await mount(skill({ license: "GPL-3.0" }), ACME);
    expect(section(container)?.querySelector(".catalog-pub__license")?.textContent).toContain("This skill declares GPL-3.0.");
  });

  it("shows the server's refusal and leaves the status unchanged", async () => {
    stubApi([
      getStatus(listing()),
      { method: "PUT", path: STATUS_PATH, status: 409, body: { error: "prepare a complete public release before requesting publication" } },
    ]);
    const container = await mount(skill(), ACME);
    await click(button(container, "Publish to catalog"));
    expect(badge(container)).toBe("Not published");
    expect(section(container)?.querySelector(".up-errblock")?.textContent).toBe(
      "prepare a complete public release before requesting publication",
    );
  });

  it("reports an unreadable status and retries on request", async () => {
    stubApi([
      { method: "GET", path: STATUS_PATH, status: 503, body: { error: "unavailable" } },
      getStatus(listing()),
    ]);
    const container = await mount(skill(), ACME);
    expect(section(container)?.querySelector("[role='alert']")?.textContent).toContain("Could not load the catalog status.");
    expect(button(container, "Publish to catalog")).toBeUndefined();

    await click(button(container, "Retry"));
    expect(badge(container)).toBe("Not published");
    expect(button(container, "Publish to catalog")).toBeDefined();
  });
});
