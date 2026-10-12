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
