import Link from "next/link";
import type { CtaBlock as CtaBlockData } from "@/lib/blogBlocks";
import { BrandMark } from "../BrandMark";
import { BlockMarkdown } from "./BlockMarkdown";

function CtaLink({ href, className, children }: { href: string; className: string; children: React.ReactNode }) {
  // Site paths use client navigation; https links leave in a new tab.
  return href.startsWith("/") ? (
    <Link href={href} className={className}>
      {children}
    </Link>
  ) : (
    <a href={href} className={className} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

/** An in-article sign-up panel: brand mark, one sentence of value, a primary and an optional secondary link. */
export function CtaBlock({ block }: { block: CtaBlockData }) {
  return (
    <aside className="v10-ctablock" aria-label="Skillpack">
      <BrandMark size={36} className="v10-ctablock__mark" />
      <div className="v10-ctablock__body">
        <p className="v10-ctablock__title">
          <BlockMarkdown inline>{block.title}</BlockMarkdown>
        </p>
        {block.text ? (
          <p className="v10-ctablock__text">
            <BlockMarkdown inline>{block.text}</BlockMarkdown>
          </p>
        ) : null}
      </div>
      <div className="v10-ctablock__actions">
        <CtaLink href={block.primary.href} className="v10-btn v10-btn--primary">
          {block.primary.label}
        </CtaLink>
        {block.secondary ? (
          <CtaLink href={block.secondary.href} className="v10-btn v10-btn--ghost">
            {block.secondary.label}
          </CtaLink>
        ) : null}
      </div>
    </aside>
  );
}
