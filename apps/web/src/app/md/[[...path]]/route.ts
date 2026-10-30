import { blogIndexMarkdown, homeMarkdown, markdownResponse } from "@/lib/agentMarkdown";
import { findBlogPost, loadBlogPosts } from "@/lib/blog";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return [{ path: [] }, { path: ["blog"] }, ...loadBlogPosts().map((post) => ({ path: ["blog", post.slug] }))];
}

export async function GET(_request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  if (path.length === 0) return markdownResponse(homeMarkdown());
  if (path[0] === "blog") {
    if (path.length === 1) return markdownResponse(blogIndexMarkdown());
    const post = path.length === 2 ? findBlogPost(path[1]!) : undefined;
    if (post) return markdownResponse(post.body);
  }
  return markdownResponse("# Page not found\n", 404);
}
