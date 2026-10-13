import { describe, expect, it } from "vitest";
import { loadBlogPosts } from "@/lib/blog";
import BlogPostOpenGraphImage, { contentType, dynamicParams, generateStaticParams, size } from "./opengraph-image";

describe("blog post share image", () => {
  it("is generated for every post at the standard card size", () => {
    expect(generateStaticParams()).toEqual(loadBlogPosts().map((post) => ({ slug: post.slug })));
    expect(dynamicParams).toBe(false);
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
  });

  it("renders a PNG with the brand font for a post and 404s any other slug", async () => {
    const response = await BlogPostOpenGraphImage({ params: Promise.resolve({ slug: "what-is-skill-md" }) });
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.headers.get("content-type")).toBe("image/png");
    expect(Array.from(bytes.slice(1, 4), (byte) => String.fromCharCode(byte)).join("")).toBe("PNG");
    await expect(BlogPostOpenGraphImage({ params: Promise.resolve({ slug: "no-such-post" }) })).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
  });
});
