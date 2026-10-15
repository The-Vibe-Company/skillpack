import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { TocEntry } from "./blogMarkdown";
import { inlineMarkdownText } from "./markdownText";

/*
 * Structured blocks a post can embed as fenced code with a reserved language, for example
 *
 *   ```skill-card
 *   rank: 1
 *   name: frontend-design
 *   …
 *   ```
 *
 * The body stays one Markdown file in document order; each block's YAML is validated when the post
 * is loaded, so a typo fails the build instead of rendering a broken page. Prose fields
 * (`description`, `answer`, `text`…) are Markdown. On GitHub the blocks read as YAML code.
 */

const text = z.string().trim().min(1);
// Links stay on this site or go to an https origin; nothing else reaches an href. Browsers drop
// tabs and newlines from URLs and read `\` as `/`, so either would let "/\t/host" leave the site.
const SITE_PATH_RE = /^\/(?![/\\])[^\s\\\p{Cc}]*$/u;
const HTTPS_URL_RE = /^https:\/\/[^\s\\\p{Cc}]+$/u;
const href = z
  .string()
  .trim()
  .refine((value) => SITE_PATH_RE.test(value) || HTTPS_URL_RE.test(value), {
    message: "must be a site path or an https URL",
  });
const httpsUrl = z.string().trim().regex(HTTPS_URL_RE, "must be an https URL");
const link = z.object({ label: text, href }).strict();

const takeawaysSchema = z
  .object({
    title: text,
    items: z.array(z.object({ lead: text, text }).strict()).min(1),
  })
  .strict();

const skillCardSchema = z
  .object({
    rank: z.number().int().positive(),
    /** The skill's slug, shown literally and used for its anchor. */
    name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "name must be a lowercase skill slug"),
    /** Display name for the card heading when it differs from the slug. */
    title: text.optional(),
    maintainer: text,
    bestFor: text,
    source: z.object({ label: text, url: httpsUrl }).strict(),
    /** GitHub stars of the whole repository that holds the skill. */
    repoStars: text,
    installs: z.object({ count: text.optional(), url: httpsUrl, note: text.optional() }).strict(),
    license: z.object({ name: text, note: text.optional(), declared: z.boolean().default(true) }).strict(),
    focus: text,
    install: z.string().trim().regex(/^skillpack install \S+/, "install must be a `skillpack install` command"),
    description: text,
    suitedFor: text,
  })
  .strict();

const comparisonSchema = z.object({ caption: text.optional() }).strict();

const useCasesSchema = z
  .object({
    rows: z.array(z.object({ useCase: text, start: text, add: text, why: text }).strict()).min(1),
  })
  .strict();

const faqSchema = z
  .object({ items: z.array(z.object({ question: text, answer: text }).strict()).min(1) })
  .strict();

const ctaSchema = z
  .object({
    title: text,
    text: text.optional(),
    primary: link,
    secondary: link.optional(),
    /** Also offer this call to action in the page's discreet sticky bar. At most one per post. */
    sticky: z.boolean().default(false),
  })
  .strict();

const SCHEMAS = {
  takeaways: takeawaysSchema,
  "skill-card": skillCardSchema,
  "skill-comparison": comparisonSchema,
  "use-cases": useCasesSchema,
  faq: faqSchema,
  cta: ctaSchema,
} as const;

export type BlogBlockLanguage = keyof typeof SCHEMAS;
export type TakeawaysBlock = z.infer<typeof takeawaysSchema>;
export type SkillCardBlock = z.infer<typeof skillCardSchema>;
export type ComparisonBlock = z.infer<typeof comparisonSchema>;
export type UseCasesBlock = z.infer<typeof useCasesSchema>;
export type FaqBlock = z.infer<typeof faqSchema>;
export type CtaBlock = z.infer<typeof ctaSchema>;

export type BlogBlock =
  | { kind: "takeaways"; data: TakeawaysBlock }
  | { kind: "skill-card"; data: SkillCardBlock }
  | { kind: "skill-comparison"; data: ComparisonBlock }
  | { kind: "use-cases"; data: UseCasesBlock }
  | { kind: "faq"; data: FaqBlock }
  | { kind: "cta"; data: CtaBlock };

export function isBlogBlockLanguage(language: string | null | undefined): language is BlogBlockLanguage {
  return language != null && Object.hasOwn(SCHEMAS, language);
}

