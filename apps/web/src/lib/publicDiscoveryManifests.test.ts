import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as catalog } from "../app/.well-known/ai-catalog.json/route";
import { GET as poppy } from "../app/.well-known/poppy.json/route";

afterEach(() => { vi.unstubAllGlobals(); });

describe("public capability manifests", () => {
  it.each(["skillpack.app", "preview.vercel.app"])("publishes ARD v0.91 entries for existing public resources on %s", async (host) => {
    const response = catalog(new Request(`https://${host}/.well-known/ai-catalog.json`));
    expect(response.headers.get("content-type")).toBe("application/json");
    const body = await response.json();
    expect(body.specVersion).toBe("0.91");
    expect(body.entries).toHaveLength(5);
    expect(body.entries.map((entry: { url: string }) => entry.url)).toEqual([
      "/.well-known/mcp/server-card.json", "/.well-known/agent-card.json", "/.well-known/agent-skills/index.json", "/.well-known/api-catalog", "/llms.txt",
    ].map((path) => `https://${host}${path}`));
    for (const entry of body.entries) {
      expect(entry.identifier).toMatch(new RegExp(`^urn:air:${host.replaceAll(".", "\\.")}:skillpack:`));
      expect(entry.displayName).toBeTruthy();
      expect(entry.type).toContain("/");
      expect(entry.representativeQueries.length).toBeGreaterThanOrEqual(2);
      expect(entry.tags).toContain("read-only");
    }
  });

  it.each(["skillpack.app", "preview.vercel.app"])("publishes Poppy organization %s and the existing issuer, with ordinary website browsing only", async (host) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ authorization_servers: ["https://skillpack.app"] })));
    const response = await poppy(new Request(`https://${host}/.well-known/poppy.json`));
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      protocol_version: "0.3", organization: { name: "Skillpack", domain: host },
      auth: { issuer: "https://skillpack.app" }, web: {},
    });
  });

  it("does not invent an issuer when existing discovery is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    const response = await poppy(new Request("https://skillpack.app/.well-known/poppy.json"));
    expect(response.status).toBe(502);
    expect(await response.json()).not.toHaveProperty("auth");
  });
});
