import type { TocEntry } from "@/lib/blogMarkdown";

function TocList({ entries }: { entries: readonly TocEntry[] }) {
  return (
    <ol className="v10-toc__list">
      {entries.map((entry) => (
        <li key={entry.id} className={entry.depth === 3 ? "v10-toc__item v10-toc__item--sub" : "v10-toc__item"}>
          <a href={`#${entry.id}`} data-toc-link={entry.id}>
            {entry.text}
          </a>
        </li>
      ))}
    </ol>
  );
}

/** Sticky outline beside the article on wide screens. */
export function TocSidebar({ entries }: { entries: readonly TocEntry[] }) {
  return (
    <nav className="v10-toc v10-toc--sidebar" aria-label="On this page">
      <p className="v10-toc__label">On this page</p>
      <TocList entries={entries} />
    </nav>
  );
}

/** Collapsed outline above the article on narrow screens, where there is no room for a sidebar. */
export function TocDisclosure({ entries }: { entries: readonly TocEntry[] }) {
  return (
    <details className="v10-toc v10-toc--disclosure">
      <summary>On this page</summary>
      <nav aria-label="On this page">
        <TocList entries={entries} />
      </nav>
    </details>
  );
}
