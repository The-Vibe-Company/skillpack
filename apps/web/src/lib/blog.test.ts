import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BLOG_CONTENT_DIR,
  type BlogPost,
  blogPostAuthor,
  findBlogPost,
  formatBlogDate,
  loadBlogPosts,
  parseBlogPost,
  readingMinutes,
  relatedBlogPosts,
  splitLeadHeading,
  splitLeadParagraphs,
} from "./blog";

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
      tags: [],
      layout: "article",
      body: "\n# Title\n\nBody.\n",
    });
  });

  it("reads optional topic tags and a named author", () => {
    const post = parseBlogPost(
      postSource(`${VALID_FRONTMATTER}\ntags: ["SKILL.md", "Agent Skills"]\nauthor: "Ada Lovelace"`),
      "a-post.md",
    );

    expect(post.tags).toEqual(["SKILL.md", "Agent Skills"]);
    expect(post.author).toBe("Ada Lovelace");
  });

  it.each([
    ["a missing title", 'description: "d"\nslug: a-post\ndate: 2026-10-13', /title/],
    ["an impossible date", 'title: "t"\ndescription: "d"\nslug: a-post\ndate: 2026-02-30', /real day/],
    ["a non-ISO date", 'title: "t"\ndescription: "d"\nslug: a-post\ndate: Oct 13 2026', /YYYY-MM-DD/],
    ["an unknown key", `${VALID_FRONTMATTER}\ndraft: true`, /draft/],
    ["a blank tag", `${VALID_FRONTMATTER}\ntags: ["SKILL.md", " "]`, /tags/],
    ["a blank author", `${VALID_FRONTMATTER}\nauthor: ""`, /author/],
    ["an uppercase slug", 'title: "t"\ndescription: "d"\nslug: A-Post\ndate: 2026-10-13', /kebab-case/],
  ])("rejects %s and names the file", (_label, frontmatter, reason) => {
    expect(() => parseBlogPost(postSource(frontmatter), "a-post.md")).toThrow(/^a-post\.md: invalid frontmatter/);
    expect(() => parseBlogPost(postSource(frontmatter), "a-post.md")).toThrow(reason);
  });

  it("reads the ranking layout, the author's role and the data-collection day", () => {
    const post = parseBlogPost(
      postSource(`${VALID_FRONTMATTER}\nauthor: "Ada Lovelace"\nauthorRole: "co-founder of Example"\nlayout: ranking\ndataCollected: 2026-10-12`),
      "a-post.md",
    );

    expect(post).toMatchObject({ layout: "ranking", authorRole: "co-founder of Example", dataCollected: "2026-10-12" });
    expect(parseBlogPost(postSource(VALID_FRONTMATTER), "a-post.md").layout).toBe("article");
    expect(() => parseBlogPost(postSource(`${VALID_FRONTMATTER}\nauthorRole: "editor"`), "a-post.md")).toThrow(
      "a-post.md: invalid frontmatter (authorRole: authorRole needs an author)",
    );
    expect(() => parseBlogPost(postSource(`${VALID_FRONTMATTER}\nlayout: gallery`), "a-post.md")).toThrow(/a-post\.md: invalid frontmatter \(layout/);
    expect(() => parseBlogPost(postSource(`${VALID_FRONTMATTER}\ndataCollected: 2026-02-30`), "a-post.md")).toThrow(
      /dataCollected: dataCollected must be a real day/,
    );
  });

  it("fails the build when a heading takes a block's fixed anchor", () => {
    const takeaways = "```takeaways\ntitle: Key Takeaways\nitems:\n  - { lead: One., text: Two. }\n```";
    const body = `\n# Title\n\n## Key Takeaways\n\n${takeaways}\n`;

    expect(() => parseBlogPost(postSource(VALID_FRONTMATTER, body), "a-post.md")).toThrow(
      'a-post.md: two outline entries share the anchor "key-takeaways"',
    );
  });

  it("fails the build on an invalid structured block, naming the file and the field", () => {
    const body = "\n# Title\n\n```cta\ntitle: Go\nprimary: { label: Go, href: \"javascript:alert(1)\" }\n```\n";

    expect(() => parseBlogPost(postSource(VALID_FRONTMATTER, body), "a-post.md")).toThrow(
      /^a-post\.md: cta block: primary\.href: must be a site path or an https URL$/,
    );
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
      "f912805c6f2dc98740a4f43222ac697d502b14a3909cac3430756b53481cfd38",
    );
  });

  it("formats the publication day without shifting it across time zones", () => {
    expect(formatBlogDate("2026-10-13")).toBe("October 13, 2026");
    expect(formatBlogDate("2026-01-01")).toBe("January 1, 2026");
  });
});

