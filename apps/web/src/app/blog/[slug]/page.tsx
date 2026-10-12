import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArticleMarkdown, BlogShell } from "@/components/blog/BlogChrome";
import { BLOG_SHARE_IMAGE, blogPostPath, findBlogPost, formatBlogDate, loadBlogPosts } from "@/lib/blog";
import { resolveSiteUrl } from "@/lib/siteUrl";
import { blogPostingStructuredData, serializeJsonLd } from "@/lib/structuredData";

type BlogPostPageProps = { params: Promise<{ slug: string }> };

// Posts are files in the build, so every valid slug is prerendered and anything else is a 404.
export const dynamicParams = false;

export function generateStaticParams(): { slug: string }[] {
  return loadBlogPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: BlogPostPageProps): Promise<Metadata> {
  const post = findBlogPost((await params).slug);
  if (!post) notFound();
  const path = blogPostPath(post.slug);
  return {
    // The frontmatter title is written as the search title, so it is used as-is (no suffix).
    title: post.title,
    description: post.description,
    alternates: { canonical: path },
    openGraph: {
      url: path,
      title: post.title,
      description: post.description,
      siteName: "Skillpack",
      type: "article",
      publishedTime: post.date,
      images: [BLOG_SHARE_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
      images: [{ url: BLOG_SHARE_IMAGE.url, alt: BLOG_SHARE_IMAGE.alt }],
    },
  };
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const post = findBlogPost((await params).slug);
  if (!post) notFound();
  const structuredData = blogPostingStructuredData({
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    url: new URL(blogPostPath(post.slug), resolveSiteUrl()).href,
  });
  return (
    <BlogShell>
      <article className="v10-wrap v10-blog__article">
        <p className="v10-blog__meta">
          <Link href="/blog">Blog</Link>
          <span aria-hidden="true">·</span>
          <time dateTime={post.date}>{formatBlogDate(post.date)}</time>
        </p>
        {/* The body opens with the post's own H1, so the frontmatter title is not rendered again. */}
        <ArticleMarkdown body={post.body} />
      </article>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }} />
    </BlogShell>
  );
}
