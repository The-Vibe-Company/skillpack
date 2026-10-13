import type { Blockquote, Heading, Paragraph, Root, RootContent } from "mdast";
import { toString as mdastToString } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/* Remark plugins for blog articles. They only add attributes and wrappers the stylesheet hooks
   into; the text a post's author wrote reaches the page unchanged. */

export type TocEntry = { id: string; text: string; depth: 2 | 3 };

/** GitHub-style heading slug: lowercase, punctuation dropped, spaces to hyphens. */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

function isTocHeading(node: Heading): node is Heading & { depth: 2 | 3 } {
  return node.depth === 2 || node.depth === 3;
}

/**
 * Gives every H2 and H3 a stable, unique id and returns them in document order. The page and the
 * table of contents both call this on the same Markdown, so links and anchors always agree.
 */
function assignHeadingIds(tree: Root): TocEntry[] {
  const seen = new Map<string, number>();
  const entries: TocEntry[] = [];
  for (const node of tree.children) {
    if (node.type !== "heading" || !isTocHeading(node)) continue;
    const text = mdastToString(node).trim();
    const base = slugifyHeading(text) || "section";
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const id = count === 0 ? base : `${base}-${count}`;
    node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id } };
    entries.push({ id, text, depth: node.depth });
  }
  return entries;
}

export function remarkHeadingIds() {
  return (tree: Root) => {
    assignHeadingIds(tree);
  };
}

/** The H2/H3 outline of a post body, with the same ids `remarkHeadingIds` renders. */
export function blogTableOfContents(markdown: string): TocEntry[] {
  return assignHeadingIds(unified().use(remarkParse).use(remarkGfm).parse(markdown));
}

const ALERT_TITLES = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
} as const;

type AlertKind = keyof typeof ALERT_TITLES;

function isAlertKind(value: string): value is AlertKind {
  return Object.hasOwn(ALERT_TITLES, value);
}

const ALERT_MARKER_RE = /^\[!(\w+)\][ \t]*(?:\n|$)/;

/** Removes a leading `[!KIND]` line from the quote and returns the kind, or null for a plain quote. */
function takeAlertMarker(quote: Blockquote): AlertKind | null {
  const first = quote.children[0];
  if (first?.type !== "paragraph") return null;
  const lead = first.children[0];
  if (lead?.type !== "text") return null;
  const match = ALERT_MARKER_RE.exec(lead.value);
  const kind = match?.[1]?.toLowerCase() ?? "";
  if (!match || !isAlertKind(kind)) return null;
  lead.value = lead.value.slice(match[0].length);
  // `[!NOTE]` followed by a hard break leaves the break as the paragraph's next node.
  if (lead.value === "") first.children.shift();
  if (first.children[0]?.type === "break") first.children.shift();
  if (first.children.length === 0) quote.children.shift();
  return kind;
}

function alertTitle(kind: AlertKind): Paragraph {
  return {
    type: "paragraph",
    data: { hProperties: { className: ["v10-callout__title"] } },
    children: [{ type: "text", value: ALERT_TITLES[kind] }],
  };
}

/**
 * Renders GitHub alert syntax (`> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`,
 * `> [!CAUTION]`) as a labelled callout. Other blockquotes are left as they are.
 */
export function remarkGfmAlerts() {
  const visit = (nodes: RootContent[]) => {
    for (const node of nodes) {
      if (node.type === "blockquote") {
        const kind = takeAlertMarker(node);
        if (kind) {
          node.data = {
            ...node.data,
            hName: "div",
            hProperties: { className: ["v10-callout", `v10-callout--${kind}`], role: "note" },
          };
          node.children.unshift(alertTitle(kind));
        }
      }
      if ("children" in node) visit(node.children);
    }
  };
  return (tree: Root) => visit(tree.children);
}
