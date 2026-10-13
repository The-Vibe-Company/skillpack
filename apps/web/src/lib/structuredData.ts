import type { BlogAuthor } from "./blog";
import { HOME_DESCRIPTION } from "./siteMetadata";
import { PRODUCTION_SITE_URL } from "./siteUrl";

export type JsonLdValue = string | number | JsonLdValue[] | JsonLdNode;
type JsonLdNode = { [key: string]: JsonLdValue };
export type JsonLdDocument = { "@context": "https://schema.org"; "@graph": JsonLdNode[] };

const ORGANIZATION_ID = `${PRODUCTION_SITE_URL}/#organization`;

// Facts about the Skillpack product itself, so they stay pinned to skillpack.app even on
// self-hosted deployments. Only add properties the product can back up (no ratings or prices).
export const HOME_STRUCTURED_DATA: JsonLdDocument = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "Skillpack",
      description: HOME_DESCRIPTION,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web",
      url: PRODUCTION_SITE_URL,
      publisher: { "@id": ORGANIZATION_ID },
    },
    {
      "@type": "Organization",
      "@id": ORGANIZATION_ID,
      name: "Skillpack",
      url: PRODUCTION_SITE_URL,
    },
  ],
};

/** Serializes JSON-LD for an inline <script>, escaping `<` so the payload cannot close the tag. */
export function serializeJsonLd(data: JsonLdValue): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export type BlogPostingFacts = {
  headline: string;
  description: string;
  datePublished: string;
  url: string;
  /** Absolute URL of the post's generated share image. */
  image: string;
  /** The post's frontmatter tags. */
  keywords: readonly string[];
  author: BlogAuthor;
  /** Absolute URLs of the site root and the blog index, the post's breadcrumb trail. */
  homeUrl: string;
  blogUrl: string;
};

type JsonLdAuthor = { "@type": "Person"; name: string } | { "@type": "Organization"; name: string; url: string };

function authorNode(author: BlogAuthor): JsonLdAuthor {
  if (author.kind === "person") return { "@type": "Person", name: author.name };
  return { "@type": "Organization", name: author.name, url: author.url };
}

/**
 * A BlogPosting and its breadcrumb trail, stating only what the post's frontmatter and URL say:
 * the credited author, the site publisher, and the share image the site generates for it.
 */
export function blogPostingStructuredData(facts: BlogPostingFacts): JsonLdDocument {
  const posting = {
    "@type": "BlogPosting",
    headline: facts.headline,
    description: facts.description,
    datePublished: facts.datePublished,
    url: facts.url,
    mainEntityOfPage: facts.url,
    image: facts.image,
    author: authorNode(facts.author),
    publisher: { "@type": "Organization", "@id": ORGANIZATION_ID, name: "Skillpack", url: PRODUCTION_SITE_URL },
  };
  const trail = [
    { name: "Home", url: facts.homeUrl },
    { name: "Blog", url: facts.blogUrl },
    { name: facts.headline, url: facts.url },
  ];
  return {
    "@context": "https://schema.org",
    "@graph": [
      facts.keywords.length > 0 ? { ...posting, keywords: [...facts.keywords] } : posting,
      {
        "@type": "BreadcrumbList",
        itemListElement: trail.map((crumb, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: crumb.name,
          item: crumb.url,
        })),
      },
    ],
  };
}
