import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { blogBlockText, extractBlogBlocks, isBlogBlockLanguage, parseBlogBlock, validateBlogBlocks } from "./blogBlocks";
import { blogTableOfContents } from "./blogMarkdown";

/** Markdown posts live beside the app, not in `src/`, so editors can add one without touching code. */
export const BLOG_CONTENT_DIR = join(process.cwd(), "content", "blog");

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n/;

function isCalendarDay(day: string): boolean {
  const parsed = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(day);
}

const blogFrontmatterSchema = z
  .object({
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    slug: z.string().regex(SLUG_RE, "slug must be lowercase kebab-case"),
    // YAML 1.2 (the `yaml` default) keeps an unquoted 2026-10-13 as a string, so no Date coercion.
    date: z.string().regex(ISO_DAY_RE, "date must be YYYY-MM-DD").refine(isCalendarDay, "date must be a real day"),
    // Topics the post actually covers; they drive card labels and related posts, not pages.
    tags: z.array(z.string().trim().min(1)).max(6).default([]),
    // A named person who wrote the post. Without one, the post is credited to the organization.
    author: z.string().trim().min(1).optional(),
    // What the named author does, shown after the name in the byline ("co-founder of …").
    authorRole: z.string().trim().min(1).optional(),
    // `ranking` sets the post as a ranked shortlist: lead in the header, structured blocks, sticky CTA.
    layout: z.enum(["article", "ranking"]).default("article"),
    // The day the post's figures (installs, stars…) were read, when it differs from publication.
    dataCollected: z
      .string()
      .regex(ISO_DAY_RE, "dataCollected must be YYYY-MM-DD")
      .refine(isCalendarDay, "dataCollected must be a real day")
      .optional(),
  })
  .strict()
  .refine((frontmatter) => frontmatter.authorRole === undefined || frontmatter.author !== undefined, {
    message: "authorRole needs an author",
    path: ["authorRole"],
  });

export type BlogPost = z.infer<typeof blogFrontmatterSchema> & {
  /** Markdown after the closing frontmatter fence, unmodified. It opens with the post's only H1. */
  body: string;
};

/** The organization behind Skillpack, as credited in the site footer and root metadata. */
export const BLOG_ORGANIZATION_AUTHOR = { name: "The Vibe Company", url: "https://thevibecompany.co" } as const;

export type BlogAuthor = { kind: "person"; name: string } | { kind: "organization"; name: string; url: string };

export function blogPostAuthor(post: Pick<BlogPost, "author">): BlogAuthor {
  return post.author ? { kind: "person", name: post.author } : { kind: "organization", ...BLOG_ORGANIZATION_AUTHOR };
}

/** Parses one post file. Throws with the file name so a bad post fails the build, not a page view. */
export function parseBlogPost(source: string, fileName: string): BlogPost {
  const match = FRONTMATTER_RE.exec(source);
  if (!match) throw new Error(`${fileName}: missing --- frontmatter block`);
  const frontmatter = blogFrontmatterSchema.safeParse(parseYaml(match[1] ?? ""));
  if (!frontmatter.success) {
    const issues = frontmatter.error.issues.map((issue) => `${issue.path.join(".") || "frontmatter"}: ${issue.message}`);
    throw new Error(`${fileName}: invalid frontmatter (${issues.join("; ")})`);
  }
  if (`${frontmatter.data.slug}.md` !== fileName) {
    throw new Error(`${fileName}: slug "${frontmatter.data.slug}" must match the file name`);
  }
  const body = source.slice(match[0].length);
  // The page renders the body's own H1 instead of the frontmatter title, so the body must lead
  // with exactly one.
  if (!/^\s*# \S/.test(body) || countH1(body) !== 1) {
    throw new Error(`${fileName}: body must start with its only "# " heading`);
  }
  try {
    validateBlogBlocks(extractBlogBlocks(body));
  } catch (error) {
    throw new Error(`${fileName}: ${error instanceof Error ? error.message : String(error)}`);
  }
  // Block anchors are fixed ("key-takeaways", "skill-<name>"), so a heading can claim the same one.
  const anchors = new Set<string>();
  for (const entry of blogTableOfContents(body)) {
    if (anchors.has(entry.id)) throw new Error(`${fileName}: two outline entries share the anchor "${entry.id}"`);
    anchors.add(entry.id);
  }
  return { ...frontmatter.data, body };
}

