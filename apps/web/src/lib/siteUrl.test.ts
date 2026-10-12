import { describe, expect, it } from "vitest";
import { PRODUCTION_SITE_URL, resolveSiteUrl } from "./siteUrl";

describe("public site URL", () => {
  it("resolves production builds without an override to skillpack.app, never localhost", () => {
    expect(resolveSiteUrl({ NODE_ENV: "production" }).href).toBe(`${PRODUCTION_SITE_URL}/`);
    expect(resolveSiteUrl({ NODE_ENV: "production", COMPANION_WEB_URL: "  " }).href).toBe(`${PRODUCTION_SITE_URL}/`);
  });

  it("falls back to localhost only outside production", () => {
    expect(resolveSiteUrl({ NODE_ENV: "development" }).href).toBe("http://localhost:3000/");
    expect(resolveSiteUrl({ NODE_ENV: "test" }).href).toBe("http://localhost:3000/");
  });

  it("honors a self-hosted COMPANION_WEB_URL override as an origin", () => {
    expect(resolveSiteUrl({ NODE_ENV: "production", COMPANION_WEB_URL: "https://skills.acme.test/app/" }).href)
      .toBe("https://skills.acme.test/");
  });

  it.each(["not a url", "ftp://skills.acme.test", "https://user:secret@skills.acme.test"])(
    "ignores the unusable override %s instead of publishing it",
    (configured) => {
      expect(resolveSiteUrl({ NODE_ENV: "production", COMPANION_WEB_URL: configured }).href)
        .toBe(`${PRODUCTION_SITE_URL}/`);
    },
  );
});
