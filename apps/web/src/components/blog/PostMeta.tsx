import { type BlogAuthor, formatBlogDate } from "@/lib/blog";

/** Publication day and reading time, as one line of small print. */
export function PostMeta({ date, minutes, author }: { date: string; minutes: number; author?: BlogAuthor }) {
  return (
    <p className="v10-postmeta">
      {author ? (
        <span className="v10-postmeta__item v10-postmeta__author">
          By{" "}
          {author.kind === "organization" ? (
            <a href={author.url} target="_blank" rel="noopener noreferrer">
              {author.name}
            </a>
          ) : (
            author.name
          )}
        </span>
      ) : null}
      <time className="v10-postmeta__item" dateTime={date}>
        {formatBlogDate(date)}
      </time>
      <span className="v10-postmeta__item">{minutes} min read</span>
    </p>
  );
}

export function TagList({ tags }: { tags: readonly string[] }) {
  if (tags.length === 0) return null;
  return (
    <ul className="v10-tags" aria-label="Topics">
      {tags.map((tag) => (
        <li key={tag}>{tag}</li>
      ))}
    </ul>
  );
}
