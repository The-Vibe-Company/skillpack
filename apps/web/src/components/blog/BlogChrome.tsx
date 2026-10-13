import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/* Public blog chrome. Reuses the marketing (v10) page shell so posts read as part of the
   landing site; the article prose styles live under `.v10-blog__prose` in landing.css. */

export const BLOG_CONTENT_ID = "blog-content";

export function BlogShell({ children, footerLabel = "Skillpack blog" }: { children: React.ReactNode; footerLabel?: string }) {
  return (
    <div className="v10-landing v10-blog">
      <a className="v10-skip" href={`#${BLOG_CONTENT_ID}`}>Skip to content</a>
      <header className="v10-nav">
        <div className="v10-wrap v10-nav__inner">
          <Link className="v5-brand" href="/" aria-label="Skillpack home">
            <img className="v10-wordmark" src="/brand/skillpack-wordmark-dark-text.svg" alt="Skillpack" width={520} height={110} />
          </Link>
          <span className="v10-nav__spacer" />
          <div className="v10-nav__actions">
            <Link href="/blog" className="v10-btn v10-btn--ghost v10-btn--sm">
              Blog
            </Link>
            <Link href="/login" className="v10-btn v10-btn--primary v10-btn--sm">
              Get started
            </Link>
          </div>
        </div>
      </header>

      <main id={BLOG_CONTENT_ID}>{children}</main>

      <footer className="v10-footer">
        <div className="v10-wrap v10-footer__inner">
          <Link className="v5-brand" href="/" aria-label="Skillpack home">
            <img className="v10-wordmark v10-wordmark--sm" src="/brand/skillpack-wordmark-dark-text.svg" alt="Skillpack" width={520} height={110} />
          </Link>
          <span className="v10-footer__by">{footerLabel}</span>
          <span className="v10-footer__links">
            <Link href="/blog">Blog</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/">Back to Skillpack</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

const ARTICLE_COMPONENTS: Components = {
  // Wide tables scroll inside the column instead of widening the page on small screens.
  table({ children }) {
    return (
      <div className="v10-blog__tablewrap">
        <table>{children}</table>
      </div>
    );
  },
};

/** Renders a post body (GFM: tables, task lists, fenced code). Raw HTML in Markdown is not rendered. */
export function ArticleMarkdown({ body }: { body: string }) {
  return (
    <div className="v10-blog__prose">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={ARTICLE_COMPONENTS}>
        {body}
      </ReactMarkdown>
    </div>
  );
}

const PUBLISHED_SKILL_COMPONENTS: Components = {
  ...ARTICLE_COMPONENTS,
  // The page owns the only H1 (the skill name), so an authored H1 renders one level down.
  h1({ children }) {
    return <h2>{children}</h2>;
  },
  // Links in a published SKILL.md are authored by the listing workspace, not by Skillpack.
  a({ children, href }) {
    return (
      <a href={href} rel="nofollow ugc noopener noreferrer">
        {children}
      </a>
    );
  },
};

/**
 * Renders a listed skill's SKILL.md with the article styles. Raw HTML (including the HTML comments
 * that mark managed sections) is dropped rather than shown as escaped text.
 */
export function PublishedSkillMarkdown({ body }: { body: string }) {
  return (
    <div className="v10-blog__prose">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={PUBLISHED_SKILL_COMPONENTS} skipHtml>
        {body}
      </ReactMarkdown>
    </div>
  );
}
