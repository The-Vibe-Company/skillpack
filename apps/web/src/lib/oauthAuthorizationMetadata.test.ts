import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as rootMetadata } from "../app/.well-known/oauth-authorization-server/route";
import { GET as issuerMetadata } from "../app/.well-known/oauth-authorization-server/auth/route";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Poppy authorization server discovery", () => {
  it("retains any existing domain bindings", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ issuer: "https://skillpack.app/auth", poppy_domains: ["docs.skillpack.app", "skillpack.app"] })));
    expect((await (await issuerMetadata()).json()).poppy_domains).toEqual(["docs.skillpack.app", "skillpack.app"]);
  });

  it("binds both aliases to the actual issuer domain, preserving OAuth configuration", async () => {
    vi.stubEnv("COMPANION_API_URL", "http://127.0.0.1:3001");
    const metadata = {
      issuer: "https://skillpack.app/auth", authorization_endpoint: "https://skillpack.app/auth/mcp/authorize",
      token_endpoint: "https://skillpack.app/auth/mcp/token", scopes_supported: ["openid", "profile", "email", "offline_access"],
      code_challenge_methods_supported: ["S256"],
    };
    const fetchMock = vi.fn(async () => Response.json(metadata));
    vi.stubGlobal("fetch", fetchMock);
    for (const handler of [rootMetadata, issuerMetadata]) {
      const response = await handler();
      expect(response.headers.get("content-type")).toBe("application/json");
      expect(await response.json()).toEqual({ ...metadata, poppy_domains: ["skillpack.app"] });
    }
    expect(fetchMock).toHaveBeenCalledWith(new URL("http://127.0.0.1:3001/auth/.well-known/oauth-authorization-server"), {
      cache: "no-store", signal: expect.any(AbortSignal),
    });
  });

  it.each([new Response("unavailable", { status: 503 }), Response.json({}), Response.json({ issuer: "invalid" })])(
    "fails closed without a valid upstream issuer", async (upstream) => {
      vi.stubGlobal("fetch", vi.fn(async () => upstream));
      expect((await issuerMetadata()).status).toBe(502);
    },
  );
});
