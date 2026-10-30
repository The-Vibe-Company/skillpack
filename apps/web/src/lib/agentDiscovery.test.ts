import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";
import { acceptsMarkdown, AGENT_DISCOVERY_LINKS } from "./agentDiscovery";
import { homeMarkdown } from "./agentMarkdown";
import { loadBlogPosts } from "./blog";
import { GET as markdown, generateStaticParams } from "../app/md/[[...path]]/route";
import { GET as llms } from "../app/llms.txt/route";
import { GET as catalog } from "../app/.well-known/api-catalog/route";
import { parse as parseYaml } from "yaml";

describe("agent discovery and content", () => {
  it("binds every advertised skill to its exact served bytes and frontmatter", () => {
    const root = join(process.cwd(), "public/.well-known/agent-skills");
    const index = JSON.parse(readFileSync(join(root, "index.json"), "utf8"));
    expect(index.$schema).toBe("https://schemas.agentskills.io/discovery/0.2.0/schema.json");
    expect(index.skills.map((skill: { name: string }) => skill.name).sort()).toEqual(
      readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(),
    );
    expect(index.skills).toHaveLength(2);
    for (const skill of index.skills) {
      expect(skill.type).toBe("skill-md");
      expect(skill.url).toBe(`/.well-known/agent-skills/${skill.name}/SKILL.md`);
      const bytes = readFileSync(join(root, skill.name, "SKILL.md"));
      expect(skill.digest).toBe(`sha256:${createHash("sha256").update(bytes).digest("hex")}`);
      const frontmatter = parseYaml(/^---\n([\s\S]*?)\n---/.exec(bytes.toString())![1]!);
      expect(frontmatter.name).toBe(skill.name);
      expect(frontmatter.description).toBe(skill.description);
    }
  });

  it.each(["text/markdown", "text/html, text/markdown;q=0.8", "Text/Markdown; charset=utf-8"])("accepts explicit markdown %s", (accept) => {
    expect(acceptsMarkdown(accept)).toBe(true);
  });
  it.each([null, "*/*", "text/html", "text/markdown;q=0", "text/markdown;q=invalid", "text/markdown;q=1.5"])("keeps HTML for %s", (accept) => {
    expect(acceptsMarkdown(accept)).toBe(false);
  });

  it.each(["/", "/blog", "/blog/what-is-skill-md"])("negotiates %s with separate static destinations and Vary on both variants", (path) => {
    for (const accept of ["text/html", "text/markdown"]) {
      const response = middleware(new NextRequest(`https://skillpack.app${path}?ref=test`, { headers: { accept } }));
      expect(response.headers.get("link")).toBe(AGENT_DISCOVERY_LINKS);
      expect(response.headers.get("vary")).toContain("Accept");
      expect(response.headers.get("cache-control")).toBeNull();
      expect(response.headers.get("x-middleware-rewrite")).toBe(accept === "text/html" ? null : `https://skillpack.app/md${path === "/" ? "" : path}?ref=test`);
    }
  });

  it.each(["/skills", "/v1/skills", "/blog/post/opengraph-image", "/blog/../../skills", "/mcp", "/ingest/e/"])("does not rewrite %s to markdown", (path) => {
    const response = middleware(new NextRequest(`https://skillpack.app${path}`, { headers: { accept: "text/markdown" } }));
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("serves the home from llms.txt and every article from the same Markdown body as HTML", async () => {
    expect(await llms().text()).toBe(homeMarkdown());
    const staticParams = generateStaticParams();
    expect(staticParams).toContainEqual({ path: [] });
    const response = await markdown(new Request("https://skillpack.app/md"), { params: Promise.resolve({}) });
    expect(await response.text()).toBe(homeMarkdown());
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("vary")).toBe("Accept");
    for (const post of loadBlogPosts()) {
      const result = await markdown(new Request("https://skillpack.app"), { params: Promise.resolve({ path: ["blog", post.slug] }) });
      expect(await result.text()).toBe(post.body);
      expect(staticParams).toContainEqual({ path: ["blog", post.slug] });
    }
    const missing = await markdown(new Request("https://skillpack.app"), { params: Promise.resolve({ path: ["blog", "missing"] }) });
    expect(missing.status).toBe(404);
  }, 20_000);

  it("serves an RFC 9727 linkset with the required discovery resources", async () => {
    const response = catalog();
    expect(response.headers.get("content-type")).toBe("application/linkset+json");
    expect(response.headers.get("link")).toBe('</.well-known/api-catalog>; rel="api-catalog"');
    const { linkset } = await response.json();
    expect(linkset[0].item.map((entry: { href: string }) => new URL(entry.href).pathname)).toEqual(["/mcp/public", "/a2a"]);
    expect(new URL(linkset[0].describedby[0].href).pathname).toBe("/llms.txt");
    expect(new URL(linkset[0].sitemap[0].href).pathname).toBe("/sitemap.xml");
    expect(new URL(linkset[0]["service-desc"][0].href).pathname).toBe("/.well-known/agent-skills/index.json");
  });
});
