import { BrandMark } from "./BrandMark";

function CoverFrame({ variant, children }: { variant: "card" | "banner"; children?: React.ReactNode }) {
  return (
    <div className={`v10-cover v10-cover--${variant}`} aria-hidden="true">
      <div className="v10-cover__bg" />
      <BrandMark size={120} className="v10-cover__mark" />
      <div className="v10-cover__inner">
        <p className="v10-cover__brand">
          <BrandMark size={16} />
          <span>Skillpack</span>
          <span className="v10-cover__section">Blog</span>
        </p>
        {children}
      </div>
    </div>
  );
}

/**
 * A post's cover in listings, drawn from its own title and tags with the brand mark, so no stock
 * image or invented visual stands in for the content. It mirrors the post's Open Graph image and
 * is decorative: the title and tags are printed beside it.
 */
export function BlogCover({ title, tags }: { title: string; tags: readonly string[] }) {
  return (
    <CoverFrame variant="card">
      <p className="v10-cover__title">{title}</p>
      {tags.length > 0 ? (
        <p className="v10-cover__tags">
          {tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </p>
      ) : null}
    </CoverFrame>
  );
}

/** The article page's cover. It sits right under the H1 and its tags, so it carries only the brand. */
export function BlogBanner() {
  return <CoverFrame variant="banner" />;
}
