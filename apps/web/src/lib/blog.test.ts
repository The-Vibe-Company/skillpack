import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BLOG_CONTENT_DIR, findBlogPost, formatBlogDate, loadBlogPosts, parseBlogPost } from "./blog";

function postSource(frontmatter: string, body = "\n# Title\n\nBody.\n"): string {
  return `---\n${frontmatter}\n---\n${body}`;
}

const VALID_FRONTMATTER = 'title: "A post"\ndescription: "What it covers."\nslug: a-post\ndate: 2026-10-13';

const tempDirs: string[] = [];

function contentDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "skillpack-blog-"));
  tempDirs.push(dir);
  for (const [name, source] of Object.entries(files)) writeFileSync(join(dir, name), source);
  return dir;
}

afterEach(() => {
  tempDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

describe("blog post parsing", () => {
  it("reads frontmatter and keeps the unquoted date as the calendar day", () => {
    const post = parseBlogPost(postSource(VALID_FRONTMATTER), "a-post.md");

    expect(post).toEqual({
      title: "A post",
      description: "What it covers.",
      slug: "a-post",
      date: "2026-10-13",
      body: "\n# Title\n\nBody.\n",
    });
  });

  it.each([
    ["a missing title", 'description: "d"\nslug: a-post\ndate: 2026-10-13', /title/],
    ["an impossible date", 'title: "t"\ndescription: "d"\nslug: a-post\ndate: 2026-02-30', /real day/],
    ["a non-ISO date", 'title: "t"\ndescription: "d"\nslug: a-post\ndate: Oct 13 2026', /YYYY-MM-DD/],
    ["an unknown key", `${VALID_FRONTMATTER}\nauthor: someone`, /author/],
    ["an uppercase slug", 'title: "t"\ndescription: "d"\nslug: A-Post\ndate: 2026-10-13', /kebab-case/],
  ])("rejects %s and names the file", (_label, frontmatter, reason) => {
    expect(() => parseBlogPost(postSource(frontmatter), "a-post.md")).toThrow(/^a-post\.md: invalid frontmatter/);
    expect(() => parseBlogPost(postSource(frontmatter), "a-post.md")).toThrow(reason);
  });

  it("rejects a file without frontmatter or whose slug differs from its file name", () => {
    expect(() => parseBlogPost("# Title\n", "a-post.md")).toThrow(/missing --- frontmatter/);
    expect(() => parseBlogPost(postSource(VALID_FRONTMATTER), "other.md")).toThrow(/must match the file name/);
  });

  it("requires the body to open with its only H1, ignoring headings inside code fences", () => {
    expect(() => parseBlogPost(postSource(VALID_FRONTMATTER, "\nIntro first.\n\n# Title\n"), "a-post.md")).toThrow(
      /must start with its only "# " heading/,
    );
    expect(() => parseBlogPost(postSource(VALID_FRONTMATTER, "\n# Title\n\n# Second\n"), "a-post.md")).toThrow(
      /must start with its only "# " heading/,
    );
    const fenced = "\n# Title\n\n```markdown\n# Sample skill\n```\n";
    expect(parseBlogPost(postSource(VALID_FRONTMATTER, fenced), "a-post.md").body).toBe(fenced);
  });
});

describe("blog post loading", () => {
  it("lists Markdown posts newest first and ignores other files", () => {
    const dir = contentDir({
      "older.md": postSource('title: "Older"\ndescription: "d"\nslug: older\ndate: 2026-01-02'),
      "newer.md": postSource('title: "Newer"\ndescription: "d"\nslug: newer\ndate: 2026-03-04'),
      "same-day-b.md": postSource('title: "B"\ndescription: "d"\nslug: same-day-b\ndate: 2026-02-01'),
      "same-day-a.md": postSource('title: "A"\ndescription: "d"\nslug: same-day-a\ndate: 2026-02-01'),
      "notes.txt": "not a post",
    });

    expect(loadBlogPosts(dir).map((post) => post.slug)).toEqual(["newer", "same-day-a", "same-day-b", "older"]);
    expect(findBlogPost("older", dir)?.title).toBe("Older");
    expect(findBlogPost("missing", dir)).toBeUndefined();
  });

  it("serves the published SKILL.md guide with its body exactly as written in the file", () => {
    const post = findBlogPost("what-is-skill-md");
    const source = readFileSync(join(BLOG_CONTENT_DIR, "what-is-skill-md.md"), "utf8");
    const fileBody = source.slice(source.indexOf("\n---\n", 4) + "\n---\n".length);

    expect(post).toMatchObject({
      title: "What is SKILL.md? The complete guide to Agent Skills (2026)",
      slug: "what-is-skill-md",
      date: "2026-10-13",
    });
    expect(post?.body).toBe(fileBody);
    expect(createHash("sha256").update(post?.body ?? "").digest("hex")).toBe(
      "6415ff9842d9172e77ebe02c5637532881392b9600c98913732935159db67c2c",
    );
  });

  it("formats the publication day without shifting it across time zones", () => {
    expect(formatBlogDate("2026-10-13")).toBe("October 13, 2026");
    expect(formatBlogDate("2026-01-01")).toBe("January 1, 2026");
  });
});
