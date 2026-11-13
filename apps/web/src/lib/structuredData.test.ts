import { describe, expect, it } from "vitest";
import { metadata } from "@/app/layout";
import { HOME_STRUCTURED_DATA, blogPostingStructuredData, serializeJsonLd } from "./structuredData";

describe("home structured data", () => {
  it("describes Skillpack as a developer application published by the Skillpack organization on its website", () => {
    expect(HOME_STRUCTURED_DATA["@graph"]).toEqual([
      expect.objectContaining({
        "@type": "SoftwareApplication",
        name: "Skillpack",
        applicationCategory: "DeveloperApplication",
        url: "https://skillpack.app",
        publisher: { "@id": "https://skillpack.app/#org" },
      }),
      {
        "@type": "Organization",
        "@id": "https://skillpack.app/#org",
        name: "Skillpack",
        url: "https://skillpack.app",
        logo: "https://skillpack.app/brand/skillpack-favicon.svg",
        sameAs: ["https://github.com/The-Vibe-Company/skillpack"],
      },
      {
        "@type": "WebSite",
        "@id": "https://skillpack.app/#website",
        name: "Skillpack",
        url: "https://skillpack.app",
        publisher: { "@id": "https://skillpack.app/#org" },
      },
    ]);
  });

  it("describes the application with the same text as the home meta description", () => {
    expect(HOME_STRUCTURED_DATA["@graph"][0]).toMatchObject({ description: metadata.description });
    expect(metadata.description).toBe(
      "Write, version and share SKILL.md agent skills with your team. Install them in Claude Code, Codex or OpenCode in one command. Open source, self-hostable.",
    );
    expect(String(metadata.description).length).toBeLessThanOrEqual(155);
    expect(metadata.openGraph?.description).toBe(metadata.description);
    expect(metadata.twitter?.description).toBe(metadata.description);
  });

  it("claims no ratings or prices, and no social profile but the public GitHub repository", () => {
    const serialized = JSON.stringify(HOME_STRUCTURED_DATA);
    for (const property of ["aggregateRating", "review", "offers", "price"]) {
      expect(serialized).not.toContain(`"${property}"`);
    }
    const profiles = HOME_STRUCTURED_DATA["@graph"].flatMap((node) => (Array.isArray(node.sameAs) ? node.sameAs : node.sameAs ? [node.sameAs] : []));
    expect(profiles).toEqual(["https://github.com/The-Vibe-Company/skillpack"]);
  });

  it("escapes markup so the payload cannot close its script tag", () => {
    const serialized = serializeJsonLd({ name: "</script><script>alert(1)</script>" });
    expect(serialized).not.toContain("<");
    expect(JSON.parse(serialized)).toEqual({ name: "</script><script>alert(1)</script>" });
  });
});

describe("blog post structured data", () => {
  const FACTS = {
    headline: "A post",
    description: "What it covers.",
    datePublished: "2026-10-13",
    url: "https://skillpack.app/blog/a-post",
    image: "https://skillpack.app/blog/a-post/opengraph-image",
    keywords: ["SKILL.md", "Agent Skills"],
    author: { kind: "organization", name: "The Vibe Company", url: "https://thevibecompany.co" },
    homeUrl: "https://skillpack.app/",
    blogUrl: "https://skillpack.app/blog",
  } as const;

  it("states the post's frontmatter facts, credited author, publisher and share image", () => {
    expect(blogPostingStructuredData(FACTS)["@graph"][0]).toEqual({
      "@type": "BlogPosting",
      headline: "A post",
      description: "What it covers.",
      datePublished: "2026-10-13",
      url: "https://skillpack.app/blog/a-post",
      mainEntityOfPage: "https://skillpack.app/blog/a-post",
      image: "https://skillpack.app/blog/a-post/opengraph-image",
      keywords: ["SKILL.md", "Agent Skills"],
      author: { "@type": "Organization", name: "The Vibe Company", url: "https://thevibecompany.co" },
      publisher: {
        "@type": "Organization",
        "@id": "https://skillpack.app/#org",
        name: "Skillpack",
        url: "https://skillpack.app",
      },
    });
  });

  it("credits a named author as a person and omits keywords for an untagged post", () => {
    const [posting] = blogPostingStructuredData({
      ...FACTS,
      keywords: [],
      author: { kind: "person", name: "Ada Lovelace" },
    })["@graph"];

    expect(posting).toMatchObject({ author: { "@type": "Person", name: "Ada Lovelace" } });
    expect(posting).toHaveProperty("author", { "@type": "Person", name: "Ada Lovelace" });
    expect(posting).not.toHaveProperty("keywords");
  });

  it("states a profiled author's about page, portrait, job title and other profiles", () => {
    const [posting] = blogPostingStructuredData({
      ...FACTS,
      author: {
        kind: "person",
        name: "Ada Lovelace",
        url: "https://example.com/about",
        jobTitle: "Co-founder",
        sameAs: ["https://github.com/ada"],
        avatar: "/images/authors/ada.webp",
        imagePath: "/images/authors/ada-400.webp",
      },
    })["@graph"];

    expect(posting).toHaveProperty("author", {
      "@type": "Person",
      name: "Ada Lovelace",
      url: "https://example.com/about",
      image: "https://skillpack.app/images/authors/ada-400.webp",
      jobTitle: "Co-founder",
      sameAs: ["https://github.com/ada"],
    });
  });

  it("adds the Home › Blog › post breadcrumb trail", () => {
    expect(blogPostingStructuredData(FACTS)["@graph"][1]).toEqual({
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://skillpack.app/" },
        { "@type": "ListItem", position: 2, name: "Blog", item: "https://skillpack.app/blog" },
        { "@type": "ListItem", position: 3, name: "A post", item: "https://skillpack.app/blog/a-post" },
      ],
    });
  });

  it("claims no ratings, prices or modification dates the frontmatter does not state", () => {
    const serialized = JSON.stringify(blogPostingStructuredData(FACTS));
    for (const property of ["aggregateRating", "review", "offers", "price", "dateModified", "sameAs"]) {
      expect(serialized).not.toContain(`"${property}"`);
    }
  });
});
