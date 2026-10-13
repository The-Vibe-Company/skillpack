import { afterEach, describe, expect, it, vi } from "vitest";
import { isCatalogLicense, isPublicCatalogEnabled, publicCatalogSkillApiPath } from "./publicCatalog";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("public catalog web helpers", () => {
  it("is enabled only by an explicit true flag", () => {
    vi.stubEnv("SKILLPACK_PUBLIC_CATALOG", "");
    expect(isPublicCatalogEnabled()).toBe(false);
    vi.stubEnv("SKILLPACK_PUBLIC_CATALOG", "1");
    expect(isPublicCatalogEnabled()).toBe(false);
    vi.stubEnv("SKILLPACK_PUBLIC_CATALOG", "true");
    expect(isPublicCatalogEnabled()).toBe(true);
  });

  it("accepts only MIT and Apache-2.0 declarations", () => {
    expect(isCatalogLicense("MIT")).toBe(true);
    expect(isCatalogLicense(" apache-2.0 ")).toBe(true);
    expect(isCatalogLicense("Apache 2.0")).toBe(false);
    expect(isCatalogLicense("GPL-3.0")).toBe(false);
    expect(isCatalogLicense(null)).toBe(false);
  });

  it("encodes slugs in the anonymous catalog path", () => {
    expect(publicCatalogSkillApiPath("acme co", "a/b")).toBe("/v1/public/catalog/skills/acme%20co/a%2Fb");
  });
});
