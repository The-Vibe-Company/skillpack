import { HOME_DESCRIPTION } from "./siteMetadata";
import { PRODUCTION_SITE_URL } from "./siteUrl";

export type JsonLdValue = string | JsonLdValue[] | JsonLdNode;
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

export type SoftwareSourceCodeFacts = { name: string; description: string; license?: string; codeRepository: string };

/** A SoftwareSourceCode stating only SKILL.md frontmatter facts and the source folder URL. */
export function softwareSourceCodeStructuredData(facts: SoftwareSourceCodeFacts): JsonLdDocument {
  const { name, description, license, codeRepository } = facts;
  if (license) {
    return {
      "@context": "https://schema.org",
      "@graph": [{ "@type": "SoftwareSourceCode", name, description, license, codeRepository }],
    };
  }
  return { "@context": "https://schema.org", "@graph": [{ "@type": "SoftwareSourceCode", name, description, codeRepository }] };
}