function fixturePost(slug: string, date: string, tags: string[]): BlogPost {
  return { title: slug, description: "d", slug, date, tags, layout: "article", body: "\n# Title\n" };
}

describe("blog post presentation", () => {
  it("credits a named author, and otherwise the organization from the site footer", () => {
    expect(blogPostAuthor({ author: "Ada Lovelace" })).toEqual({ kind: "person", name: "Ada Lovelace" });
    expect(blogPostAuthor({})).toEqual({
      kind: "organization",
      name: "The Vibe Company",
      url: "https://thevibecompany.co",
    });
    expect(blogPostAuthor(findBlogPost("what-is-skill-md") ?? {})).toMatchObject({ name: "The Vibe Company" });
  });

  it("splits off the leading H1 line without rewriting either half", () => {
    const body = "\n# What is `SKILL.md`?\n\nIntro.\n\n## Section\n";
    const { heading, rest } = splitLeadHeading(body);

    expect(heading).toBe("# What is `SKILL.md`?");
    expect(rest).toBe("\nIntro.\n\n## Section\n");
    expect(body.endsWith(rest)).toBe(true);
    expect(() => splitLeadHeading("Intro first.\n")).toThrow(/must start/);
  });

  it("estimates whole reading minutes from prose, skipping fenced code", () => {
    const prose = Array.from({ length: 460 }, () => "word").join(" ");
    const code = Array.from({ length: 2000 }, () => "token").join(" ");

    expect(readingMinutes("# Short\n\nA few words.")).toBe(1);
    expect(readingMinutes(`# Title\n\n${prose}\n`)).toBe(3);
    expect(readingMinutes(`# Title\n\n${prose}\n\n\`\`\`\n${code}\n\`\`\`\n`)).toBe(3);
    // The published guide is long enough to say so.
    expect(readingMinutes(findBlogPost("what-is-skill-md")?.body ?? "")).toBeGreaterThan(3);
  });

  it("counts the prose inside structured blocks toward reading time, but not their commands, URLs or keys", () => {
    const words = Array.from({ length: 460 }, () => "word").join(" ");
    const faq = `\`\`\`faq\nitems:\n  - question: "Why?"\n    answer: "${words}"\n\`\`\``;
    // 700 flags and a long URL would add three minutes if machine values were read as prose.
    const flags = Array.from({ length: 700 }, (_, index) => `--flag${index}`).join(" ");
    const card = [
      "```skill-card",
      "rank: 1",
      "name: a-skill",
      "maintainer: Ada",
      "bestFor: one thing",
      `source: { label: ada/skills, url: "https://github.com/ada/skills/tree/main/${words.replaceAll(" ", "/")}" }`,
      'repoStars: "1K"',
      'installs: { count: "2K", url: "https://skills.sh/ada/skills/a-skill" }',
      "license: { name: MIT }",
      "focus: Testing",
      `install: "skillpack install github:ada/skills/a-skill ${flags}"`,
      "description: Short.",
      "suitedFor: Teams.",
      "```",
    ].join("\n");

    expect(readingMinutes(`# Title\n\n${faq}\n`)).toBe(3);
    expect(readingMinutes(`# Title\n\n${card}\n`)).toBe(1);
  });

  it("splits off the opening paragraphs, leaving the rest byte for byte", () => {
    const rest = "> [!TIP]\n> Go.\n\n```bash\nline one\n  \nline two\n```\n";

    expect(splitLeadParagraphs(`\nFirst **lead**.\n\nSecond lead.\n\n${rest}`)).toEqual({ lead: "First **lead**.\n\nSecond lead.", rest });
    expect(splitLeadParagraphs("\n## Heading\n\nText.\n")).toEqual({ lead: "", rest: "## Heading\n\nText.\n" });
    expect(splitLeadParagraphs("\nOnly a lead.\n")).toEqual({ lead: "Only a lead.", rest: "" });
  });

  it("relates posts by shared tags, then fills with the newest others", () => {
    const posts = [
      fixturePost("newest", "2026-05-01", ["Releases"]),
      fixturePost("two-shared", "2026-04-01", ["SKILL.md", "Agent Skills"]),
      fixturePost("one-shared", "2026-03-01", ["skill.md"]),
      fixturePost("current", "2026-02-01", ["SKILL.md", "Agent Skills"]),
      fixturePost("oldest", "2026-01-01", []),
    ];
    const current = posts[3];
    if (!current) throw new Error("fixture missing");

    expect(relatedBlogPosts(current, posts).map((post) => post.slug)).toEqual(["two-shared", "one-shared", "newest"]);
    expect(relatedBlogPosts(current, posts, 5).map((post) => post.slug)).toEqual([
      "two-shared",
      "one-shared",
      "newest",
      "oldest",
    ]);
    expect(relatedBlogPosts(current, [current])).toEqual([]);
  });
});
