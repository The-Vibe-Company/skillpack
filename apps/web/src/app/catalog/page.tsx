import type { Metadata } from "next";
import Link from "next/link";
import { BlogShell } from "@/components/blog/BlogChrome";
import { BLOG_SHARE_IMAGE } from "@/lib/blog";
import { catalogSkillPath, loadCatalogSkills } from "@/lib/catalog";

// The root layout template turns the page title into "Catalog · Skillpack"; social titles are not
// templated, so they carry the suffix themselves.
const TITLE = "Catalog";
const SOCIAL_TITLE = "Catalog · Skillpack";
const DESCRIPTION = "Official skills maintained in the Skillpack repository.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/catalog" },
  openGraph: {
    url: "/catalog",
    title: SOCIAL_TITLE,
    description: DESCRIPTION,
    siteName: "Skillpack",
    type: "website",
    images: [BLOG_SHARE_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: SOCIAL_TITLE,
    description: DESCRIPTION,
    images: [{ url: BLOG_SHARE_IMAGE.url, alt: BLOG_SHARE_IMAGE.alt }],
  },
};

export default function CatalogIndexPage() {
  const skills = loadCatalogSkills();
  return (
    <BlogShell label="Skillpack catalog">
      <section className="v10-blog__hero">
        <div className="v10-wrap">
          <p className="v10-kick">Skillpack catalog</p>
          <h1 className="v10-blog__title">Catalog</h1>
          <p className="v10-blog__intro">{DESCRIPTION}</p>
        </div>
      </section>

      <div className="v10-wrap v10-blog__list">
        <ul className="v10-blog__posts">
          {skills.map((skill) => (
            <li key={skill.slug} className="v10-blog__item">
              <h2 className="v10-blog__itemtitle">
                <Link href={catalogSkillPath(skill.slug)}>{skill.slug}</Link>
              </h2>
              <p className="v10-blog__itemdesc">{skill.description}</p>
              {skill.license ? <p className="v10-blog__date">License: {skill.license}</p> : null}
            </li>
          ))}
        </ul>
      </div>
    </BlogShell>
  );
}