/** Counts `# ` headings outside fenced code blocks, since SKILL.md samples carry their own. */
function countH1(body: string): number {
  let inFence = false;
  let headings = 0;
  for (const line of body.split("\n")) {
    if (/^(```|~~~)/.test(line)) inFence = !inFence;
    else if (!inFence && line.startsWith("# ")) headings += 1;
  }
  return headings;
}

/** Every post, newest first; ties break by slug so the order is stable. */
export function loadBlogPosts(dir: string = BLOG_CONTENT_DIR): BlogPost[] {
  const posts = readdirSync(dir)
    .filter((fileName) => fileName.endsWith(".md"))
    .map((fileName) => parseBlogPost(readFileSync(join(dir, fileName), "utf8"), fileName));
  return posts.sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}

export function findBlogPost(slug: string, dir: string = BLOG_CONTENT_DIR): BlogPost | undefined {
  return loadBlogPosts(dir).find((post) => post.slug === slug);
}

export type LeadHeadingSplit = { heading: string; rest: string };

/**
 * Splits the body into its leading H1 line and the Markdown after it, so the page can set the
 * title in the article header and the remaining text in the reading column. Both halves are
 * slices of the body; nothing is rewritten.
 */
export function splitLeadHeading(body: string): LeadHeadingSplit {
  const match = /^\s*(# [^\n]*)\n?/.exec(body);
  if (!match) throw new Error("body must start with its only \"# \" heading");
  return { heading: match[1] ?? "", rest: body.slice(match[0].length) };
}

export type LeadParagraphsSplit = { lead: string; rest: string };

/**
 * Splits off the plain paragraphs that open the Markdown (after the H1), up to the first heading,
 * quote, list, table or fenced block. A ranking post sets them in its header as the intro.
 */
export function splitLeadParagraphs(markdown: string): LeadParagraphsSplit {
  // Walk paragraph by paragraph and cut at an offset, so the rest is a byte-exact slice.
  const separator = /\n[ \t]*\n\s*/g;
  let start = /^\s*/.exec(markdown)?.[0].length ?? 0;
  let end = start;
  while (start < markdown.length && !/^(#|>|```|~~~|\||[-*+] |\d+[.)] |<)/.test(markdown.slice(start))) {
    separator.lastIndex = start;
    const next = separator.exec(markdown);
    end = next ? next.index : markdown.length;
    start = next ? next.index + next[0].length : markdown.length;
  }
  return { lead: markdown.slice(0, end).trim(), rest: markdown.slice(start) };
}

const WORDS_PER_MINUTE = 230;

/** Whole minutes to read the prose, at least one. Fenced code is skimmed, so it is not counted. */
export function readingMinutes(body: string): number {
  const countWords = (line: string) => line.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
  let fence: { language: string; lines: string[] } | null = null;
  let words = 0;
  for (const line of body.split("\n")) {
    if (/^(```|~~~)/.test(line)) {
      // Structured blocks are prose in YAML clothing, so their reader-facing text counts.
      if (fence && isBlogBlockLanguage(fence.language)) {
        words += countWords(blogBlockText(parseBlogBlock(fence.language, fence.lines.join("\n"))).replace(/\n/g, " "));
      }
      fence = fence ? null : { language: line.replace(/^(```|~~~)\s*/, "").split(/\s/)[0] ?? "", lines: [] };
    } else if (fence) fence.lines.push(line);
    else words += countWords(line);
  }
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}

/**
 * Up to `limit` other posts, most shared tags first. Posts sharing no tag fill the remaining
 * places newest first, so a post with unique tags still links onward.
 */
export function relatedBlogPosts(post: BlogPost, posts: readonly BlogPost[], limit = 3): BlogPost[] {
  const tags = new Set(post.tags.map((tag) => tag.toLowerCase()));
  const shared = (other: BlogPost) => other.tags.filter((tag) => tags.has(tag.toLowerCase())).length;
  // `posts` is newest first and Array#sort is stable, so equal overlaps keep that order.
  return posts
    .filter((other) => other.slug !== post.slug)
    .map((other) => ({ other, score: shared(other) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ other }) => other);
}

export function blogPostPath(slug: string): string {
  return `/blog/${slug}`;
}

/** The share image `app/blog/[slug]/opengraph-image.tsx` generates for a post. */
export function blogPostImagePath(slug: string): string {
  return `${blogPostPath(slug)}/opengraph-image`;
}

/** "October 13, 2026". Pinned to UTC so the calendar day never shifts with the server's zone. */
export function formatBlogDate(day: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}

/** The site-wide share card. Blog pages restate it because a page's `openGraph` replaces the layout's. */
export const BLOG_SHARE_IMAGE = {
  url: "/brand/og.png",
  width: 1200,
  height: 630,
  alt: "Skillpack — Share skills with your whole team.",
} as const;
