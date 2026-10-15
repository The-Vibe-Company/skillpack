# Blog posts

Posts are Markdown files in `apps/web/content/blog/<slug>.md`, loaded at build time by
`apps/web/src/lib/blog.ts`. A bad frontmatter field or block fails the build with the file name.

## Frontmatter

| Field | Required | Notes |
|---|---|---|
| `title` | yes | Search title, used as-is in `<title>` |
| `description` | yes | Meta and share description |
| `slug` | yes | Must match the file name |
| `date` | yes | `YYYY-MM-DD`, publication day |
| `tags` | no | Up to 6; drive related posts |
| `author` | no | A named person; without one the post is credited to The Vibe Company |
| `authorRole` | no | Shown after the name in the byline; needs `author` |
| `dataCollected` | no | `YYYY-MM-DD`; the byline then shows "Published" and "Data collected" |
| `layout` | no | `article` (default) or `ranking` |

The body starts with its only `# ` heading. GitHub alerts (`> [!TIP]`) render as callouts.

## Ranking posts (`layout: ranking`)

A ranked shortlist, such as `best-claude-code-skills-frontend-design.md`. The paragraphs between the
H1 and the first heading, fence or quote become the header intro. The page adds a "Ranking · N
skills" eyebrow, FAQPage JSON-LD for `faq` blocks and a discreet sticky sign-up bar for the
`cta` block marked `sticky: true`.

Structure comes from fenced blocks whose language names the block and whose body is YAML.
Prose fields are Markdown. Schemas live in `apps/web/src/lib/blogBlocks.ts`; components in
`apps/web/src/components/blog/ranking/`. Any post can use them, not only rankings.

| Block | Renders | Key fields |
|---|---|---|
| `takeaways` | Summary box, listed in the outline | `title`, `items[].lead`, `items[].text` |
| `skill-card` | One ranked skill, listed in the outline | `rank`, `name` (slug), `title?`, `maintainer`, `bestFor`, `source{label,url}`, `repoStars`, `installs{count?,url,note?}`, `license{name,note?,declared}`, `focus`, `install`, `description`, `suitedFor` |
| `skill-comparison` | Comparison table built from the post's `skill-card`s | `caption?` |
| `use-cases` | "Which skill fits" table | `rows[].useCase/start/add/why` |
| `faq` | Accordion (`<details>`) plus FAQPage JSON-LD | `items[].question`, `items[].answer` |
| `cta` | Sign-up panel | `title`, `text?`, `primary{label,href}`, `secondary?`, `sticky?` |

The loader checks that:

- ranks run 1…n in document order;
- skill names are unique;
- a GitHub `install` command fetches the same folder as `source.url`;
- links are site paths or `https` URLs;
- at most one `cta` is sticky.

State only figures you can source, and give the day they were read in `dataCollected`.
