/** Append this value; Next.js also emits Link entries for resource preloads. */
export const AGENT_DISCOVERY_LINKS = '</llms.txt>; rel="describedby"; type="text/markdown", </sitemap.xml>; rel="sitemap", </.well-known/agent-skills/index.json>; rel="service-desc", </.well-known/api-catalog>; rel="api-catalog"';

export function hasMarkdownRepresentation(pathname: string): boolean {
  return pathname === "/" || pathname === "/blog" || /^\/blog\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pathname);
}

/** Only explicit, acceptable Markdown opts in; ordinary browser and wildcard requests keep HTML. */
export function acceptsMarkdown(accept: string | null): boolean {
  return (accept ?? "").split(",").some((range) => {
    const [type, ...parameters] = range.trim().toLowerCase().split(";");
    if (type?.trim() !== "text/markdown") return false;
    const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
    const q = quality === undefined ? 1 : Number(quality.trim().slice(2));
    return Number.isFinite(q) && q > 0 && q <= 1;
  });
}
