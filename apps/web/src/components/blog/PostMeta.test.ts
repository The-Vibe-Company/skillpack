import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BLOG_ORGANIZATION_AUTHOR, type BlogAuthor } from "@/lib/blog";
import { PostMeta } from "./PostMeta";

function byline(author: BlogAuthor, authorRole?: string): string {
  return renderToStaticMarkup(createElement(PostMeta, { date: "2026-10-13", minutes: 4, author, authorRole }));
}

describe("post byline", () => {
  it("shows a profiled author's avatar and links their name to their about page", () => {
    const html = byline(
      {
        kind: "person",
        name: "Ada Lovelace",
        url: "https://example.com/about",
        jobTitle: "Co-founder",
        sameAs: [],
        avatar: "/images/authors/ada.webp",
        imagePath: "/images/authors/ada-400.webp",
      },
      "co-founder of Example",
    );

    expect(html).toContain(
      '<span>By <a href="https://example.com/about" target="_blank" rel="noopener noreferrer">Ada Lovelace</a>, co-founder of Example',
    );
    expect(html).toContain(
      '<img class="v10-postmeta__avatar" src="/images/authors/ada.webp" alt="Ada Lovelace" width="44" height="44" decoding="async"/>',
    );
  });

  it("links the organization and leaves an unprofiled author as plain text", () => {
    expect(byline({ kind: "organization", ...BLOG_ORGANIZATION_AUTHOR })).toContain(
      'By <a href="https://thevibecompany.co" target="_blank" rel="noopener noreferrer">The Vibe Company</a>',
    );
    const plain = byline({ kind: "person", name: "Ada Lovelace" });
    expect(plain).toContain("By Ada Lovelace");
    expect(plain).not.toContain("<a ");
    expect(plain).not.toContain("<img");
  });
});
