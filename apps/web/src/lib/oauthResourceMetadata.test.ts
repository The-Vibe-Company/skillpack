import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as rootMetadata } from "../app/.well-known/oauth-protected-resource/route";
import { GET as mcpMetadata } from "../app/.well-known/oauth-protected-resource/mcp/route";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const metadata = {
  resource: "https://skillpack.app/mcp",
  authorization_servers: ["https://skillpack.app/auth"],
  scopes_supported: ["openid", "offline_access"],
  bearer_methods_supported: ["header"],
};

describe("RFC 9728 resource discovery", () => {
  it.each([{ scopes_supported: [] }, { scopes_supported: ["custom-public-scope"] }])("preserves an explicit upstream scope list $scopes_supported", async ({ scopes_supported }) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...metadata, scopes_supported })));
    for (const handler of [rootMetadata, mcpMetadata]) {
      const response = await handler(new Request("https://skillpack.app/.well-known/oauth-protected-resource"));
      expect(response.status).toBe(200);
      expect((await response.json()).scopes_supported).toEqual(scopes_supported);
    }
  });

  it("publishes the existing public scopes at both paths when upstream omits them", async () => {
    const { scopes_supported: _scopes, ...withoutScopes } = metadata;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(withoutScopes)));
    for (const handler of [rootMetadata, mcpMetadata]) {
      const response = await handler(new Request("https://skillpack.app/.well-known/oauth-protected-resource"));
      expect((await response.json()).scopes_supported).toEqual(["openid", "profile", "email", "offline_access"]);
    }
  });

  it.each(["https://skillpack.app", "https://skillpack-preview.vercel.app", "http://127.0.0.1:3000"])(
    "matches both discovery paths to the requested origin %s while preserving server metadata",
    async (origin) => {
      vi.stubEnv("COMPANION_API_URL", "http://127.0.0.1:3001");
      const fetchMock = vi.fn(async () => new Response(JSON.stringify(metadata), { headers: { "content-type": "text/plain" } }));
      vi.stubGlobal("fetch", fetchMock);
      for (const [handler, path] of [[rootMetadata, ""], [mcpMetadata, "/mcp"]] as const) {
        const response = await handler(new Request(`${origin}/.well-known/oauth-protected-resource${path}`, {
          headers: { cookie: "session=private", authorization: "Bearer private" },
        }));
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("application/json");
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.has("www-authenticate")).toBe(false);
        expect(await response.json()).toEqual({ ...metadata, resource: `${origin}${path}` });
      }
      expect(fetchMock).toHaveBeenCalledWith(new URL("http://127.0.0.1:3001/auth/.well-known/oauth-protected-resource"), {
        cache: "no-store", signal: expect.any(AbortSignal),
      });
      expect(JSON.stringify(fetchMock.mock.calls)).not.toMatch(/private/);
    },
  );

  it("uses the request host behind a TLS proxy without changing the authorization server", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(metadata)));
    const response = await mcpMetadata(new Request("http://localhost:3000/.well-known/oauth-protected-resource/mcp", {
      headers: { host: "preview.vercel.app", "x-forwarded-proto": "https", "x-forwarded-host": "ignored.example" },
    }));
    expect(await response.json()).toEqual({ ...metadata, resource: "https://preview.vercel.app/mcp" });
  });

  it.each([new Response("unavailable", { status: 503 }), new Response("not json"), Response.json(null), Response.json([])])(
    "fails closed when the upstream document is unavailable or malformed",
    async (upstream) => {
      vi.stubGlobal("fetch", vi.fn(async () => upstream));
      const response = await rootMetadata(new Request("https://skillpack.app/.well-known/oauth-protected-resource"));
      expect(response.status).toBe(502);
      expect(await response.json()).not.toHaveProperty("resource");
    },
  );
});
