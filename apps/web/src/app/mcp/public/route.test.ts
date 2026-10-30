import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogSkill } from "../../../../test/publicCatalogFixtures";
import { PUBLIC_PROTOCOL_BODY_LIMIT } from "@/lib/publicMcp";
import { POST, GET, DELETE } from "./route";
import { GET as mcpCard } from "../../.well-known/mcp/server-card.json/route";
import { GET as a2aCard } from "../../.well-known/agent-card.json/route";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

type TestJson = string | number | boolean | null | TestJson[] | { [key: string]: TestJson };

function request(method: string, params: TestJson = {}, headers: Record<string, string> = {}) {
  return new Request("https://skills.example.com/mcp/public", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

describe("public MCP transport", () => {
  it("initializes without authentication or a session and lists exactly the read-only tools", async () => {
    const init = await POST(request("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "public-test", version: "1.0.0" } }));
    expect(init.status).toBe(200);
    expect(init.headers.get("mcp-session-id")).toBeNull();
    expect(init.headers.get("content-type")).toContain("application/json");
    expect((await init.json()).result.serverInfo).toEqual({ name: "app.skillpack/public", version: "1.0.0" });
    const listed = await POST(request("tools/list"));
    const tools = (await listed.json()).result.tools;
    expect(tools.map((tool: { name: string }) => tool.name)).toEqual(["search_skills", "read_skill", "list_articles", "read_article"]);
    for (const tool of tools) expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
  });

  it("calls catalog tools anonymously even when authenticated credentials are supplied", async () => {
    vi.stubEnv("SKILLPACK_PUBLIC_CATALOG", "true");
    vi.stubEnv("COMPANION_API_URL", "http://127.0.0.1:55001");
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json(catalogSkill()));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request("tools/call", { name: "read_skill", arguments: { orgSlug: "acme", skillSlug: "release-helper" } }, {
      cookie: "session=private-cookie", authorization: "Bearer private-token", "x-api-key": "private-key",
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(JSON.parse(body.result.content[0].text)).toEqual(catalogSkill());
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:55001/v1/public/catalog/skills/acme/release-helper", expect.objectContaining({ cache: "no-store" }));
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("headers");
    expect(JSON.stringify(fetchMock.mock.calls)).not.toMatch(/private-cookie|private-token|private-key/);
  });

  it("keeps catalog reads disabled for signed-in callers while published blog tools remain available", async () => {
    vi.stubEnv("SKILLPACK_PUBLIC_CATALOG", "false");
    const response = await POST(request("tools/call", { name: "search_skills", arguments: {} }, { cookie: "session=member" }));
    expect((await response.json()).result.isError).toBe(true);
    const articles = await POST(request("tools/call", { name: "list_articles", arguments: { limit: 1 } }));
    expect(JSON.parse((await articles.json()).result.content[0].text).articles).toHaveLength(1);
  });

  it("rejects write tools and invalid arguments without exposing private content", async () => {
    const write = await POST(request("tools/call", { name: "skill_archive", arguments: { slug: "private-skill" } }));
    expect((await write.json()).result.isError).toBe(true);
    const invalid = await POST(request("tools/call", { name: "search_skills", arguments: { limit: 51 } }));
    expect((await invalid.json()).result.isError).toBe(true);
    const traversal = await POST(request("tools/call", { name: "read_article", arguments: { slug: "../../private" } }));
    expect((await traversal.json()).result.isError).toBe(true);
  });

  it("validates browser Origin against the configured deployment and accepts native clients", async () => {
    vi.stubEnv("COMPANION_WEB_URL", "https://skills.example.com");
    expect((await POST(request("tools/list", {}, { origin: "https://evil.test" }))).status).toBe(403);
    expect((await POST(request("tools/list", {}, { origin: "null" }))).status).toBe(403);
    expect((await POST(request("tools/list", {}, { origin: "https://skills.example.com" }))).status).toBe(200);
    expect((await POST(request("tools/list"))).status).toBe(200);
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", "skillpack-preview.vercel.app");
    expect((await POST(request("tools/list", {}, { origin: "https://skillpack-preview.vercel.app" }))).status).toBe(200);
    expect((await POST(request("tools/list", {}, { origin: "https://skillpack.app" }))).status).toBe(403);
  });

  it("rejects malformed protocol requests, unsupported versions, media types and oversized streamed bodies", async () => {
    const malformed = await POST(new Request("https://skills.example.com/mcp/public", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{" }));
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error.code).toBe(-32700);
    expect((await POST(request("tools/list", {}, { "mcp-protocol-version": "unsupported" }))).status).toBe(400);
    expect((await POST(request("tools/list", {}, { accept: "application/json" }))).status).toBe(406);
    expect((await POST(request("tools/list", {}, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await POST(request("tools/list", { padding: "x".repeat(PUBLIC_PROTOCOL_BODY_LIMIT) }))).status).toBe(413);
    expect(GET().status).toBe(405);
    expect(GET().headers.get("allow")).toBe("POST");
    expect(DELETE().status).toBe(405);
  });

  it("serves discovery JSON at both scanner paths", async () => {
    vi.stubEnv("COMPANION_WEB_URL", "https://skills.example.com");
    const mcp = mcpCard();
    const a2a = a2aCard();
    expect(mcp.status).toBe(200);
    expect((await mcp.json()).remotes[0].url).toBe("https://skills.example.com/mcp/public");
    expect(a2a.status).toBe(200);
    const agent = await a2a.json();
    expect(agent.url).toBe("https://skills.example.com/a2a");
    expect(agent.supportedInterfaces).toEqual([{
      url: agent.url, protocolBinding: agent.preferredTransport, protocolVersion: agent.protocolVersion,
    }]);
    expect(mcp.headers.get("cache-control")).toBe("no-store");
  });
});
