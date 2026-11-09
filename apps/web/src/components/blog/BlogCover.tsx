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
 * A post's illustrated cover. Decorative like the drawn one: the title sits beside it, so the
 * image is hidden from assistive technology.
 */
function ImageCover({ variant, src }: { variant: "card" | "banner"; src: string }) {
  return (
    <div className={`v10-cover v10-cover--${variant} v10-cover--image`} aria-hidden="true">
      <img className="v10-cover__image" src={src} alt="" width={1536} height={1024} decoding="async" />
    </div>
  );
}

/**
 * A post's cover in listings, drawn from its own title and tags with the brand mark, so no stock
 * image or invented visual stands in for the content. It mirrors the post's Open Graph image and
 * is decorative: the title and tags are printed beside it.
 */
export function BlogCover({ title, tags, image }: { title: string; tags: readonly string[]; image?: string }) {
  if (image) return <ImageCover variant="card" src={image} />;
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

/**
 * The article page's cover. It sits right under the H1 and its tags, so the drawn one carries only
 * the brand; a post with an illustrated cover shows that instead.
 */
export function BlogBanner({ image }: { image?: string } = {}) {
  if (image) return <ImageCover variant="banner" src={image} />;
  return <CoverFrame variant="banner" />;
}
