import Link from "next/link";

/* Public blog chrome. Reuses the marketing (v10) page shell so posts read as part of the
   landing site. Post bodies render through ./ArticleMarkdown, kept apart so pages that only need
   the shell do not ship its copy-button island. */

export const BLOG_CONTENT_ID = "blog-content";

export function BlogShell({ children }: { children: React.ReactNode }) {
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
          <span className="v10-footer__by">Skillpack blog</span>
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
