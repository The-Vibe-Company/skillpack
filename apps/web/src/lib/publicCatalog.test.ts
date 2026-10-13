import { afterEach, describe, expect, it, vi } from "vitest";
import {
  catalogIndexPath,
  catalogInstallCommands,
  catalogSkillPath,
  fetchPublicCatalogPage,
  fetchPublicCatalogSkill,
  isCatalogLicense,
  isPublicCatalogEnabled,
  listAllPublicCatalogSkills,
  parseCatalogPage,
  publicCatalogSkillApiPath,
} from "./publicCatalog";
import { catalogSkill, catalogSkills as skills } from "../../test/publicCatalogFixtures";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("public catalog flag", () => {
  it("is off unless SKILLPACK_PUBLIC_CATALOG is exactly true", () => {
    vi.stubEnv("SKILLPACK_PUBLIC_CATALOG", "");
    expect(isPublicCatalogEnabled()).toBe(false);
    vi.stubEnv("SKILLPACK_PUBLIC_CATALOG", "1");
    expect(isPublicCatalogEnabled()).toBe(false);
    vi.stubEnv("SKILLPACK_PUBLIC_CATALOG", "true");
    expect(isPublicCatalogEnabled()).toBe(true);
  });
});

describe("catalog licenses", () => {
  it("accepts only MIT and Apache-2.0 declarations", () => {
    expect(isCatalogLicense("MIT")).toBe(true);
    expect(isCatalogLicense(" apache-2.0 ")).toBe(true);
    expect(isCatalogLicense("Apache 2.0")).toBe(false);
    expect(isCatalogLicense("GPL-3.0")).toBe(false);
    expect(isCatalogLicense(null)).toBe(false);
  });
});

describe("catalog paths", () => {
  it("uses /catalog because /skills is the authenticated library", () => {
    expect(catalogSkillPath("acme", "release-helper")).toBe("/catalog/acme/release-helper");
    expect(catalogIndexPath(1)).toBe("/catalog");
    expect(catalogIndexPath(3)).toBe("/catalog?page=3");
  });

  it("encodes slugs in the anonymous catalog API path", () => {
    expect(publicCatalogSkillApiPath("acme co", "a/b")).toBe("/v1/public/catalog/skills/acme%20co/a%2Fb");
  });

  it("accepts only canonical page numbers within the API offset bound", () => {
    expect(parseCatalogPage(undefined)).toBe(1);
    expect(parseCatalogPage("2")).toBe(2);
    expect(parseCatalogPage("501")).toBe(501);
    for (const value of ["0", "-1", "02", "1.5", "abc", "", "502", ["1", "2"]]) {
      expect(parseCatalogPage(value)).toBeNull();
    }
  });
});

describe("catalogInstallCommands", () => {
  it("uses real CLI commands and never a share-token install", () => {
    const commands = catalogInstallCommands({
      siteUrl: new URL("https://skills.example.com"),
      skillSlug: "release-helper",
      version: "1.2.3",
    });
    expect(commands).toBe(
      "skillpack auth login --api-url https://skills.example.com/v1\nskillpack install release-helper --version 1.2.3",
    );
    expect(commands).not.toContain("--public");
  });
});

describe("catalog API reads", () => {
  it("requests one extra row anonymously so Next never links to an empty page", async () => {
    vi.stubEnv("COMPANION_API_URL", "http://127.0.0.1:55001");
    const fetchMock = vi.fn(async () => Response.json({ skills: skills(21, 20), next_offset: 41 }));
    vi.stubGlobal("fetch", fetchMock);

    const page = await fetchPublicCatalogPage(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:55001/v1/public/catalog/skills?limit=21&offset=20",
      { cache: "no-store" },
    );
    expect(page?.skills).toHaveLength(20);
    expect(page?.hasNextPage).toBe(true);

    fetchMock.mockResolvedValueOnce(Response.json({ skills: skills(20, 20), next_offset: null }));
    expect((await fetchPublicCatalogPage(2))?.hasNextPage).toBe(false);
  });

  it("treats an API 404 as a disabled catalog and fails loudly on other errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "not found" }, { status: 404 })));
    await expect(fetchPublicCatalogPage(1)).resolves.toBeNull();
    await expect(fetchPublicCatalogSkill("acme", "release-helper")).resolves.toBeNull();
    await expect(listAllPublicCatalogSkills()).resolves.toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "rate limited" }, { status: 429 })));
    await expect(fetchPublicCatalogPage(1)).rejects.toThrow("429");
  });

  it("drops fields outside the public contract, such as a share token", async () => {
    vi.stubEnv("COMPANION_API_URL", "http://127.0.0.1:55001");
    const fetchMock = vi.fn(async () => Response.json({ ...catalogSkill(), share_token: "secret-token" }));
    vi.stubGlobal("fetch", fetchMock);

    const skill = await fetchPublicCatalogSkill("acme", "release-helper");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:55001/v1/public/catalog/skills/acme/release-helper",
      { cache: "no-store" },
    );
    expect(skill).toEqual(catalogSkill());
    expect(JSON.stringify(skill)).not.toContain("secret-token");
  });

  it("never asks the API for slugs that cannot name a listed skill", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchPublicCatalogSkill("Acme", "release-helper")).resolves.toBeNull();
    await expect(fetchPublicCatalogSkill("acme", "../secrets")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("walks every full page for the sitemap and stops at a short one", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const offset = Number(new URL(url).searchParams.get("offset"));
      return Response.json({ skills: offset === 0 ? skills(50) : skills(3, 50), next_offset: null });
    });
    vi.stubGlobal("fetch", fetchMock);

    const all = await listAllPublicCatalogSkills();
    expect(all).toHaveLength(53);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => new URL(url).search)).toEqual([
      "?limit=50&offset=0",
      "?limit=50&offset=50",
    ]);
  });
});
