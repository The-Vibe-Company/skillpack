// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ArticleMarkdown } from "@/components/blog/ArticleMarkdown";
import { findBlogPost, splitLeadHeading } from "./blog";
import { blogTableOfContents, slugifyHeading } from "./blogMarkdown";

// SAFETY: React's test harness reads this documented global flag; the test owns its boolean value.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

async function renderMarkdown(body: string): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(React.createElement(ArticleMarkdown, { body }));
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

  it("renders every outline entry as an anchor on the matching heading", async () => {
    const post = findBlogPost("what-is-skill-md");
    const { rest } = splitLeadHeading(post?.body ?? "");
    const toc = blogTableOfContents(rest);
    const container = await renderMarkdown(rest);
    const headings = Array.from(container.querySelectorAll("h2, h3"));

    expect(toc.length).toBeGreaterThan(5);
    expect(toc[0]).toEqual({ id: "the-short-answer", text: "The short answer", depth: 2 });
    expect(headings.map((heading) => heading.id)).toEqual(toc.map((entry) => entry.id));
    expect(headings.map((heading) => heading.textContent)).toEqual(toc.map((entry) => entry.text));
  });
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
