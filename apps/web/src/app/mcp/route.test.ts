import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("MCP discovery header proxy", () => {
  it("aligns a legacy upstream 401 with the requesting resource, preserving the error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("existing unauthorized body", {
      status: 401, headers: { "www-authenticate": 'Bearer resource_metadata="https://skillpack.app/auth/.well-known/oauth-protected-resource"', "content-type": "application/json" },
    })));
    const response = await GET(new Request("http://localhost:3000/mcp", {
      headers: { host: "preview.vercel.app", "x-forwarded-proto": "https" },
    }));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe('Bearer resource_metadata="https://preview.vercel.app/.well-known/oauth-protected-resource/mcp"');
    expect(await response.text()).toBe("existing unauthorized body");
  });

  it("relays authenticated POST headers, body, query and streaming response without resolving identity", async () => {
    vi.stubEnv("COMPANION_API_URL", "http://api.internal:3001");
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("public result")); controller.close(); } });
    const fetchMock = vi.fn(async (_request: Request, _options: RequestInit) => new Response(stream, {
      status: 200, headers: { "content-type": "text/event-stream", "mcp-session-id": "existing", "set-cookie": "existing=value; HttpOnly" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const response = await POST(new Request("https://preview.vercel.app/mcp?existing=1", {
      method: "POST", body,
      headers: { authorization: "Bearer test-token", cookie: "test-session=value", "mcp-protocol-version": "2025-06-18", "content-type": "application/json", host: "preview.vercel.app", connection: "keep-alive", "transfer-encoding": "chunked" },
    }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [forwarded, options] = fetchMock.mock.calls[0]!;
    expect(forwarded.url).toBe("http://api.internal:3001/mcp?existing=1");
    expect(forwarded.method).toBe("POST");
    expect(await forwarded.text()).toBe(body);
    expect(forwarded.headers.get("authorization")).toBe("Bearer test-token");
    expect(forwarded.headers.get("cookie")).toBe("test-session=value");
    expect(forwarded.headers.get("mcp-protocol-version")).toBe("2025-06-18");
    expect(forwarded.headers.get("transfer-encoding")).toBeNull();
    expect(forwarded.headers.get("host")).toBeNull();
    expect(options).toEqual({ cache: "no-store", redirect: "manual" });
    expect(response.body).toBe(stream);
    expect(response.headers.get("mcp-session-id")).toBe("existing");
    expect(response.headers.get("set-cookie")).toBe("existing=value; HttpOnly");
    expect(response.headers.has("www-authenticate")).toBe(false);
    expect(await response.text()).toBe("public result");
  });

  it("preserves non-401 status codes rather than following redirects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 307, headers: { location: "/existing" } })));
    const response = await GET(new Request("https://skillpack.app/mcp"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/existing");
    expect(response.headers.has("www-authenticate")).toBe(false);
  });
});
