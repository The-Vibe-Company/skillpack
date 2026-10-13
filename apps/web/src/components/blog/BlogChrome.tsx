import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/* Public blog chrome. Reuses the marketing (v10) page shell so posts read as part of the
   landing site; the article prose styles live under `.v10-blog__prose` in landing.css. */

export const BLOG_CONTENT_ID = "blog-content";

/** `label` names the section in the footer; the catalog reuses this shell with its own label. */
export function BlogShell({ children, label = "Skillpack blog" }: { children: React.ReactNode; label?: string }) {
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
          <span className="v10-footer__by">{label}</span>
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

// A SKILL.md body sits under the page's own H1, so its authored H1s become H2s.
const EMBEDDED_COMPONENTS: Components = {
  ...ARTICLE_COMPONENTS,
  h1({ children }) {
    return <h2>{children}</h2>;
  },
};

/**
 * Renders a post body (GFM: tables, task lists, fenced code). Raw HTML in Markdown is not rendered
 * as markup: posts show it as literal text, and `embedded` documents (a SKILL.md under a page
 * heading) drop it and demote H1s to H2s.
 */
export function ArticleMarkdown({ body, embedded = false }: { body: string; embedded?: boolean }) {
  return (
    <div className="v10-blog__prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={embedded ? EMBEDDED_COMPONENTS : ARTICLE_COMPONENTS}
        skipHtml={embedded}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
