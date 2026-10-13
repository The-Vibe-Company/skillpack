import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { BlogShell } from "@/components/blog/BlogChrome";
import { BLOG_SHARE_IMAGE } from "@/lib/blog";
import { formatDate } from "@/lib/format";
import {
  CATALOG_PAGE_SIZE,
  catalogIndexPath,
  catalogSkillPath,
  fetchPublicCatalogPage,
  isPublicCatalogEnabled,
  parseCatalogPage,
  type PublicCatalogPage,
} from "@/lib/publicCatalog";
import { resolveSiteUrl } from "@/lib/siteUrl";
import { catalogIndexStructuredData, serializeJsonLd } from "@/lib/structuredData";

// Listing consent can be withdrawn at any time, so every request re-reads the catalog API.
export const dynamic = "force-dynamic";

const TITLE = "Skills catalog";
const DESCRIPTION = "Agent skills whose Skillpack workspaces have listed a public release.";

type CatalogIndexProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Resolves the requested page or 404s: flag off, API disabled, bad `?page=`, or a page past the end. */
const loadCatalogPage = cache(async (rawPage: string | string[] | undefined): Promise<{ page: number; data: PublicCatalogPage }> => {
  if (!isPublicCatalogEnabled()) notFound();
  const page = parseCatalogPage(rawPage);
  if (page === null) notFound();
  const data = await fetchPublicCatalogPage(page);
  if (!data || (page > 1 && data.skills.length === 0)) notFound();
  return { page, data };
});

function pageTitle(page: number): string {
  return page > 1 ? `${TITLE}, page ${page}` : TITLE;
}

export async function generateMetadata({ searchParams }: CatalogIndexProps): Promise<Metadata> {
  const { page } = await loadCatalogPage((await searchParams).page);
  const title = pageTitle(page);
  // Social titles are not templated by the root layout, so they carry the suffix themselves.
  const socialTitle = `${title} · Skillpack`;
  const path = catalogIndexPath(page);
  return {
    title,
    description: DESCRIPTION,
    alternates: { canonical: path },
    openGraph: {
      url: path,
      title: socialTitle,
      description: DESCRIPTION,
      siteName: "Skillpack",
      type: "website",
      images: [BLOG_SHARE_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description: DESCRIPTION,
      images: [{ url: BLOG_SHARE_IMAGE.url, alt: BLOG_SHARE_IMAGE.alt }],
    },
  };
}

export default async function CatalogIndexPage({ searchParams }: CatalogIndexProps) {
  const { page, data } = await loadCatalogPage((await searchParams).page);
  const siteUrl = resolveSiteUrl();
  const structuredData = catalogIndexStructuredData({
    name: pageTitle(page),
    url: new URL(catalogIndexPath(page), siteUrl).href,
    firstPosition: (page - 1) * CATALOG_PAGE_SIZE + 1,
    items: data.skills.map((skill) => ({
      name: skill.name,
      url: new URL(catalogSkillPath(skill.org_slug, skill.skill_slug), siteUrl).href,
    })),
  });
  return (
    <BlogShell footerLabel="Skillpack catalog">
      <section className="v10-blog__hero">
        <div className="v10-wrap">
          <h1 className="v10-blog__title">{TITLE}</h1>
          <p className="v10-blog__intro">{DESCRIPTION}</p>
        </div>
      </section>

      <div className="v10-wrap v10-blog__list">
        {data.skills.length === 0 ? (
          <p className="v10-blog__empty">No skills are listed yet.</p>
        ) : (
          <ol className="v10-blog__posts">
            {data.skills.map((skill) => (
              <li key={`${skill.org_slug}/${skill.skill_slug}`} className="v10-blog__item v10-catalog__item">
                <p className="v10-blog__date">
                  <span>{skill.org_name}</span>
                  <span aria-hidden="true">·</span>
                  <span className="mono">v{skill.version}</span>
                  <span aria-hidden="true">·</span>
                  <time dateTime={skill.released_at}>{formatDate(skill.released_at)}</time>
                </p>
                <h2 className="v10-blog__itemtitle">
                  <Link href={catalogSkillPath(skill.org_slug, skill.skill_slug)}>{skill.name}</Link>
                </h2>
                <p className="v10-blog__itemdesc">{skill.description}</p>
              </li>
            ))}
          </ol>
        )}

        {(page > 1 || data.hasNextPage) && (
          <nav className="v10-catalog__pages" aria-label="Catalog pages">
            {page > 1 ? (
              <Link className="v10-btn v10-btn--ghost v10-btn--sm" href={catalogIndexPath(page - 1)} rel="prev">
                Previous
              </Link>
            ) : <span />}
            <span className="v10-catalog__pagenum">Page {page}</span>
            {data.hasNextPage ? (
              <Link className="v10-btn v10-btn--ghost v10-btn--sm" href={catalogIndexPath(page + 1)} rel="next">
                Next
              </Link>
            ) : <span />}
          </nav>
        )}
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }} />
    </BlogShell>
  );
}
