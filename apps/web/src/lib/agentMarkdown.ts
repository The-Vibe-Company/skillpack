import { blogPostPath, loadBlogPosts } from "./blog";
import { resolveSiteUrl } from "./siteUrl";

export function blogIndexMarkdown(): string {
  const site = resolveSiteUrl();
  return `# Skillpack blog\n\n${loadBlogPosts().map((post) =>
    `- [${post.title}](${new URL(blogPostPath(post.slug), site).href}): ${post.description}`,
  ).join("\n")}\n`;
}

/** The home representation and llms.txt share one source. */
export function homeMarkdown(): string {
  const site = resolveSiteUrl();
  return `# Skillpack\n\n> A self-hostable Skills Hub for organizations and external coding agents.\n\nCreate, validate, version, organize, share, install, and publish portable SKILL.md packages. Personal skills are creator-only; organization skills are shared with members. Skillpack never launches external agents or executes skill package scripts.\n\n## Start\n\n- [Sign in or create a workspace](${new URL("/login", site).href})\n- [Install the native CLI](https://github.com/The-Vibe-Company/skillpack/blob/main/docs/skillpack-cli.md): use the official runtime-v* release installer.\n- [Agent skills](${new URL("/.well-known/agent-skills/index.json", site).href}): installation and blog browsing instructions.\n- [Sitemap](${new URL("/sitemap.xml", site).href})\n\nRequest the home, blog index, or an article with Accept: text/markdown for its Markdown representation.\n\n${blogIndexMarkdown().replace(/^# Skillpack blog/, "## Blog")}\n`;
}

export function markdownResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/markdown; charset=utf-8", Vary: "Accept" },
  });
}
