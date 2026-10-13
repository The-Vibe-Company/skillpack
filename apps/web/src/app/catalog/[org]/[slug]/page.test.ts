// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PublicCatalogSkill } from "@skillpack/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogSkill } from "../../../../../test/publicCatalogFixtures";
import CatalogSkillPage, { generateMetadata } from "./page";

// SAFETY: React's test harness reads this documented global flag; the test owns its boolean value.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOT_FOUND = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };
const roots: Root[] = [];

function props(org = "acme", slug = "release-helper") {
  return { params: Promise.resolve({ org, slug }) };
}

async function renderSkill(): Promise<HTMLElement> {
  const element = await CatalogSkillPage(props());
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(element);
  });
  return container;
}

const listed = catalogSkill({
  body: "<!-- managed:start -->\n# Release helper\n\nSee [the guide](https://example.com/guide).\n\n<script>alert(1)</script>\n\n## Steps\n\n1. Tag",
  files: [
    { path: "SKILL.md", size_bytes: 512 },
    { path: "scripts/release.sh", size_bytes: 3072 },
  ],
});

function stubSkill(skill: (PublicCatalogSkill & { share_token?: string }) | { error: string } = listed, status = 200) {
  const fetchMock = vi.fn(async () => Response.json(skill, { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("COMPANION_WEB_URL", "https://skillpack.app");
  vi.stubEnv("COMPANION_API_URL", "https://api.skillpack.app");
  vi.stubEnv("SKILLPACK_PUBLIC_CATALOG", "true");
});

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("public catalog skill page", () => {
  it("is a 404 without calling the API while the catalog flag is off", async () => {
    vi.stubEnv("SKILLPACK_PUBLIC_CATALOG", "false");
    const fetchMock = stubSkill();
    await expect(CatalogSkillPage(props())).rejects.toMatchObject(NOT_FOUND);
    await expect(generateMetadata(props())).rejects.toMatchObject(NOT_FOUND);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is a 404 for an unlisted, archived, or missing skill", async () => {
    stubSkill({ error: "not found" }, 404);
    await expect(CatalogSkillPage(props())).rejects.toMatchObject(NOT_FOUND);
  });

  it("shows the pinned release facts, file list, rendered SKILL.md, and report disclosure", async () => {
    stubSkill();
    const container = await renderSkill();
    const text = container.textContent ?? "";

    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("h1")?.textContent).toBe("Release helper");
    expect(text).toContain("Prepare a release.");
    expect(text).toContain("v1.2.3");
    expect(text).toContain("Published by Acme");
    expect(container.querySelector("time")?.getAttribute("dateTime")).toBe("2026-10-01T09:30:00.000Z");
    expect(text).toContain(`sha256:${"a".repeat(64)}`);
    expect(text).toContain("2 KB");
    expect(Array.from(container.querySelectorAll(".v10-catskill__files li .mono")).map((node) => node.textContent))
      .toEqual(["SKILL.md", "scripts/release.sh"]);
    expect(container.querySelector("summary")?.textContent).toBe("Signaler");
    expect(container.querySelector("select[name='reason']")).not.toBeNull();

    // The authored H1 renders one level down so the page keeps a single H1; raw HTML is dropped.
    const prose = container.querySelector(".v10-catskill__body");
    expect(prose?.querySelector("h2")?.textContent).toBe("Release helper");
    expect(prose?.querySelector("a")?.getAttribute("rel")).toBe("nofollow ugc noopener noreferrer");
    expect(prose?.querySelector("script")).toBeNull();
    expect(prose?.textContent).not.toContain("<script>");
    expect(prose?.textContent).not.toContain("<!--");
  });

  it("offers a real slug install command and never a share-token install", async () => {
    stubSkill({ ...listed, share_token: "secret-token" });
    const container = await renderSkill();
    expect(container.querySelector(".v10-code pre")?.textContent).toBe(
      "skillpack auth login --api-url https://skillpack.app/v1\nskillpack install release-helper --version 1.2.3",
    );
    expect(container.innerHTML).not.toContain("--public");
    expect(container.innerHTML).not.toContain("secret-token");
    expect(container.querySelector("a[href^='/s/']")).toBeNull();
  });

  it("titles the page with the skill name and canonicalizes it to its catalog path", async () => {
    stubSkill();
    const metadata = await generateMetadata(props());
    expect(metadata.title).toBe("Release helper");
    expect(metadata.description).toBe("Prepare a release.");
    expect(metadata.alternates?.canonical).toBe("/catalog/acme/release-helper");
    expect(metadata.openGraph?.title).toBe("Release helper · Skillpack");
    expect(metadata.robots).toBeUndefined();
  });

  it("publishes JSON-LD with only fields the catalog API returns", async () => {
    stubSkill();
    const container = await renderSkill();
    const jsonLd = JSON.parse(container.querySelector("script[type='application/ld+json']")?.textContent ?? "{}");
    expect(jsonLd).toEqual({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "SoftwareSourceCode",
          name: "Release helper",
          description: "Prepare a release.",
          version: "1.2.3",
          datePublished: "2026-10-01T09:30:00.000Z",
          url: "https://skillpack.app/catalog/acme/release-helper",
          mainEntityOfPage: "https://skillpack.app/catalog/acme/release-helper",
        },
        {
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: "https://skillpack.app/" },
            { "@type": "ListItem", position: 2, name: "Catalog", item: "https://skillpack.app/catalog" },
            { "@type": "ListItem", position: 3, name: "Release helper", item: "https://skillpack.app/catalog/acme/release-helper" },
          ],
        },
      ],
    });
  });
});
