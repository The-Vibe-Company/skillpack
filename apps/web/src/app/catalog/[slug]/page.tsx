import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CatalogSkillView } from "@/components/catalog/CatalogSkillView";
import { BLOG_SHARE_IMAGE } from "@/lib/blog";
import { catalogSkillPath, findCatalogSkill, loadCatalogSkills, runtimeRelease } from "@/lib/catalog";

type CatalogSkillPageProps = { params: Promise<{ slug: string }> };

// Catalog skills are files in the build, so every valid slug is prerendered and anything else is a 404.
export const dynamicParams = false;

export function generateStaticParams(): { slug: string }[] {
  return loadCatalogSkills().map((skill) => ({ slug: skill.slug }));
}

export async function generateMetadata({ params }: CatalogSkillPageProps): Promise<Metadata> {
  const skill = findCatalogSkill((await params).slug);
  if (!skill) notFound();
  const path = catalogSkillPath(skill.slug);
  // The layout template appends " · Skillpack" to the page title; social titles are not templated.
  const socialTitle = `${skill.slug} · Skillpack`;
  return {
    title: skill.slug,
    description: skill.description,
    alternates: { canonical: path },
    openGraph: {
      url: path,
      title: socialTitle,
      description: skill.description,
      siteName: "Skillpack",
      type: "website",
      images: [BLOG_SHARE_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description: skill.description,
      images: [{ url: BLOG_SHARE_IMAGE.url, alt: BLOG_SHARE_IMAGE.alt }],
    },
  };
}

export default async function CatalogSkillPage({ params }: CatalogSkillPageProps) {
  const skill = findCatalogSkill((await params).slug);
  if (!skill) notFound();
  return <CatalogSkillView skill={skill} release={runtimeRelease()} />;
}
