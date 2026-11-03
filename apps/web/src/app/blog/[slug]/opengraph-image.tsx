import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { notFound } from "next/navigation";
import { ImageResponse } from "next/og";
import { BRAND_MARK_STROKES } from "@/components/blog/BrandMark";
import { type BlogPost, findBlogPost, formatBlogDate, loadBlogPosts } from "@/lib/blog";

// One share card per post, drawn from its own title, tags and date, so nothing on it is invented.
// It matches the post's cover on the site: brand mark, dotted ground and a warm glow.

export const alt = "Skillpack blog post";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamicParams = false;

export function generateStaticParams(): { slug: string }[] {
  return loadBlogPosts().map((post) => ({ slug: post.slug }));
}

const INK = "#262a35";
const INK_MUTED = "#5b5f6b";
const LINE = "rgba(38, 42, 53, 0.12)";
// Tags and date share the title's column, which ends left of the large mark in the bottom-right corner.
const FOOTER_MAX_WIDTH = 868;

// Dotted ground and warm glow, as on the home hero; satori draws these reliably only from SVG.
const BACKGROUND = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">` +
    `<defs>` +
    `<pattern id="d" width="26" height="26" patternUnits="userSpaceOnUse"><circle cx="13" cy="13" r="1.5" fill="#262a35" fill-opacity="0.13"/></pattern>` +
    `<radialGradient id="g" cx="950" cy="90" r="460" gradientUnits="userSpaceOnUse" gradientTransform="translate(950 90) scale(1 0.78) translate(-950 -90)">` +
    `<stop offset="0" stop-color="#f59e0b" stop-opacity="0.3"/><stop offset="1" stop-color="#f59e0b" stop-opacity="0"/>` +
    `</radialGradient>` +
    `</defs>` +
    `<rect width="1200" height="630" fill="url(#d)"/><rect width="1200" height="630" fill="url(#g)"/>` +
    `</svg>`,
)}`;

function loadFont(file: string): Promise<Buffer> {
  return readFile(join(process.cwd(), "assets", "fonts", file));
}

function Mark({ size: markSize }: { size: number }) {
  return (
    <svg width={markSize} height={markSize} viewBox="0 0 100 100">
      {BRAND_MARK_STROKES.map((stroke) => (
        <path key={stroke.d} d={stroke.d} stroke={stroke.color} fill="none" strokeWidth={7} strokeLinecap="round" />
      ))}
    </svg>
  );
}

export default async function BlogPostOpenGraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const post = findBlogPost((await params).slug);
  if (!post) notFound();
  return renderBlogPostOpenGraphImage(post);
}

/** Draws the card for any post's title, tags and date; the route above supplies a published post. */
export async function renderBlogPostOpenGraphImage(post: Pick<BlogPost, "title" | "tags" | "date">) {
  const [semibold, regular] = await Promise.all([
    loadFont("inter-tight-semibold-latin.ttf"),
    loadFont("inter-tight-regular-latin.ttf"),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "#fbfbfd",
          color: INK,
          fontFamily: "Inter Tight",
        }}
      >
        <img src={BACKGROUND} width={1200} height={630} alt="" style={{ position: "absolute", inset: 0 }} />
        <div style={{ position: "absolute", right: 56, bottom: 40, display: "flex", opacity: 0.95 }}>
          <Mark size={250} />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30, fontWeight: 600 }}>
          <Mark size={52} />
          <span>Skillpack</span>
          <span style={{ color: INK_MUTED, fontWeight: 400 }}>Blog</span>
        </div>

        <div
          style={{
            display: "flex",
            maxWidth: 860,
            fontSize: post.title.length > 60 ? 64 : 72,
            fontWeight: 600,
            lineHeight: 1.06,
            letterSpacing: "-0.03em",
          }}
        >
          {post.title}
        </div>

        {/* The row stays clear of the large mark: once tags and date outgrow the title's column, whole
            pills and then the date move to a new line instead of shrinking under the mark. */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 14,
            maxWidth: FOOTER_MAX_WIDTH,
            fontSize: 24,
            color: INK_MUTED,
          }}
        >
          {post.tags.map((tag, index) => (
            <span
              key={tag}
              style={{
                display: "flex",
                flexShrink: 0,
                maxWidth: "100%",
                padding: "8px 18px",
                // The extra space before the date rides on the last pill, so a wrapped date starts flush left.
                marginRight: index === post.tags.length - 1 ? 10 : 0,
                border: `1.5px solid ${LINE}`,
                borderRadius: 999,
                background: "#ffffff",
                color: INK,
              }}
            >
              {tag}
            </span>
          ))}
          <span style={{ display: "flex", flexShrink: 0 }}>{formatBlogDate(post.date)}</span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Inter Tight", data: semibold, weight: 600, style: "normal" },
        { name: "Inter Tight", data: regular, weight: 400, style: "normal" },
      ],
    },
  );
}
