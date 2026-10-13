// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogSkills } from "../../../test/publicCatalogFixtures";
import CatalogIndexPage, { generateMetadata } from "./page";

// SAFETY: React's test harness reads this documented global flag; the test owns its boolean value.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOT_FOUND = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };
const roots: Root[] = [];

function props(page?: string) {
  return { searchParams: Promise.resolve(page === undefined ? {} : { page }) };
}

async function renderIndex(page?: string): Promise<HTMLElement> {
  const element = await CatalogIndexPage(props(page));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(element);
  });
  return container;
}

function stubCatalog(skillCount: number) {
  const fetchMock = vi.fn(async (url: string) => {
    const offset = Number(new URL(url).searchParams.get("offset"));
    return Response.json({ skills: catalogSkills(skillCount, offset), next_offset: null });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("COMPANION_WEB_URL", "https://skillpack.app");
  vi.stubEnv("SKILLPACK_PUBLIC_CATALOG", "true");
});

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("public catalog index", () => {
  it("is a 404 without calling the API while the catalog flag is off", async () => {
    vi.stubEnv("SKILLPACK_PUBLIC_CATALOG", "");
    const fetchMock = stubCatalog(3);
    await expect(CatalogIndexPage(props())).rejects.toMatchObject(NOT_FOUND);
    await expect(generateMetadata(props())).rejects.toMatchObject(NOT_FOUND);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is a 404 when the API reports the catalog disabled", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "not found" }, { status: 404 })));
    await expect(CatalogIndexPage(props())).rejects.toMatchObject(NOT_FOUND);
  });

  it("lists skills with links to their catalog pages and a single H1", async () => {
    stubCatalog(3);
    const container = await renderIndex();
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("h1")?.textContent).toBe("Skills catalog");
    const links = Array.from(container.querySelectorAll(".v10-catalog__item h2 a"));
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/catalog/acme/skill-0",
      "/catalog/acme/skill-1",
      "/catalog/acme/skill-2",
    ]);
    expect(container.textContent).toContain("v1.2.3");
    expect(container.textContent).toContain("2026-10-01");
    expect(container.querySelector("nav[aria-label='Catalog pages']")).toBeNull();
  });

  it("paginates with prev/next links only where a page exists", async () => {
    stubCatalog(21);
    const first = await renderIndex();
    expect(first.querySelector("a[rel='next']")?.getAttribute("href")).toBe("/catalog?page=2");
    expect(first.querySelector("a[rel='prev']")).toBeNull();
    expect(first.querySelectorAll(".v10-catalog__item")).toHaveLength(20);

    stubCatalog(4);
    const second = await renderIndex("2");
    expect(second.querySelector("a[rel='prev']")?.getAttribute("href")).toBe("/catalog");
    expect(second.querySelector("a[rel='next']")).toBeNull();
  });

  it("renders an empty first page but 404s for empty or invalid later pages", async () => {
    stubCatalog(0);
    expect((await renderIndex()).textContent).toContain("No skills are listed yet.");
    await expect(CatalogIndexPage(props("2"))).rejects.toMatchObject(NOT_FOUND);
    await expect(CatalogIndexPage(props("0"))).rejects.toMatchObject(NOT_FOUND);
  });

  it("titles each page plainly and canonicalizes it to itself", async () => {
    stubCatalog(21);
    const first = await generateMetadata(props());
    expect(first.title).toBe("Skills catalog");
    expect(first.alternates?.canonical).toBe("/catalog");
    expect(first.openGraph?.title).toBe("Skills catalog · Skillpack");
    expect(first.robots).toBeUndefined();

    const second = await generateMetadata(props("2"));
    expect(second.title).toBe("Skills catalog, page 2");
    expect(second.alternates?.canonical).toBe("/catalog?page=2");
  });

  it("describes the page's skills as an ItemList with continuing positions", async () => {
    stubCatalog(2);
    const container = await renderIndex("2");
    const jsonLd = JSON.parse(container.querySelector("script[type='application/ld+json']")?.textContent ?? "{}");
    expect(jsonLd["@graph"][0]).toEqual({
      "@type": "CollectionPage",
      name: "Skills catalog, page 2",
      url: "https://skillpack.app/catalog?page=2",
      mainEntity: {
        "@type": "ItemList",
        itemListElement: [
          { "@type": "ListItem", position: 21, name: "Skill 20", url: "https://skillpack.app/catalog/acme/skill-20" },
          { "@type": "ListItem", position: 22, name: "Skill 21", url: "https://skillpack.app/catalog/acme/skill-21" },
        ],
      },
    });
  });
});
