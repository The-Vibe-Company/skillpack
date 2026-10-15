import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { extractBlogBlocks, isBlogBlockLanguage, parseBlogBlock, skillCards } from "@/lib/blogBlocks";
import { remarkGfmAlerts, remarkHeadingIds } from "@/lib/blogMarkdown";
import { CodeBlock } from "./CodeBlock";
import { BlogBlockView } from "./ranking/BlogBlockView";

/* Markdown rendering for blog posts. The prose styles live under `.v10-blog__prose` in
   landing.css; code blocks, callouts, structured blocks and the post layout in blog.css. */

type HastNode = { type: string; value?: string; children?: readonly HastNode[] };
/** A hast element's `className` property, as react-markdown hands it over. */
type HastClassName = string | number | boolean | readonly (string | number)[] | null | undefined;

function hastText(node: HastNode | undefined): string {
  if (!node) return "";
  return node.type === "text" ? (node.value ?? "") : (node.children ?? []).map(hastText).join("");
}

function codeLanguage(className: HastClassName): string | null {
  const languageClass = Array.isArray(className) ? className.find((name) => String(name).startsWith("language-")) : undefined;
  return languageClass ? String(languageClass).slice("language-".length) : null;
}

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
    const language = codeLanguage(code?.type === "element" ? code.properties.className : undefined);
    return <CodeBlock language={language}>{children}</CodeBlock>;
  },
};

/** Article components plus the structured blocks (skill cards, takeaways…) a post's fences declare. */
function articleComponents(body: string): Components {
  const cards = skillCards(extractBlogBlocks(body));
  return {
    ...ARTICLE_COMPONENTS,
    pre({ node, children }) {
      const code = node?.children[0];
      const language = codeLanguage(code?.type === "element" ? code.properties.className : undefined);
      if (code?.type === "element" && isBlogBlockLanguage(language)) {
        // The loader validated every block when it read the post, so this parse cannot fail on a built page.
        const block = parseBlogBlock(language, hastText(code).replace(/\n$/, ""));
        return <BlogBlockView block={block} cards={cards} />;
      }
      return <CodeBlock language={language}>{children}</CodeBlock>;
    },
  };
}

const ARTICLE_REMARK_PLUGINS = [remarkGfm, remarkHeadingIds, remarkGfmAlerts];

/**
 * Renders a post body (GFM: tables, task lists, fenced code, alerts, structured blocks) with
 * anchor ids on H2/H3. Raw HTML in Markdown is not rendered.
 */
export function ArticleMarkdown({ body }: { body: string }) {
  return (
    <div className="v10-blog__prose">
      <ReactMarkdown remarkPlugins={ARTICLE_REMARK_PLUGINS} components={articleComponents(body)}>
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

/** Renders published Markdown while dropping raw HTML from the authored body. */
export function PublishedSkillMarkdown({ body }: { body: string }) {
  return (
    <div className="v10-blog__prose">
      <ReactMarkdown
        remarkPlugins={PUBLISHED_SKILL_REMARK_PLUGINS}
        components={PUBLISHED_SKILL_COMPONENTS}
        skipHtml
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
