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

const PUBLISHED_SKILL_COMPONENTS: Components = {
  ...ARTICLE_COMPONENTS,
  // The page owns the only H1 (the skill name), so an authored H1 renders one level down.
  h1({ children }) {
    return <h2>{children}</h2>;
  },
  // Links in a published SKILL.md are authored by the listing workspace, not by Skillpack.
  a({ children, href }) {
    return (
      <a href={href} rel="nofollow ugc noopener noreferrer">
        {children}
      </a>
    );
  },
};

// No heading ids: authored headings must not collide with the ids of the page around them.
const PUBLISHED_SKILL_REMARK_PLUGINS = [remarkGfm, remarkGfmAlerts];

/**
 * Renders a catalog skill's SKILL.md with the article styles. Raw HTML (including the HTML comments
 * that mark managed sections) is dropped rather than shown as escaped text.
 */
export function PublishedSkillMarkdown({ body }: { body: string }) {
  return (
    <div className="v10-blog__prose">
      <ReactMarkdown remarkPlugins={PUBLISHED_SKILL_REMARK_PLUGINS} components={PUBLISHED_SKILL_COMPONENTS} skipHtml>
        {body}
      </ReactMarkdown>
    </div>
  );
}
