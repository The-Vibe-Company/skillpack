/** ARD v0.91 entries describe existing public resources; no private service is advertised. */
export function publicArdCatalog(origin: string) {
  const publisher = new URL(origin).hostname;
  const resources = [
    { id: "public-mcp", name: "Skillpack public MCP", type: "application/mcp-server-card+json", path: "/.well-known/mcp/server-card.json", queries: ["Find public Skillpack skills", "Read published Skillpack articles"] },
    { id: "public-a2a", name: "Skillpack public A2A", type: "application/a2a-agent-card+json", path: "/.well-known/agent-card.json", queries: ["Find the read-only Skillpack agent", "Query Skillpack public content through A2A"] },
    { id: "agent-skills", name: "Skillpack public discovery skills", type: "application/agent-skills+json", path: "/.well-known/agent-skills/index.json", queries: ["Find Skillpack's public discovery skills", "Learn to browse public Skillpack content"] },
    { id: "api-catalog", name: "Skillpack public API catalog", type: "application/linkset+json", path: "/.well-known/api-catalog", queries: ["Discover Skillpack's public protocols", "Find public Skillpack API descriptions"] },
    { id: "llms", name: "Skillpack public overview", type: "text/markdown", path: "/llms.txt", queries: ["Learn what Skillpack does", "Find Skillpack's published articles"] },
  ];
  return {
    specVersion: "0.91",
    entries: resources.map(({ id, name, type, path, queries }) => ({
      identifier: `urn:air:${publisher}:skillpack:${id}`,
      displayName: name, type, url: new URL(path, origin).href,
      representativeQueries: queries,
      tags: ["public", "read-only"],
    })),
  };
}
