import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkGfmAlerts, remarkHeadingIds } from "@/lib/blogMarkdown";
import { CodeBlock } from "./CodeBlock";

/* Markdown rendering for blog posts. The prose styles live under `.v10-blog__prose` in
   landing.css; code blocks, callouts and the post layout in blog.css. */

const ARTICLE_COMPONENTS: Components = {
  // Wide tables scroll inside the column instead of widening the page on small screens. The
  // wrapper takes focus so keyboard users can scroll it too.
  table({ children }) {
    return (
      <div className="v10-blog__tablewrap" role="region" aria-label="Table" tabIndex={0}>
        <table>{children}</table>
      </div>
    );
  },
  pre({ node, children }) {
    const code = node?.children[0];
    const className = code?.type === "element" ? code.properties.className : undefined;
    const languageClass = Array.isArray(className) ? className.find((name) => String(name).startsWith("language-")) : undefined;
    return <CodeBlock language={languageClass ? String(languageClass).slice("language-".length) : null}>{children}</CodeBlock>;
  },
};

const ARTICLE_REMARK_PLUGINS = [remarkGfm, remarkHeadingIds, remarkGfmAlerts];

/**
 * Renders a post body (GFM: tables, task lists, fenced code, alerts) with anchor ids on H2/H3.
 * Raw HTML in Markdown is not rendered.
 */
export function ArticleMarkdown({ body }: { body: string }) {
  return (
    <div className="v10-blog__prose">
      <ReactMarkdown remarkPlugins={ARTICLE_REMARK_PLUGINS} components={ARTICLE_COMPONENTS}>
        {body}
      </ReactMarkdown>
    </div>
  );
}
