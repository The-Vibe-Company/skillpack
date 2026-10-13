import Link from "next/link";
import { BrandMark } from "./BrandMark";

const GITHUB_URL = "https://github.com/The-Vibe-Company/skillpack";

/** End-of-article invitation, worded from what the article and home page already state. */
export function SignupCta() {
  return (
    <aside className="v10-postcta" aria-labelledby="blog-cta-title">
      <div className="v10-postcta__bg" aria-hidden="true" />
      <BrandMark size={44} />
      <h2 id="blog-cta-title" className="v10-postcta__title">
        Share skills with your whole team.
      </h2>
      <p className="v10-postcta__text">
        Write, version and share SKILL.md packages, then install them into Claude Code, Codex and OpenCode.
      </p>
      <div className="v10-postcta__actions">
        <Link href="/login" className="v10-btn v10-btn--primary v10-btn--lg">
          Get started
        </Link>
        <a className="v10-btn v10-btn--ghost v10-btn--lg" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
          View on GitHub ↗
        </a>
      </div>
    </aside>
  );
}
