/* Remark plugins for blog articles. They only add attributes and wrappers the stylesheet hooks
   into; the text a post's author wrote reaches the page unchanged.

   The plugins see react-markdown's mdast tree. Only the few node fields read or written here are
   typed (https://github.com/syntax-tree/mdast), so the web app does not need mdast's own types. */

type MdProperties = { id?: string; className?: string[]; role?: string };
type MdData = { hName?: string; hProperties?: MdProperties };
type MdPoint = { offset?: number };
type MdNode = {
  type: string;
  value?: string;
  depth?: number;
  children?: MdNode[];
  data?: MdData;
  position?: { start: MdPoint; end: MdPoint };
};
/** The VFile react-markdown hands each transformer; its string form is the Markdown source. */
type MdFile = { toString(): string };

export type TocEntry = { id: string; text: string; depth: 2 | 3 };

/** GitHub-style heading slug: lowercase, punctuation dropped, spaces to hyphens. */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

// An ATX heading of level 2 or 3, as CommonMark allows it: up to three spaces of indent, the
// hashes, then at least one space or tab, and an optional closing run of hashes.
const ATX_TOC_HEADING_RE = /^ {0,3}(#{2,3})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;

/** Plain text of a heading's inline Markdown: code spans, emphasis, links and escapes unwrapped. */
function inlineText(markdown: string): string {
  // Backslash-escaped punctuation is literal, so park it before the emphasis and link passes.
  const escaped: string[] = [];
  return markdown
    .replace(/\\([!-/:-@[-`{-~])/g, (_match, char: string) => `\uE000${escaped.push(char) - 1}\uE001`)
    .replace(/`+([^`]*)`+/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|\*|_|~~)(?=\S)(.+?)(?<=\S)\1/g, "$2")
    .replace(/\uE000(\d+)\uE001/g, (_match, index: string) => escaped[Number(index)] ?? "")
    .trim();
}

/** Text and depth of an H2/H3 source line, or null for anything else. */
function parseTocHeading(line: string): { text: string; depth: 2 | 3 } | null {
  const match = ATX_TOC_HEADING_RE.exec(line);
  const hashes = match?.[1];
  if (!match || !hashes) return null;
  return { text: inlineText(match[2] ?? ""), depth: hashes.length === 2 ? 2 : 3 };
}

/** Hands out unique ids in document order: "setup", then "setup-1", "setup-2"… */
function createSlugger() {
  const seen = new Map<string, number>();
  return (text: string) => {
    const base = slugifyHeading(text) || "section";
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}

/**
 * The H2/H3 outline of a post body. Ids come from the same source lines, in the same order, as
 * the ones `remarkHeadingIds` puts on the rendered headings, so links and anchors always agree.
 */
export function blogTableOfContents(markdown: string): TocEntry[] {
  const slug = createSlugger();
  const entries: TocEntry[] = [];
  let fence: string | null = null;
  for (const line of markdown.split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && (fence === null || (marker[0] === fence[0] && marker.length >= fence.length))) {
      fence = fence === null ? marker : null;
      continue;
    }
    if (fence !== null) continue;
    const heading = parseTocHeading(line);
    if (heading) entries.push({ id: slug(heading.text), ...heading });
  }
  return entries;
}

/**
 * Gives each top-level ATX H2 and H3 the id `blogTableOfContents` lists for it, reading the
 * heading's own source line rather than re-deriving its text from the tree.
 */
export function remarkHeadingIds() {
  return (tree: MdNode, file: MdFile) => {
    const source = file.toString();
    const slug = createSlugger();
    for (const node of tree.children ?? []) {
      if (node.type !== "heading" || (node.depth !== 2 && node.depth !== 3)) continue;
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) continue;
      // The tree's offsets start at the heading's hashes; the outline reads the whole line.
      const lineStart = source.lastIndexOf("\n", start - 1) + 1;
      const heading = parseTocHeading(source.slice(lineStart, end));
      if (!heading) continue;
      node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id: slug(heading.text) } };
    }
  };
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
function takeAlertMarker(quote: MdNode): AlertKind | null {
  const first = quote.children?.[0];
  if (first?.type !== "paragraph" || !first.children) return null;
  const lead = first.children[0];
  if (lead?.type !== "text" || lead.value === undefined) return null;
  const match = ALERT_MARKER_RE.exec(lead.value);
  const kind = match?.[1]?.toLowerCase() ?? "";
  if (!match || !isAlertKind(kind)) return null;
  lead.value = lead.value.slice(match[0].length);
  if (lead.value === "") first.children.shift();
  // `[!NOTE]` followed by a hard break leaves the break as the paragraph's next node.
  if (first.children[0]?.type === "break") first.children.shift();
  if (first.children.length === 0) quote.children?.shift();
  return kind;
}

/**
 * Renders GitHub alert syntax (`> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`,
 * `> [!CAUTION]`) as a labelled callout. Other blockquotes are left as they are.
 */
export function remarkGfmAlerts() {
  const visit = (nodes: MdNode[]) => {
    for (const node of nodes) {
      if (node.type === "blockquote") {
        const kind = takeAlertMarker(node);
        if (kind) {
          node.data = {
            ...node.data,
            hName: "div",
            hProperties: { className: ["v10-callout", `v10-callout--${kind}`], role: "note" },
          };
          const title: MdNode = {
            type: "paragraph",
            data: { hProperties: { className: ["v10-callout__title"] } },
            children: [{ type: "text", value: ALERT_TITLES[kind] }],
          };
          node.children = [title, ...(node.children ?? [])];
        }
      }
      if (node.children) visit(node.children);
    }
  };
  return (tree: MdNode) => visit(tree.children ?? []);
}
