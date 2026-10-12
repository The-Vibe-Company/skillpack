import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/** Markdown posts live beside the app, not in `src/`, so editors can add one without touching code. */
export const BLOG_CONTENT_DIR = join(process.cwd(), "content", "blog");

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n/;

// Post frontmatter is flat `key: value` lines. Values may be double-quoted (JSON escapes),
// single-quoted ('' escapes a quote) or plain. Anything richer (lists, maps, block scalars,
// comments) is rejected rather than half-parsed, so no YAML dependency is needed.
const FRONTMATTER_LINE_RE = /^([a-z][a-z0-9_-]*):[ \t]*(.*?)[ \t]*$/;
const PLAIN_SCALAR_RE = /^[^\s"'[\]{}>|&*!%@`#,-](?:(?!: | #).)*$/;

function parseFrontmatterValue(raw: string): string | null {
  if (raw.startsWith('"')) {
    try {
      const value = z.string().safeParse(JSON.parse(raw));
      return value.success ? value.data : null;
    } catch {
      return null;
    }
  }
  if (raw.startsWith("'")) {
    return /^'(?:[^']|'')*'$/.test(raw) ? raw.slice(1, -1).replace(/''/g, "'") : null;
  }
  return PLAIN_SCALAR_RE.test(raw) ? raw : null;
}

/** Reads the flat frontmatter block into a string map; schema validation happens afterwards. */
function parseFlatFrontmatter(raw: string, fileName: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    const match = FRONTMATTER_LINE_RE.exec(line);
    const key = match?.[1];
    const value = match ? parseFrontmatterValue(match[2] ?? "") : null;
    if (!key || value === null) throw new Error(`${fileName}: unsupported frontmatter line: ${line}`);
    if (fields.has(key)) throw new Error(`${fileName}: duplicate frontmatter key: ${key}`);
    fields.set(key, value);
  }
  return fields;
}

function isCalendarDay(day: string): boolean {
  const parsed = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(day);
}

const blogFrontmatterSchema = z
  .object({
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    slug: z.string().regex(SLUG_RE, "slug must be lowercase kebab-case"),
    date: z.string().regex(ISO_DAY_RE, "date must be YYYY-MM-DD").refine(isCalendarDay, "date must be a real day"),
  })
  .strict();

export type BlogPost = z.infer<typeof blogFrontmatterSchema> & {
  /** Markdown after the closing frontmatter fence, unmodified. It opens with the post's only H1. */
  body: string;
};

/** Parses one post file. Throws with the file name so a bad post fails the build, not a page view. */
export function parseBlogPost(source: string, fileName: string): BlogPost {
  const match = FRONTMATTER_RE.exec(source);
  if (!match) throw new Error(`${fileName}: missing --- frontmatter block`);
  const fields = parseFlatFrontmatter(match[1] ?? "", fileName);
  const frontmatter = blogFrontmatterSchema.safeParse(Object.fromEntries(fields));
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

export function blogPostPath(slug: string): string {
  return `/blog/${slug}`;
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
