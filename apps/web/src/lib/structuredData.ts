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

export type BlogPostingFacts = { headline: string; description: string; datePublished: string; url: string };

/** A BlogPosting stating only what the post's frontmatter says; no invented author or images. */
export function blogPostingStructuredData(facts: BlogPostingFacts): JsonLdDocument {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BlogPosting",
        headline: facts.headline,
        description: facts.description,
        datePublished: facts.datePublished,
        url: facts.url,
        mainEntityOfPage: facts.url,
      },
    ],
  };
}

export type CatalogSkillFacts = {
  name: string;
  description: string;
  version: string;
  datePublished: string;
  url: string;
};

/** A listed skill, stating only fields the catalog API returns for its pinned public release. */
export function catalogSkillStructuredData(facts: CatalogSkillFacts): JsonLdDocument {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareSourceCode",
        name: facts.name,
        description: facts.description,
        version: facts.version,
        datePublished: facts.datePublished,
        url: facts.url,
        mainEntityOfPage: facts.url,
      },
    ],
  };
}

/** One catalog index page and the skills listed on it; positions continue across pages. */
export function catalogIndexStructuredData(input: {
  name: string;
  url: string;
  firstPosition: number;
  items: { name: string; url: string }[];
}): JsonLdDocument {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        name: input.name,
        url: input.url,
        mainEntity: {
          "@type": "ItemList",
          itemListElement: input.items.map((item, index) => ({
            "@type": "ListItem",
            position: input.firstPosition + index,
            name: item.name,
            url: item.url,
          })),
        },
      },
    ],
  };
}
