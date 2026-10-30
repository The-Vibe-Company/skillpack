import { resolveSiteUrl } from "@/lib/siteUrl";

export const dynamic = "force-static";

export function GET() {
  // Next's metadata robots serializer does not support Content-Signal.
  const agents = ["*", "GPTBot", "OAI-SearchBot", "ClaudeBot", "Claude-SearchBot", "PerplexityBot", "Google-Extended"];
  const rules = agents.map((agent) =>
    `User-agent: ${agent}\nAllow: /\nContent-Signal: search=yes, ai-input=yes, ai-train=yes`,
  );
  return new Response(`${rules.join("\n\n")}\n\nSitemap: ${new URL("/sitemap.xml", resolveSiteUrl()).href}\nAgentmap: ${new URL("/.well-known/ai-catalog.json", resolveSiteUrl()).href}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
