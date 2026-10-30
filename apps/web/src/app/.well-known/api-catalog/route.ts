import { resolveSiteUrl } from "@/lib/siteUrl";

export const dynamic = "force-static";

export function GET() {
  const site = resolveSiteUrl();
  const link = (path: string, type: string) => ({ href: new URL(path, site).href, type });
  return new Response(JSON.stringify({ linkset: [{
    anchor: site.href,
    describedby: [link("/llms.txt", "text/markdown")],
    sitemap: [link("/sitemap.xml", "application/xml")],
    "service-desc": [
      link("/.well-known/agent-skills/index.json", "application/json"),
      link("/.well-known/mcp/server-card.json", "application/json"),
      link("/.well-known/agent-card.json", "application/json"),
    ],
    item: [link("/mcp/public", "application/json"), link("/a2a", "application/json")],
  }] }), { headers: {
    "Content-Type": "application/linkset+json",
    Link: '</.well-known/api-catalog>; rel="api-catalog"',
  } });
}
