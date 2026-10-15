import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import type { BlogAuthor } from "@/lib/blog";
import { PostMeta, TagList } from "../PostMeta";
import { BlockMarkdown } from "./BlockMarkdown";

const TITLE_COMPONENTS: Components = {
  h1({ children }) {
    return <h1 className="v10-post__title v10-rankhead__title">{children}</h1>;
  },
};

/**
 * Header of a ranking post: breadcrumb, a "Ranking · N skills" eyebrow, the body's H1, the lead
 * paragraphs as the intro, then the byline with publication and data-collection days.
 */
export function RankingHeader({
  id,
  heading,
  lead,
  skillCount,
  author,
  authorRole,
  date,
  dataCollected,
  minutes,
  tags,
}: {
  id: string;
  heading: string;
  lead: string;
  skillCount: number;
  author: BlogAuthor;
  authorRole?: string;
  date: string;
  dataCollected?: string;
  minutes: number;
  tags: readonly string[];
}) {
  return (
    <header id={id} className="v10-wrap v10-post__header v10-rankhead">
      <div className="v10-rankhead__bg" aria-hidden="true" />
      <nav className="v10-crumbs" aria-label="Breadcrumb">
        <ol>
          <li>
            <Link href="/">Home</Link>
          </li>
          <li>
            <Link href="/blog">Blog</Link>
          </li>
        </ol>
      </nav>
      {skillCount > 0 ? (
        <p className="v10-rankhead__eyebrow">
          Ranking <span aria-hidden="true">·</span> {skillCount} skills
        </p>
      ) : null}
      <ReactMarkdown components={TITLE_COMPONENTS}>{heading}</ReactMarkdown>
      {lead ? (
        <div className="v10-rankhead__lead">
          <BlockMarkdown>{lead}</BlockMarkdown>
        </div>
      ) : null}
      <PostMeta date={date} minutes={minutes} author={author} authorRole={authorRole} dataCollected={dataCollected} />
      <TagList tags={tags} />
    </header>
  );
}
