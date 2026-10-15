import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const REMARK_PLUGINS = [remarkGfm];
const INLINE_ELEMENTS = ["a", "code", "em", "strong", "del", "br"];

/**
 * Markdown from a block's prose field. `inline` drops the paragraph wrapper so a one-line field
 * can sit inside a heading, a list item or a table cell. Raw HTML is not rendered.
 */
export function BlockMarkdown({ children, inline = false }: { children: string; inline?: boolean }) {
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      skipHtml
      {...(inline ? { allowedElements: INLINE_ELEMENTS, unwrapDisallowed: true } : {})}
    >
      {children}
    </ReactMarkdown>
  );
}
