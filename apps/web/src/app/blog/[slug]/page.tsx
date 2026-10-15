import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown, { type Components } from "react-markdown";
import { ArticleMarkdown } from "@/components/blog/ArticleMarkdown";
import { BlogShell } from "@/components/blog/BlogChrome";
import { BlogBanner } from "@/components/blog/BlogCover";
import { PostCard } from "@/components/blog/PostCard";
import { PostMeta, TagList } from "@/components/blog/PostMeta";
import { ReadingProgress } from "@/components/blog/ReadingProgress";
import { RankingHeader } from "@/components/blog/ranking/RankingHeader";
import { StickyCta } from "@/components/blog/ranking/StickyCta";
import { SignupCta } from "@/components/blog/SignupCta";
import { TocActiveState } from "@/components/blog/TocActiveState";
import { TocDisclosure, TocSidebar } from "@/components/blog/TableOfContents";
import {
  blogPostAuthor,
  blogPostImagePath,
  blogPostPath,
  findBlogPost,
  loadBlogPosts,
  readingMinutes,
  relatedBlogPosts,
  splitLeadHeading,
  splitLeadParagraphs,
} from "@/lib/blog";
import { blogFaqEntries, extractBlogBlocks, skillCards, stickyCta } from "@/lib/blogBlocks";
import { blogTableOfContents } from "@/lib/blogMarkdown";
import { inlineMarkdownText } from "@/lib/markdownText";
import { resolveSiteUrl } from "@/lib/siteUrl";
import { blogPostingStructuredData, faqPageStructuredData, serializeJsonLd } from "@/lib/structuredData";

type BlogPostPageProps = { params: Promise<{ slug: string }> };

const ARTICLE_BODY_ID = "article-body";
const ARTICLE_HEADER_ID = "article-header";
const ARTICLE_END_ID = "article-end";

// Posts are files in the build, so every valid slug is prerendered and anything else is a 404.
export const dynamicParams = false;

export function generateStaticParams(): { slug: string }[] {
  return loadBlogPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: BlogPostPageProps): Promise<Metadata> {
  const post = findBlogPost((await params).slug);
  if (!post) notFound();
  const path = blogPostPath(post.slug);
  // The share image comes from ./opengraph-image.tsx; Next adds it to Open Graph by itself.
  const image = { url: blogPostImagePath(post.slug), alt: post.title };
  return {
    // The frontmatter title is written as the search title, so it bypasses the layout's suffix.
    title: { absolute: post.title },
    description: post.description,
    alternates: { canonical: path },
    openGraph: {
      url: path,
      title: post.title,
      description: post.description,
      siteName: "Skillpack",
      type: "article",
      publishedTime: post.date,
      authors: [blogPostAuthor(post).name],
      tags: post.tags,
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
      images: [image],
    },
  };
}

// The body's H1 is set in the article header, outside the reading column.
const TITLE_COMPONENTS: Components = {
  h1({ children }) {
    return <h1 className="v10-post__title">{children}</h1>;
  },
};

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const post = findBlogPost((await params).slug);
  if (!post) notFound();
  const { heading, rest: afterHeading } = splitLeadHeading(post.body);
  const ranking = post.layout === "ranking";
  // A ranking post sets its opening paragraphs in the header; an article keeps them in the body.
  const { lead, rest } = ranking ? splitLeadParagraphs(afterHeading) : { lead: "", rest: afterHeading };
  const blocks = extractBlogBlocks(rest);
  const faq = blogFaqEntries(blocks);
  const sticky = ranking ? stickyCta(blocks) : null;
  const minutes = readingMinutes(post.body);
  const toc = blogTableOfContents(rest);
  const related = relatedBlogPosts(post, loadBlogPosts());
  const author = blogPostAuthor(post);
  const siteUrl = resolveSiteUrl();
  const structuredData = blogPostingStructuredData({
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    url: new URL(blogPostPath(post.slug), siteUrl).href,
    image: new URL(blogPostImagePath(post.slug), siteUrl).href,
    keywords: post.tags,
    author,
    homeUrl: new URL("/", siteUrl).href,
    blogUrl: new URL("/blog", siteUrl).href,
  });
  return (
    <BlogShell>
      <div className={ranking ? "lp v10-post v10-post--ranking" : "lp v10-post"}>
        <ReadingProgress targetId={ARTICLE_BODY_ID} />
        <article>
          {ranking ? (
            <RankingHeader
              id={ARTICLE_HEADER_ID}
              heading={heading}
              lead={lead}
              skillCount={skillCards(blocks).length}
              author={author}
              authorRole={post.authorRole}
              date={post.date}
              dataCollected={post.dataCollected}
              minutes={minutes}
              tags={post.tags}
            />
          ) : (
            <>
              <header id={ARTICLE_HEADER_ID} className="v10-wrap v10-post__header">
                <nav className="v10-crumbs" aria-label="Breadcrumb">
                  <ol>
                    <li>
                      <Link href="/">Home</Link>
                    </li>
                    <li>
                      <Link href="/blog">Blog</Link>
                    </li>
                  </ol>
                </nav>
                <ReactMarkdown components={TITLE_COMPONENTS}>{heading}</ReactMarkdown>
                <PostMeta
                  date={post.date}
                  minutes={minutes}
                  author={author}
                  authorRole={post.authorRole}
                  dataCollected={post.dataCollected}
                />
                <TagList tags={post.tags} />
              </header>

              <div className="v10-wrap v10-post__cover">
                <BlogBanner />
              </div>
            </>
          )}

          <div className="v10-wrap v10-post__layout">
            <div className="v10-post__main">
              {toc.length > 0 ? <TocDisclosure entries={toc} /> : null}
              <div id={ARTICLE_BODY_ID}>
                <ArticleMarkdown body={rest} />
              </div>
            </div>
            {toc.length > 0 ? (
              <aside className="v10-post__aside">
                <TocSidebar entries={toc} />
                <TocActiveState ids={toc.map((entry) => entry.id)} />
              </aside>
            ) : null}
          </div>
        </article>

        <div id={ARTICLE_END_ID} className="v10-wrap v10-post__end">
          <SignupCta />
        </div>

        {related.length > 0 ? (
          <section className="v10-wrap v10-related" aria-labelledby="blog-related-title">
            <h2 id="blog-related-title" className="v10-section-label">
              Keep reading
            </h2>
            <ul className="v10-postgrid">
              {related.map((other) => (
                <li key={other.slug}>
                  <PostCard post={other} headingLevel={3} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {sticky ? (
          <StickyCta
            title={inlineMarkdownText(sticky.title)}
            label={sticky.primary.label}
            href={sticky.primary.href}
            showAfterId={ARTICLE_HEADER_ID}
            hideWhenVisibleId={ARTICLE_END_ID}
            focusWithinId={ARTICLE_BODY_ID}
          />
        ) : null}
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }} />
      {faq.length > 0 ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(faqPageStructuredData(faq)) }} />
      ) : null}
    </BlogShell>
  );
}
