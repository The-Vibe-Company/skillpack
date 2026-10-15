import { type BlogAuthor, formatBlogDate } from "@/lib/blog";

/**
 * Byline, publication day and reading time, as one line of small print. A post whose figures were
 * read on a given day also states that day, and then labels which date is which.
 */
export function PostMeta({
  date,
  minutes,
  author,
  authorRole,
  dataCollected,
}: {
  date: string;
  minutes: number;
  author?: BlogAuthor;
  authorRole?: string;
  dataCollected?: string;
}) {
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
          {authorRole ? `, ${authorRole}` : null}
        </span>
      ) : null}
      {dataCollected ? (
        <>
          <span className="v10-postmeta__item">
            Published <time dateTime={date}>{formatBlogDate(date)}</time>
          </span>
          <span className="v10-postmeta__item">
            Data collected <time dateTime={dataCollected}>{formatBlogDate(dataCollected)}</time>
          </span>
        </>
      ) : (
        <time className="v10-postmeta__item" dateTime={date}>
          {formatBlogDate(date)}
        </time>
      )}
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
