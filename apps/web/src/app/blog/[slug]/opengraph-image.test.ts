import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { loadBlogPosts } from "@/lib/blog";
import BlogPostOpenGraphImage, {
  contentType,
  dynamicParams,
  generateStaticParams,
  renderBlogPostOpenGraphImage,
  size,
} from "./opengraph-image";

// More and longer tags than any published post, to prove the footer reflows rather than running
// under the large brand mark.
const LONG_TAGS_POST = {
  title: "Claude Code skills not working? Fix discovery in Codex and Cursor",
  tags: ["Agent Skills", "Continuous Integration", "Claude Code", "Troubleshooting", "Skillpack CLI", "Slash commands"],
  date: "2026-10-30",
};

/** Decodes the 8-bit, non-interlaced RGBA PNG the share image is rendered as. */
function decodePng(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  for (let offset = 8; offset < bytes.length; ) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      expect([data[8], data[9], data[12]]).toEqual([8, 6, 0]);
    } else if (type === "IDAT") idat.push(data);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x]!;
      const left = x >= 4 ? pixels[y * stride + x - 4]! : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x]! : 0;
      const upLeft = x >= 4 && y > 0 ? pixels[(y - 1) * stride + x - 4]! : 0;
      const paeth = () => {
        const p = left + up - upLeft;
        const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
        return pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      };
      const predictor = [0, left, up, (left + up) >> 1, filter === 4 ? paeth() : 0][filter!]!;
      pixels[y * stride + x] = (value + predictor) & 0xff;
    }
  }
  return { width, height, pixels };
}

/** The right-most column holding grey ink (pill borders, tag or date text) in the card's lower part. */
function footerInkRightEdge(png: ReturnType<typeof decodePng>): number {
  let right = -1;
  for (let y = 440; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4;
      const [r, g, b] = [png.pixels[i]!, png.pixels[i + 1]!, png.pixels[i + 2]!];
      // The mark's strokes are saturated orange and amber; ink is a neutral grey.
      if (Math.max(r, g, b) - Math.min(r, g, b) < 40 && (r + g + b) / 3 < 170) right = Math.max(right, x);
    }
  }
  return right;
}

async function render(slug: string) {
  return BlogPostOpenGraphImage({ params: Promise.resolve({ slug }) });
}

describe("blog post share image", () => {
  it("is generated for every post at the standard card size", () => {
    expect(generateStaticParams()).toEqual(loadBlogPosts().map((post) => ({ slug: post.slug })));
    expect(dynamicParams).toBe(false);
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
  });

  it("renders a PNG with the brand font for a post and 404s any other slug", async () => {
    const response = await render("what-is-skill-md");
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.headers.get("content-type")).toBe("image/png");
    expect(Array.from(bytes.slice(1, 4), (byte) => String.fromCharCode(byte)).join("")).toBe("PNG");
    await expect(render("no-such-post")).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
  });

  // The large mark's left-most stroke starts at x = 955; tags and date keep a visible gap from it.
  it.each([
    ["how-to-check-agent-skills-in-ci (5 tags)", () => render("how-to-check-agent-skills-in-ci")],
    ["claude-code-skills-not-working (6 tags)", () => render("claude-code-skills-not-working")],
    ["six long tags", () => renderBlogPostOpenGraphImage(LONG_TAGS_POST)],
  ])("keeps the tags and date of %s clear of the large brand mark", async (_name, draw) => {
    const png = decodePng(new Uint8Array(await (await draw()).arrayBuffer()));

    expect(png.width).toBe(size.width);
    expect(footerInkRightEdge(png)).toBeLessThanOrEqual(940);
  });
});
