import { afterEach, describe, expect, it, vi } from "vitest";
import { metadata } from "./layout";
import { metadata as notFoundMetadata } from "./not-found";
import robots from "./robots";
import sitemap from "./sitemap";

describe("technical SEO routes", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lets every crawler in and points robots.txt at the production sitemap", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("COMPANION_WEB_URL", "");

    expect(robots()).toEqual({
      rules: { userAgent: "*", allow: "/" },
      sitemap: "https://skillpack.app/sitemap.xml",
    });
  });

  it("lists the public pages on the configured origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("COMPANION_WEB_URL", "https://skillpack.app");

    expect(sitemap().map((entry) => entry.url)).toEqual(["https://skillpack.app/", "https://skillpack.app/privacy"]);
  });

  it("gives every page a path-relative canonical and Open Graph URL", () => {
    expect(metadata.alternates?.canonical).toBe("./");
    expect(metadata.openGraph?.url).toBe("./");
  });

  it("titles the 404 page itself and does not canonicalize the missing URL", () => {
    expect(notFoundMetadata.title).toBe("Page not found · Skillpack");
    expect(notFoundMetadata.alternates?.canonical).toBeNull();
  });
});
