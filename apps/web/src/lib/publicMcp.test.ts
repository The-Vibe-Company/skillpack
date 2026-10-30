import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogSkill, catalogSkills } from "../../test/publicCatalogFixtures";
import { findBlogPost, loadBlogPosts } from "./blog";
import {
  callPublicTool,
  handlePublicA2aRequest,
  publicA2aAgentCard,
  publicMcpServerCard,
  PUBLIC_PROTOCOL_BODY_LIMIT,
} from "./publicMcp";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function textResult(result: Awaited<ReturnType<typeof callPublicTool>>): string {
  const part = result.content[0];
  if (part?.type !== "text") throw new Error("Expected a text result");
  return part.text;
}

describe("anonymous public tool dispatch", () => {
  it("fails closed before catalog I/O when the default-off flag is disabled", async () => {
    vi.stubEnv("SKILLPACK_PUBLIC_CATALOG", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await callPublicTool("search_skills", {})).isError).toBe(true);
    expect((await callPublicTool("read_skill", { orgSlug: "acme", skillSlug: "release-helper" })).isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await callPublicTool("list_articles", {})).isError).toBeUndefined();
  });

  it("searches only the requested bounded anonymous page and preserves continuation after no matches", async () => {
    vi.stubEnv("SKILLPACK_PUBLIC_CATALOG", "true");
    vi.stubEnv("COMPANION_API_URL", "http://127.0.0.1:55001");
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ skills: catalogSkills(50), next_offset: 100 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await callPublicTool("search_skills", { query: "no matches", limit: 50, offset: 50 });
    expect(JSON.parse(textResult(result))).toEqual({ skills: [], next_offset: 100 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:55001/v1/public/catalog/skills?limit=50&offset=50", expect.objectContaining({ cache: "no-store" }));
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("headers");
  });

  it("returns only validated public snapshot fields from the anonymous read API", async () => {
    vi.stubEnv("SKILLPACK_PUBLIC_CATALOG", "true");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...catalogSkill(), share_token: "hidden", org_id: "private-id" })));
    const result = await callPublicTool("read_skill", { orgSlug: "acme", skillSlug: "release-helper" });
    expect(JSON.parse(textResult(result))).toEqual(catalogSkill());
    expect(textResult(result)).not.toContain("hidden");
  });

  it("returns generic failures for unavailable APIs and unlisted skills", async () => {
    vi.stubEnv("SKILLPACK_PUBLIC_CATALOG", "true");
    const fetchMock = vi.fn(async (): Promise<Response> => { throw new Error("postgres://super-secret@private-host/internal"); });
    vi.stubGlobal("fetch", fetchMock);
    const result = await callPublicTool("search_skills", {});
    expect(result.isError).toBe(true);
    expect(textResult(result)).toBe("Public content is temporarily unavailable.");
    fetchMock.mockImplementation(async () => Response.json({ error: "internal" }, { status: 404 }));
    expect(textResult(await callPublicTool("read_skill", { orgSlug: "acme", skillSlug: "missing" }))).toBe("Public skill not found.");
  });

  it("rejects write tools, unsafe slugs and unbounded pagination without I/O", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const [tool, input] of [
      ["skill_archive", { slug: "release-helper" }],
      ["read_skill", { orgSlug: "acme", skillSlug: "../private" }],
      ["read_article", { slug: "../../secrets" }],
      ["search_skills", { limit: 51 }],
      ["search_skills", { query: "a".repeat(257) }],
      ["list_articles", { offset: 10_001 }],
    ] as const) expect((await callPublicTool(tool, input)).isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lists real article metadata with pagination and reads the original published Markdown", async () => {
    const posts = loadBlogPosts();
    expect(posts.length).toBeGreaterThan(1);
    const list = JSON.parse(textResult(await callPublicTool("list_articles", { limit: 1 })));
    expect(list.articles).toHaveLength(1);
    expect(list.articles[0].slug).toBe(posts[0]?.slug);
    expect(list.articles[0]).not.toHaveProperty("body");
    expect(list.next_offset).toBe(1);
    const second = JSON.parse(textResult(await callPublicTool("list_articles", { limit: 1, offset: list.next_offset })));
    expect(second.articles[0].slug).toBe(posts[1]?.slug);
    const read = JSON.parse(textResult(await callPublicTool("read_article", { slug: list.articles[0].slug })));
    expect(read.body).toBe(findBlogPost(list.articles[0].slug)?.body);
    expect(read.path).toBe(`/blog/${list.articles[0].slug}`);
    expect((await callPublicTool("read_article", { slug: "nonexistent-article-zzzz" })).isError).toBe(true);
  });
});

