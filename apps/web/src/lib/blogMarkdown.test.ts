// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ArticleMarkdown, PublishedSkillMarkdown } from "@/components/blog/ArticleMarkdown";
import { loadBlogPosts, splitLeadHeading } from "./blog";
import { blogTableOfContents, slugifyHeading } from "./blogMarkdown";

// SAFETY: React's test harness reads this documented global flag; the test owns its boolean value.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

async function renderMarkdown(body: string, component: typeof ArticleMarkdown = ArticleMarkdown): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(React.createElement(component, { body }));
  });
  return container;
}

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
});

describe("blog table of contents", () => {
  it("slugs headings the way GitHub does", () => {
    expect(slugifyHeading("SKILL.md frontmatter, field by field")).toBe("skillmd-frontmatter-field-by-field");
    expect(slugifyHeading("Why skills exist: progressive disclosure")).toBe("why-skills-exist-progressive-disclosure");
    expect(slugifyHeading("FAQ")).toBe("faq");
  });

  it("lists H2 and H3 headings with unique ids, skipping code samples and other levels", () => {
    const toc = blogTableOfContents(
      "## Setup\n\nText.\n\n### The `name` field\n\n#### Too deep\n\n```markdown\n## Not a heading\n```\n\n## Setup\n",
    );

    expect(toc).toEqual([
      { id: "setup", text: "Setup", depth: 2 },
      { id: "the-name-field", text: "The name field", depth: 3 },
      { id: "setup-1", text: "Setup", depth: 2 },
    ]);
  });

  it("reads inline Markdown, closing hashes and tilde fences the way the renderer does", async () => {
    const body = [
      "## Use **bold**, `code` and [links](https://example.com) ##",
      "",
      "~~~md",
      "## Inside a tilde fence",
      "~~~",
      "",
      "   ### Indented \\*escaped\\*",
      "",
      "Not a heading:",
      "",
      "    ## Indented code",
      "",
      "> ## Quoted",
      "",
      "#### Too deep",
    ].join("\n");
    const toc = blogTableOfContents(body);
    const container = await renderMarkdown(body);

    expect(toc).toEqual([
      { id: "use-bold-code-and-links", text: "Use bold, code and links", depth: 2 },
      { id: "indented-escaped", text: "Indented *escaped*", depth: 3 },
    ]);
    expect(Array.from(container.querySelectorAll("[id]")).map((element) => element.id)).toEqual(
      toc.map((entry) => entry.id),
    );
  });

  it.each(loadBlogPosts().map((post) => [post.slug, post] as const))(
    "anchors every outline entry of %s on the matching rendered heading",
    async (_slug, post) => {
      const { rest } = splitLeadHeading(post.body);
      const toc = blogTableOfContents(rest);
      const container = await renderMarkdown(rest);
      const headings = Array.from(container.querySelectorAll("h2, h3"));

      expect(toc.length).toBeGreaterThan(3);
      expect(headings.map((heading) => heading.id)).toEqual(toc.map((entry) => entry.id));
      expect(headings.map((heading) => heading.textContent)).toEqual(toc.map((entry) => entry.text));
      expect(headings.map((heading) => heading.tagName)).toEqual(toc.map((entry) => `H${entry.depth}`));
    },
  );
});

describe("blog callouts", () => {
  it("renders GitHub alert syntax as a labelled note without the marker", async () => {
    const container = await renderMarkdown(
      "> [!NOTE]\n> Skills load on demand.\n\n> [!warning]\n> Never commit secrets.\n\n> [!CAUTION]\n",
    );
    const callouts = Array.from(container.querySelectorAll(".v10-callout"));

    expect(callouts.map((callout) => callout.className)).toEqual([
      "v10-callout v10-callout--note",
      "v10-callout v10-callout--warning",
      "v10-callout v10-callout--caution",
    ]);
    expect(callouts.every((callout) => callout.getAttribute("role") === "note")).toBe(true);
    expect(callouts[0]?.querySelector(".v10-callout__title")?.textContent).toBe("Note");
    const paragraphs = (callout: Element | undefined) =>
      Array.from(callout?.querySelectorAll("p") ?? []).map((paragraph) => paragraph.textContent);
    expect(paragraphs(callouts[0])).toEqual(["Note", "Skills load on demand."]);
    expect(paragraphs(callouts[1])).toEqual(["Warning", "Never commit secrets."]);
    expect(paragraphs(callouts[2])).toEqual(["Caution"]);
    expect(container.textContent).not.toContain("[!");
  });

  it("leaves ordinary quotes and unknown markers as written", async () => {
    const container = await renderMarkdown("> Just a quote.\n\n> [!FYI]\n> Not an alert kind.\n\n> Text [!NOTE] later.\n");
    const quotes = Array.from(container.querySelectorAll("blockquote"));

    expect(container.querySelector(".v10-callout")).toBeNull();
    expect(quotes.map((quote) => quote.textContent?.trim())).toEqual([
      "Just a quote.",
      "[!FYI]\nNot an alert kind.",
      "Text [!NOTE] later.",
    ]);
  });
});

describe("blog code blocks", () => {
  it("labels each fenced block with its language and gives it a copy button", async () => {
    const container = await renderMarkdown("```bash\nskillpack sync --frozen\n```\n\n```\nplain\n```\n\nUse `inline` code.\n");
    const blocks = Array.from(container.querySelectorAll("[data-code-block]"));

    expect(blocks.map((block) => block.querySelector(".v10-code__lang")?.textContent)).toEqual(["bash", "text"]);
    expect(blocks.map((block) => block.querySelector("pre > code")?.textContent)).toEqual([
      "skillpack sync --frozen\n",
      "plain\n",
    ]);
    expect(blocks.every((block) => block.querySelector("button[aria-label='Copy code']"))).toBe(true);
    expect(container.querySelectorAll("button")).toHaveLength(2);
  });

  it("makes wide tables a focusable, labelled scroll region", async () => {
    const container = await renderMarkdown("| A | B |\n|---|---|\n| 1 | 2 |\n");
    const region = container.querySelector(".v10-blog__tablewrap");

    expect(region?.getAttribute("role")).toBe("region");
    expect(region?.getAttribute("aria-label")).toBe("Table");
    expect(region?.getAttribute("tabindex")).toBe("0");
    expect(region?.querySelector("table")).not.toBeNull();
  });
});

describe("blog structured blocks", () => {
  const CTA = "```cta\ntitle: Share your skills.\nprimary: { label: Sign up, href: /login }\n```\n";

  it("renders a block fence in a post as its component", async () => {
    const container = await renderMarkdown(CTA);

    expect(container.querySelector(".v10-ctablock a.v10-btn--primary")?.getAttribute("href")).toBe("/login");
    expect(container.querySelector("[data-code-block]")).toBeNull();
  });

  it("leaves the same fence as plain code in a published SKILL.md, which a workspace authors", async () => {
    const container = await renderMarkdown(CTA, PublishedSkillMarkdown);

    expect(container.querySelector(".v10-ctablock")).toBeNull();
    expect(container.querySelector("[data-code-block] pre code")?.className).toBe("language-cta");
    expect(container.querySelector("[data-code-block] pre code")?.textContent).toContain("href: /login");
  });
});
