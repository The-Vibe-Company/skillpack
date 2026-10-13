import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { PublishedSkillMarkdown } from "@/components/blog/ArticleMarkdown";
import { BlogShell } from "@/components/blog/BlogChrome";
import { CodeBlock } from "@/components/blog/CodeBlock";
import { CatalogReportForm } from "@/components/catalog/CatalogReportForm";
import { BLOG_SHARE_IMAGE } from "@/lib/blog";
import { formatBytes, formatHumanDateUTC, truncateMeta } from "@/lib/format";
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
    homeUrl: new URL("/", siteUrl).href,
    catalogUrl: new URL(CATALOG_PATH, siteUrl).href,
  });
  return (
    <BlogShell footerLabel="Skillpack catalog">
      <div className="lp v10-post v10-catalog">
        <article>
          <header className="v10-wrap v10-post__header">
            <nav className="v10-crumbs" aria-label="Breadcrumb">
              <ol>
                <li>
                  <Link href="/">Home</Link>
                </li>
                <li>
                  <Link href={CATALOG_PATH}>Catalog</Link>
                </li>
              </ol>
            </nav>
            <h1 className="v10-post__title v10-catskill__title">{skill.name}</h1>
            <p className="v10-catskill__desc">{skill.description}</p>
            <p className="v10-postmeta">
              <span className="v10-postmeta__item v10-postmeta__author">Published by {skill.org_name}</span>
              <span className="v10-postmeta__item mono">v{skill.version}</span>
              <time className="v10-postmeta__item" dateTime={skill.released_at}>
                {formatHumanDateUTC(skill.released_at)}
              </time>
            </p>
          </header>

          <div className="v10-wrap v10-catskill__layout">
            <div className="v10-catskill__main">
              <section className="v10-catskill__panel v10-catskill__install" aria-labelledby="catalog-install">
                <h2 id="catalog-install" className="v10-section-label">Install</h2>
                <p>Members of {skill.org_name} can install this release with the Skillpack CLI:</p>
                <CodeBlock language="sh">
                  <code>{catalogInstallCommands({ siteUrl, skillSlug: skill.skill_slug, version: skill.version })}</code>
                </CodeBlock>
                <p>The catalog does not publish share links. To install from another workspace, ask {skill.org_name} for the skill&apos;s share link.</p>
              </section>

              <CatalogReportForm orgSlug={skill.org_slug} skillSlug={skill.skill_slug} />

              <section aria-labelledby="catalog-skill-md">
                <h2 id="catalog-skill-md" className="v10-section-label">SKILL.md</h2>
                <div className="v10-catskill__body">
                  <PublishedSkillMarkdown body={skill.body} />
                </div>
              </section>
            </div>

            <aside className="v10-catskill__aside">
              <section className="v10-catskill__panel" aria-labelledby="catalog-release">
                <h2 id="catalog-release" className="v10-section-label">Release</h2>
                <dl className="v10-catskill__facts">
                  <div>
                    <dt>Slug</dt>
                    <dd className="mono">{skill.org_slug}/{skill.skill_slug}</dd>
                  </div>
                  <div>
                    <dt>Version</dt>
                    <dd className="mono">{skill.version}</dd>
                  </div>
                  <div>
                    <dt>Package</dt>
                    <dd>{formatBytes(skill.size_bytes)}</dd>
                  </div>
                  <div>
                    <dt>SHA-256</dt>
                    <dd className="mono v10-catskill__checksum">{skill.checksum}</dd>
                  </div>
                </dl>
              </section>

              <section className="v10-catskill__panel" aria-labelledby="catalog-files">
                <h2 id="catalog-files" className="v10-section-label">Files</h2>
                <ul className="v10-catskill__files">
                  {skill.files.map((file) => (
                    <li key={file.path}>
                      <span className="mono">{file.path}</span>
                      <span>{formatBytes(file.size_bytes)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </aside>
          </div>
        </article>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }} />
    </BlogShell>
  );
}