describe("public discovery cards", () => {
  it("advertises only the four read-only tools and the distinct anonymous protocol endpoints", () => {
    vi.stubEnv("COMPANION_WEB_URL", "https://skills.example.com");
    const mcp = publicMcpServerCard();
    expect(mcp.serverInfo).toEqual({ name: mcp.name, version: mcp.version });
    expect(mcp.remotes[0]?.url).toBe("https://skills.example.com/mcp/public");
    expect(mcp.tools.map((tool) => tool.name)).toEqual(["search_skills", "read_skill", "list_articles", "read_article"]);
    for (const tool of mcp.tools) expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
    const a2a = publicA2aAgentCard();
    expect(a2a.url).toBe("https://skills.example.com/a2a");
    expect(a2a.preferredTransport).toBe("JSONRPC");
    expect(a2a.capabilities.streaming).toBe(false);
    expect(a2a.skills.map((skill) => skill.id)).toEqual(mcp.tools.map((tool) => tool.name));
  });

  it("keeps preview discovery on the preview deployment and rejects malformed preview hosts", () => {
    vi.stubEnv("COMPANION_WEB_URL", "https://skillpack.app");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", "skillpack-feature-abc.vercel.app");
    expect(publicMcpServerCard().remotes[0]?.url).toBe("https://skillpack-feature-abc.vercel.app/mcp/public");
    expect(publicA2aAgentCard().url).toBe("https://skillpack-feature-abc.vercel.app/a2a");
    vi.stubEnv("VERCEL_URL", "evil.test/path");
    expect(publicMcpServerCard().remotes[0]?.url).toBe("https://skillpack.app/mcp/public");
  });
});

type TestJson = string | number | boolean | null | TestJson[] | { [key: string]: TestJson };

function a2aRequest(command: TestJson, overrides: Record<string, TestJson> = {}, headers: Record<string, string> = {}) {
  return new Request("https://skills.example.com/a2a", {
    method: "POST", headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: "a2a-1", method: "message/send", params: { message: { kind: "message", role: "user", messageId: "request-1", parts: [{ kind: "text", text: JSON.stringify(command) }] } }, ...overrides }),
  });
}

describe("A2A read-only message adapter", () => {
  it("answers the advertised message/send command with an immediate agent message", async () => {
    const response = await handlePublicA2aRequest(a2aRequest({ tool: "list_articles", arguments: { limit: 1 } }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe("a2a-1");
    expect(body.result).toMatchObject({ kind: "message", role: "agent", metadata: { isError: false } });
    expect(JSON.parse(body.result.parts[0].text).articles).toHaveLength(1);
  });

  it.each(["tasks/get", "tasks/cancel"])("returns TaskNotFound for %s without creating or mutating tasks", async (method) => {
    const response = await handlePublicA2aRequest(a2aRequest({}, { method, params: { id: "absent-task" } }));
    expect((await response.json()).error.code).toBe(-32001);
  });

  it("never forwards cookies, API keys or authorization through A2A catalog reads", async () => {
    vi.stubEnv("SKILLPACK_PUBLIC_CATALOG", "true");
    const fetchMock = vi.fn(async () => Response.json(catalogSkill()));
    vi.stubGlobal("fetch", fetchMock);
    const response = await handlePublicA2aRequest(a2aRequest({ tool: "read_skill", arguments: { orgSlug: "acme", skillSlug: "release-helper" } }, {}, {
      cookie: "session=private-cookie", authorization: "Bearer private-token", "x-api-key": "private-key",
    }));
    expect((await response.json()).result.metadata.isError).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(fetchMock.mock.calls)).not.toMatch(/private-cookie|private-token|private-key/);
  });

  it("rejects writes, unsupported methods, task continuation, malformed JSON and oversized bodies", async () => {
    const write = await handlePublicA2aRequest(a2aRequest({ tool: "skill_archive", arguments: {} }));
    expect((await write.json()).error.code).toBe(-32602);
    const task = await handlePublicA2aRequest(a2aRequest({}, { method: "tasks/get" }));
    expect((await task.json()).error.code).toBe(-32602);
    const continuation = await handlePublicA2aRequest(a2aRequest({}, { params: { message: { kind: "message", role: "user", messageId: "m", taskId: "private-task", parts: [{ kind: "text", text: "{}" }] } } }));
    expect((await continuation.json()).error.code).toBe(-32602);
    const malformed = await handlePublicA2aRequest(new Request("https://skills.example.com/a2a", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }));
    expect((await malformed.json()).error.code).toBe(-32700);
    const oversized = await handlePublicA2aRequest(a2aRequest({ tool: "list_articles", arguments: { padding: "x".repeat(PUBLIC_PROTOCOL_BODY_LIMIT) } }));
    expect(oversized.status).toBe(413);
  });
});