/** Parses and validates one block's YAML. Throws a message naming the block and the bad fields. */
export function parseBlogBlock(language: BlogBlockLanguage, source: string): BlogBlock {
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (error) {
    throw new Error(`${language} block: invalid YAML (${error instanceof Error ? error.message : String(error)})`);
  }
  // An empty block (no YAML at all) means "no options".
  const result = SCHEMAS[language].safeParse(raw ?? {});
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join(".") || language}: ${issue.message}`);
    throw new Error(`${language} block: ${issues.join("; ")}`);
  }
  // SAFETY: `result.data` was produced by SCHEMAS[language], the schema BlogBlock pairs with this kind.
  return { kind: language, data: result.data } as BlogBlock;
}

/** Every block of a Markdown body, in document order. Ordinary fenced code is skipped. */
export function extractBlogBlocks(markdown: string): BlogBlock[] {
  const blocks: BlogBlock[] = [];
  let fence: { marker: string; language: string; lines: string[] } | null = null;
  for (const line of markdown.split("\n")) {
    const opening = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/.exec(line);
    if (fence === null) {
      if (opening?.[1]) fence = { marker: opening[1], language: opening[2] ?? "", lines: [] };
      continue;
    }
    const closing = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line)?.[1];
    if (closing && closing[0] === fence.marker[0] && closing.length >= fence.marker.length) {
      if (isBlogBlockLanguage(fence.language)) blocks.push(parseBlogBlock(fence.language, fence.lines.join("\n")));
      fence = null;
      continue;
    }
    fence.lines.push(line);
  }
  return blocks;
}

/** Rules that span blocks: ranks run 1…n in order, names are unique, one sticky call to action. */
export function validateBlogBlocks(blocks: readonly BlogBlock[]): void {
  const cards = skillCards(blocks);
  cards.forEach((card, index) => {
    if (card.rank !== index + 1) throw new Error(`skill-card "${card.name}" has rank ${card.rank}; expected ${index + 1}`);
  });
  for (const card of cards) {
    const mismatch = githubInstallMismatch(card);
    if (mismatch) throw new Error(`skill-card "${card.name}": ${mismatch}`);
  }
  const names = new Set(cards.map((card) => card.name));
  if (names.size !== cards.length) throw new Error("skill-card names must be unique");
  if (blocks.some((block) => block.kind === "skill-comparison") && cards.length === 0) {
    throw new Error("skill-comparison block needs at least one skill-card");
  }
  if (blocks.filter((block) => block.kind === "cta" && block.data.sticky).length > 1) {
    throw new Error("only one cta block can be sticky");
  }
}

/**
 * A GitHub install command must fetch the folder the card links to as its source, so a reader
 * never installs something other than what the card reviews. Returns the problem, or null.
 */
function githubInstallMismatch(card: SkillCardBlock): string | null {
  const installed = /^skillpack install github:([^/\s@]+\/[^/\s@]+)\/(\S+?)(?:@\S+)?(?:\s|$)/.exec(card.install);
  const linked = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/tree\/[^/]+\/(.+?)\/?$/.exec(card.source.url);
  if (!installed || !linked) return null;
  if (installed[1] !== linked[1] || installed[2] !== linked[2]) {
    return `install fetches ${installed[1]}/${installed[2]} but source links ${linked[1]}/${linked[2]}`;
  }
  return null;
}

export function skillCards(blocks: readonly BlogBlock[]): SkillCardBlock[] {
  return blocks.flatMap((block) => (block.kind === "skill-card" ? [block.data] : []));
}

export const TAKEAWAYS_ID = "key-takeaways";

export function skillCardId(name: string): string {
  return `skill-${name}`;
}

export function skillCardTitle(card: SkillCardBlock): string {
  return card.title ?? card.name;
}

/** Outline entries a block contributes: the takeaways box as a section, each skill card under it. */
export function blogBlockTocEntries(block: BlogBlock): TocEntry[] {
  if (block.kind === "takeaways") return [{ id: TAKEAWAYS_ID, text: block.data.title, depth: 2 }];
  if (block.kind === "skill-card") {
    return [{ id: skillCardId(block.data.name), text: `${block.data.rank}. ${skillCardTitle(block.data)}`, depth: 3 }];
  }
  return [];
}

/** The prose a reader reads in a block, for reading time. Machine values such as URLs are left out. */
export function blogBlockText(block: BlogBlock): string {
  switch (block.kind) {
    case "takeaways":
      return [block.data.title, ...block.data.items.flatMap((item) => [item.lead, item.text])].join("\n");
    case "skill-card":
      return [skillCardTitle(block.data), block.data.bestFor, block.data.description, block.data.suitedFor].join("\n");
    case "use-cases":
      return block.data.rows.map((row) => [row.useCase, row.start, row.add, row.why].join(" ")).join("\n");
    case "faq":
      return block.data.items.map((item) => `${item.question}\n${item.answer}`).join("\n");
    case "cta":
      return [block.data.title, block.data.text ?? ""].join("\n");
    case "skill-comparison":
      return block.data.caption ?? "";
  }
}

/** FAQ entries as plain text, for FAQPage JSON-LD that says exactly what the page shows. */
export function blogFaqEntries(blocks: readonly BlogBlock[]): { question: string; answer: string }[] {
  return blocks.flatMap((block) =>
    block.kind === "faq"
      ? block.data.items.map((item) => ({
          question: inlineMarkdownText(item.question),
          answer: item.answer.split(/\n\s*\n/).map(inlineMarkdownText).join("\n\n"),
        }))
      : [],
  );
}

export function stickyCta(blocks: readonly BlogBlock[]): CtaBlock | null {
  for (const block of blocks) if (block.kind === "cta" && block.data.sticky) return block.data;
  return null;
}
