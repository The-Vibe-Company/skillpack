import type { Metadata } from "next";
import Link from "next/link";
import { BlogShell } from "@/components/blog/BlogChrome";
import { BLOG_SHARE_IMAGE, blogPostPath, formatBlogDate, loadBlogPosts } from "@/lib/blog";

// The root layout template turns the page title into "Blog · Skillpack"; social titles are not
// templated, so they carry the suffix themselves.
const TITLE = "Blog";
const SOCIAL_TITLE = "Blog · Skillpack";
const DESCRIPTION = "Guides on SKILL.md, Agent Skills, and running a shared skill library for your team's coding agents.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/blog" },
  openGraph: {
    url: "/blog",
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

export default function BlogIndexPage() {
  const posts = loadBlogPosts();
  return (
    <BlogShell>
      <section className="v10-blog__hero">
        <div className="v10-wrap">
          <p className="v10-kick">Skillpack blog</p>
          <h1 className="v10-blog__title">Blog</h1>
          <p className="v10-blog__intro">{DESCRIPTION}</p>
        </div>
      </section>

      <div className="v10-wrap v10-blog__list">
        {posts.length === 0 ? (
          <p className="v10-blog__empty">No posts yet.</p>
        ) : (
          <ol className="v10-blog__posts">
            {posts.map((post) => (
              <li key={post.slug} className="v10-blog__item">
                <time className="v10-blog__date" dateTime={post.date}>
                  {formatBlogDate(post.date)}
                </time>
                <h2 className="v10-blog__itemtitle">
                  <Link href={blogPostPath(post.slug)}>{post.title}</Link>
                </h2>
                <p className="v10-blog__itemdesc">{post.description}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </BlogShell>
  );
}
