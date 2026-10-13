// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SkillVM } from "@/lib/types";
import { catalogSkill } from "../../../test/publicCatalogFixtures";
import { PublicReleaseDialog, type PublicReleaseCatalog } from "./PublicReleaseDialog";

// SAFETY: React's test harness reads this documented global flag; the test owns its boolean value.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

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
    license: null,
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

function listingSwitch(container: HTMLElement): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>(".public-release__listing input[role='switch']");
}

const CATALOG_GET = "/v1/public/catalog/skills/acme/release-helper";
const LISTING_PUT = "/v1/skills/release-helper/public-listing";

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("PublicReleaseDialog catalog listing", () => {
  it("is absent when the catalog is off or the actor cannot manage the listing", async () => {
    const fetchMock = stubApi([]);
    const container = await mount(skill(), null);
    expect(listingSwitch(container)).toBeNull();
    expect(container.textContent).not.toContain("List in the public catalog");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stays disabled until a public release exists", async () => {
    const fetchMock = stubApi([]);
    const container = await mount(skill({ publicVersion: null }), { orgSlug: "acme" });
    expect(listingSwitch(container)?.disabled).toBe(true);
    expect(listingSwitch(container)?.checked).toBe(false);
    expect(container.textContent).toContain("Make a version public before listing it in the catalog.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads the listing anonymously, then records consent through the listing endpoint", async () => {
    const fetchMock = stubApi([
      { method: "GET", path: CATALOG_GET, status: 404, body: { error: "not found" } },
      { method: "PUT", path: LISTING_PUT, status: 200, body: { listed_publicly: true, listed_at: "2026-10-13T00:00:00.000Z", changed: true } },
    ]);
    const container = await mount(skill(), { orgSlug: "acme" });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: "omit", cache: "no-store" });
    expect(container.textContent).toContain("search engines can index it");
    expect(container.textContent).toContain("the public link keeps working");
    const toggle = listingSwitch(container);
    expect(toggle?.disabled).toBe(false);
    expect(toggle?.checked).toBe(false);

    await act(async () => {
      toggle?.click();
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ listed: true });
    expect(listingSwitch(container)?.checked).toBe(true);
    expect(container.querySelector(".public-release__catalog-link")?.getAttribute("href")).toBe("/catalog/acme/release-helper");
  });

  it("unlists a listed skill without touching the public release", async () => {
    const fetchMock = stubApi([
      { method: "GET", path: CATALOG_GET, status: 200, body: catalogSkill() },
      { method: "PUT", path: LISTING_PUT, status: 200, body: { listed_publicly: false, listed_at: null, changed: true } },
    ]);
    const container = await mount(skill(), { orgSlug: "acme" });
    expect(listingSwitch(container)?.checked).toBe(true);

    await act(async () => {
      listingSwitch(container)?.click();
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ listed: false });
    expect(listingSwitch(container)?.checked).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.querySelector<HTMLInputElement>("#public-release-url")?.value).toContain("/s/share-release-helper");
  });

  it("keeps the toggle disabled when the listing state cannot be read", async () => {
    stubApi([{ method: "GET", path: CATALOG_GET, status: 429, body: { error: "catalog rate limit exceeded" } }]);
    const container = await mount(skill(), { orgSlug: "acme" });
    expect(listingSwitch(container)?.disabled).toBe(true);
    expect(container.querySelector(".public-release__listing [role='alert']")?.textContent).toBe(
      "Could not load the catalog listing state.",
    );
  });

  it("shows the server's refusal and leaves the listing unchanged", async () => {
    stubApi([
      { method: "GET", path: CATALOG_GET, status: 404, body: { error: "not found" } },
      { method: "PUT", path: LISTING_PUT, status: 403, body: { error: "only an organization Owner/Admin may manage org catalog discovery" } },
    ]);
    const container = await mount(skill(), { orgSlug: "acme" });
    await act(async () => {
      listingSwitch(container)?.click();
    });
    expect(listingSwitch(container)?.checked).toBe(false);
    expect(container.querySelector(".public-release__listing [role='alert']")?.textContent).toBe(
      "only an organization Owner/Admin may manage org catalog discovery",
    );
  });
});
