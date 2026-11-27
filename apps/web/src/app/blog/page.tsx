import type { Metadata } from "next";
import { BlogShell } from "@/components/blog/BlogChrome";
import { PostCard } from "@/components/blog/PostCard";
import { BLOG_SHARE_IMAGE, blogPostPath, loadBlogPosts } from "@/lib/blog";
import { resolveSiteUrl } from "@/lib/siteUrl";
import { blogIndexStructuredData, serializeJsonLd } from "@/lib/structuredData";
// Classique styles for the blog routes.
import "@/styles/label.css";
import "@/styles/blog-label.css";

// The root layout template appends " · Skillpack" to the page title; social titles are not
// templated, so they carry the suffix themselves.
const TITLE = "Agent Skills Guides for Claude Code & Codex";
const SOCIAL_TITLE = `${TITLE} · Skillpack`;
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
  // Newest first: the latest post leads the page and the rest follow as a grid.
  const posts = loadBlogPosts();
  const [latest, ...older] = posts;
  const siteUrl = resolveSiteUrl();
  const structuredData = blogIndexStructuredData({
    name: TITLE,
    description: DESCRIPTION,
    url: new URL("/blog", siteUrl).href,
    homeUrl: new URL("/", siteUrl).href,
    items: posts.map((post) => ({ name: post.title, url: new URL(blogPostPath(post.slug), siteUrl).href })),
  });
  return (
    <BlogShell label>
      <div className="lp v10-bloghome">
        <header className="v10-bloghome__hero">
          <div className="v10-wrap v10-bloghome__intro">
            <p className="lp-kick">Skillpack blog</p>
            <h1 className="v10-bloghome__title">Guides to SKILL.md and Agent Skills</h1>
            <p className="lp-sub">Writing, versioning and sharing skills for your team&apos;s coding agents.</p>
          </div>
        </header>

        <div className="v10-wrap v10-bloghome__posts">
          {latest ? (
            <section aria-label="Latest post">
              <PostCard post={latest} featured headingLevel={2} />
            </section>
          ) : (
            <p className="v10-bloghome__empty">No posts yet.</p>
          )}
          {older.length > 0 ? (
            <section className="v10-bloghome__more" aria-labelledby="blog-more-posts">
              <h2 id="blog-more-posts" className="v10-section-label">
                More posts
              </h2>
              <ul className="v10-postgrid">
                {older.map((post) => (
                  <li key={post.slug} className="v5-reveal">
                    <PostCard post={post} headingLevel={3} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }} />
    </BlogShell>
  );
}
