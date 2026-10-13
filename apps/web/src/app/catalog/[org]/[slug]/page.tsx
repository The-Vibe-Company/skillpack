import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { BlogShell, PublishedSkillMarkdown } from "@/components/blog/BlogChrome";
import { BLOG_SHARE_IMAGE } from "@/lib/blog";
import { formatBytes, formatDate, truncateMeta } from "@/lib/format";
import {
  CATALOG_PATH,
  catalogInstallCommands,
  catalogSkillPath,
  fetchPublicCatalogSkill,
  isPublicCatalogEnabled,
  type PublicCatalogSkill,
} from "@/lib/publicCatalog";
import { resolveSiteUrl } from "@/lib/siteUrl";
import { catalogSkillStructuredData, serializeJsonLd } from "@/lib/structuredData";

// Unlisting, withdrawal and archiving take effect immediately, so nothing here is cached.
export const dynamic = "force-dynamic";

type CatalogSkillProps = { params: Promise<{ org: string; slug: string }> };

const loadCatalogSkill = cache(async (org: string, slug: string): Promise<PublicCatalogSkill> => {
  if (!isPublicCatalogEnabled()) notFound();
  const skill = await fetchPublicCatalogSkill(org, slug);
  if (!skill) notFound();
  return skill;
});

export async function generateMetadata({ params }: CatalogSkillProps): Promise<Metadata> {
  const { org, slug } = await params;
  const skill = await loadCatalogSkill(org, slug);
  const path = catalogSkillPath(skill.org_slug, skill.skill_slug);
  const description = truncateMeta(skill.description);
  // Social titles are not templated by the root layout, so they carry the suffix themselves.
  const socialTitle = `${skill.name} · Skillpack`;
  return {
    title: skill.name,
    description,
    alternates: { canonical: path },
    openGraph: {
      url: path,
      title: socialTitle,
      description,
      siteName: "Skillpack",
      type: "website",
      images: [BLOG_SHARE_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description,
      images: [{ url: BLOG_SHARE_IMAGE.url, alt: BLOG_SHARE_IMAGE.alt }],
    },
  };
}

export default async function CatalogSkillPage({ params }: CatalogSkillProps) {
  const { org, slug } = await params;
  const skill = await loadCatalogSkill(org, slug);
  const siteUrl = resolveSiteUrl();
  const structuredData = catalogSkillStructuredData({
    name: skill.name,
    description: skill.description,
    version: skill.version,
    datePublished: skill.released_at,
    url: new URL(catalogSkillPath(skill.org_slug, skill.skill_slug), siteUrl).href,
  });
  return (
    <BlogShell footerLabel="Skillpack catalog">
      <article className="v10-wrap v10-blog__article v10-catalog__skill">
        <p className="v10-blog__meta">
          <Link href={CATALOG_PATH}>Catalog</Link>
          <span aria-hidden="true">·</span>
          <span>{skill.org_name}</span>
        </p>
        <h1 className="v10-catalog__title">{skill.name}</h1>
        <p className="v10-catalog__slug mono">
          {skill.org_slug}/{skill.skill_slug}
        </p>
        <p className="v10-catalog__desc">{skill.description}</p>

        <dl className="v10-catalog__facts" aria-label="Release">
          <div>
            <dt>Workspace</dt>
            <dd>{skill.org_name}</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd className="mono">v{skill.version}</dd>
          </div>
          <div>
            <dt>Released</dt>
            <dd>
              <time dateTime={skill.released_at}>{formatDate(skill.released_at)}</time>
            </dd>
          </div>
          <div>
            <dt>Package</dt>
            <dd>{formatBytes(skill.size_bytes)}</dd>
          </div>
          <div className="v10-catalog__fact--wide">
            <dt>SHA-256</dt>
            <dd className="mono">{skill.checksum}</dd>
          </div>
        </dl>

        <section className="v10-catalog__section" aria-labelledby="catalog-install">
          <h2 id="catalog-install">Install</h2>
          <p>
            With access to this skill in the {skill.org_name} workspace, install this release with the Skillpack CLI:
          </p>
          <pre className="v10-catalog__code">
            <code>{catalogInstallCommands({ siteUrl, skillSlug: skill.skill_slug, version: skill.version })}</code>
          </pre>
          <p>
            The catalog does not publish share links. To install from another workspace, ask {skill.org_name} for the
            skill&apos;s share link.
          </p>
        </section>

        <section className="v10-catalog__section" aria-labelledby="catalog-files">
          <h2 id="catalog-files">Files</h2>
          <ul className="v10-catalog__files">
            {skill.files.map((file) => (
              <li key={file.path}>
                <span className="mono">{file.path}</span>
                <span>{formatBytes(file.size_bytes)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="v10-catalog__section" aria-labelledby="catalog-skill-md">
          <h2 id="catalog-skill-md" className="mono">SKILL.md</h2>
          <div className="v10-catalog__body">
            <PublishedSkillMarkdown body={skill.body} />
          </div>
        </section>
      </article>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }} />
    </BlogShell>
  );
}
