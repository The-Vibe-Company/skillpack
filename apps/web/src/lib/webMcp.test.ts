import { afterEach, describe, expect, it, vi } from "vitest";
import { publicWebMcpTools, registerPublicWebMcpTools, type WebMcpTool } from "./webMcp";

afterEach(() => { vi.unstubAllGlobals(); });

describe("public WebMCP", () => {
  it("does nothing without browser support", () => {
    expect(() => registerPublicWebMcpTools()()).not.toThrow();
  });

  it("registers exactly the public read-only tools and removes owned tools on cleanup", () => {
    const registered: WebMcpTool[] = [];
    const unregisterTool = vi.fn();
    const cleanup = registerPublicWebMcpTools({ registerTool: (tool) => { registered.push(tool); }, unregisterTool });
    expect(registered.map((tool) => tool.name)).toEqual(["search_skills", "get_skill", "list_blog_posts", "read_blog_post"]);
    for (const tool of registered) expect(tool.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: true, consequentialHint: false });
    cleanup();
    expect(unregisterTool.mock.calls.flat()).toEqual(registered.map((tool) => tool.name));
  });

  it("uses registration abort signals and handles unsupported or rejected registrations", async () => {
    const signals: AbortSignal[] = [];
    const cleanup = registerPublicWebMcpTools({ registerTool: (_tool, options) => {
      if (options) signals.push(options.signal);
      return Promise.reject(new Error("not supported"));
    } });
    cleanup();
    await Promise.resolve();
    expect(signals).toHaveLength(4);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    const unregisterTool = vi.fn();
    expect(() => registerPublicWebMcpTools({ registerTool: () => { throw new Error("duplicate"); }, unregisterTool })()).not.toThrow();
    expect(unregisterTool).not.toHaveBeenCalled();
  });

  it("maps every invocation to the anonymous MCP endpoint, omitting credentials and redirects", async () => {
    const result = { content: [{ type: "text", text: "public response" }] };
    const fetchMock = vi.fn(async () => Response.json({ jsonrpc: "2.0", id: 1, result }));
    vi.stubGlobal("fetch", fetchMock);
    const names = ["search_skills", "read_skill", "list_articles", "read_article"];
    const inputs = [{ query: "public" }, { orgSlug: "acme", skillSlug: "public" }, { limit: 1 }, { slug: "what-is-skill-md" }];
    const signal = new AbortController().signal;
    for (const [index, tool] of publicWebMcpTools().entries()) {
      expect(await tool.execute(inputs[index]!, { signal })).toEqual(result);
      expect(fetchMock).toHaveBeenLastCalledWith("/mcp/public", expect.objectContaining({
        method: "POST", credentials: "omit", redirect: "error", signal,
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: names[index], arguments: inputs[index] } }),
      }));
      const request = fetchMock.mock.calls.at(-1);
      expect(JSON.stringify(request)).not.toMatch(/cookie|authorization|\/v1\/skills|\/mcp"/i);
    }
  });

  it("returns public catalog errors and sanitizes transport or malformed responses", async () => {
    const tool = publicWebMcpTools()[0]!;
    const disabled = { isError: true, content: [{ type: "text", text: "The public catalog is unavailable." }] };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ result: disabled })));
    expect(await tool.execute({})).toEqual(disabled);
    for (const response of [new Response("private internal error", { status: 500 }), Response.json({ secret: "private" })]) {
      vi.stubGlobal("fetch", vi.fn(async () => response));
      expect(await tool.execute({})).toEqual({ isError: true, content: [{ type: "text", text: "Public content is temporarily unavailable." }] });
    }
  });
});
