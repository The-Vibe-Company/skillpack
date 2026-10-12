import { describe, expect, it } from "vitest";
import { metadata } from "@/app/layout";
import { HOME_STRUCTURED_DATA, blogPostingStructuredData, serializeJsonLd } from "./structuredData";

describe("home structured data", () => {
  it("describes Skillpack as a developer application published by the Skillpack organization", () => {
    expect(HOME_STRUCTURED_DATA["@graph"]).toEqual([
      expect.objectContaining({
        "@type": "SoftwareApplication",
        name: "Skillpack",
        applicationCategory: "DeveloperApplication",
        url: "https://skillpack.app",
        publisher: { "@id": "https://skillpack.app/#organization" },
      }),
      expect.objectContaining({
        "@type": "Organization",
        "@id": "https://skillpack.app/#organization",
        name: "Skillpack",
        url: "https://skillpack.app",
      }),
    ]);
  });

  it("describes the application with the same text as the home meta description", () => {
    expect(HOME_STRUCTURED_DATA["@graph"][0]).toMatchObject({ description: metadata.description });
    expect(metadata.openGraph?.description).toBe(metadata.description);
    expect(metadata.twitter?.description).toBe(metadata.description);
  });

  it("claims no ratings, prices, or social profiles the product cannot back up", () => {
    const serialized = JSON.stringify(HOME_STRUCTURED_DATA);
    for (const property of ["aggregateRating", "review", "offers", "price", "sameAs"]) {
      expect(serialized).not.toContain(`"${property}"`);
    }
  });

  it("escapes markup so the payload cannot close its script tag", () => {
    const serialized = serializeJsonLd({ name: "</script><script>alert(1)</script>" });
    expect(serialized).not.toContain("<");
    expect(JSON.parse(serialized)).toEqual({ name: "</script><script>alert(1)</script>" });
  });
});

describe("blog post structured data", () => {
  it("states only the post's frontmatter facts and its URL", () => {
    const data = blogPostingStructuredData({
      headline: "A post",
      description: "What it covers.",
      datePublished: "2026-10-13",
      url: "https://skillpack.app/blog/a-post",
    });

    expect(data).toEqual({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "BlogPosting",
          headline: "A post",
          description: "What it covers.",
          datePublished: "2026-10-13",
          url: "https://skillpack.app/blog/a-post",
          mainEntityOfPage: "https://skillpack.app/blog/a-post",
        },
      ],
    });
  });
});
