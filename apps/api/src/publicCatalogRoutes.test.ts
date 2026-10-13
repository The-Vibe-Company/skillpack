import { describe, expect, it, vi } from "vitest";
import { createPublicCatalogRoutes } from "./publicCatalogRoutes";

const skill = {
  org_name: "Example", org_slug: "example", skill_slug: "public-skill", name: "public-skill",
  description: "Released instructions", version: "1.0.0", released_at: "2026-10-13T00:00:00.000Z",
  checksum: `sha256:${"a".repeat(64)}`, size_bytes: 123, body: "# Released instructions",
  files: [{ path: "SKILL.md", size_bytes: 100 }],
};
const detail = "/v1/public/catalog/skills/example/public-skill";
const index = "/v1/public/catalog/skills";

describe("anonymous public catalog", () => {
  it("defaults off and hides every endpoint before querying the database", async () => {
    vi.stubEnv("SKILLPACK_PUBLIC_CATALOG", undefined);
    const list = vi.fn();
    const get = vi.fn();
    const app = createPublicCatalogRoutes({ list, get });
    for (const path of [index, detail]) {
      const response = await app.request(path);
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(list).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("allows unauthenticated paginated reads and strips tokens, PII and private metadata", async () => {
    const extra = { ...skill, share_token: "bearer-secret", members: [{ email: "member@example.test" }],
      secrets: [{ id: "secret-slot" }], current_version: "2.0.0", stats: { activations: 42 },
      files: [{ ...skill.files[0], storage_path: "private/storage" }] };
    const list = vi.fn().mockResolvedValue([extra]);
    const get = vi.fn().mockResolvedValue(extra);
    const app = createPublicCatalogRoutes({ list, get, enabled: () => true });
    const response = await app.request(`${index}?limit=1&offset=2&label=engineering`);
    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalledWith({ limit: 1, offset: 2, label: "engineering" });
    expect(await response.json()).toEqual({ skills: [skill], next_offset: 3 });
    expect(await (await app.request(detail)).json()).toEqual(skill);
  });

  it("revalidates consent and the feature flag before returning a cached representation", async () => {
    let enabled = true;
    const get = vi.fn().mockResolvedValue(skill);
    const app = createPublicCatalogRoutes({ get, enabled: () => enabled });
    const response = await app.request(detail);
    const etag = response.headers.get("etag")!;
    expect(response.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    expect((await app.request(detail, { headers: { "If-None-Match": etag } })).status).toBe(304);
    expect(get).toHaveBeenCalledTimes(2);
    get.mockResolvedValue(null);
    expect((await app.request(detail, { headers: { "If-None-Match": etag } })).status).toBe(404);
    enabled = false;
    get.mockResolvedValue(skill);
    expect((await app.request(detail, { headers: { "If-None-Match": etag } })).status).toBe(404);
    expect(get).toHaveBeenCalledTimes(3);
  });

  it("bounds pagination and rejects invalid queries without echoing their values", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const app = createPublicCatalogRoutes({ list, enabled: () => true });
    for (const query of ["limit=51", "limit=0", "offset=-1", "offset=10001", "offset=1.2", "label=", "token=private"]) {
      const response = await app.request(`${index}?${query}`);
      expect(response.status).toBe(400);
      expect(await response.text()).toBe('{"error":"invalid catalog query"}');
    }
    expect(list).not.toHaveBeenCalled();
    expect(await (await app.request(index)).json()).toEqual({ skills: [], next_offset: null });
  });

  it("uses a shared admission limit, resets it and never leaks database errors", async () => {
    let now = 0;
    const get = vi.fn().mockResolvedValue(null);
    const app = createPublicCatalogRoutes({ get, enabled: () => true, now: () => now });
    for (let i = 0; i < 600; i++) expect((await app.request(detail)).status).toBe(404);
    const limited = await app.request(detail);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    now += 60_000;
    get.mockRejectedValue(new Error("token=private email=member@example.test"));
    const response = await app.request(detail);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"error":"catalog temporarily unavailable"}');
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
