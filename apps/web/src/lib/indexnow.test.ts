import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";
import {
  INDEXNOW_ENDPOINT, INDEXNOW_KEY, INDEXNOW_KEY_PATH, INDEXNOW_ORIGIN,
  indexNowPayloads, isIndexNowProduction, parseIndexNowSitemap,
  readIndexNowSitemap, selectIndexNowUrls, submitIndexNow, previousProductionSha,
  type IndexNowFetch,
} from "./indexnow";

const origin = INDEXNOW_ORIGIN;
const production = { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" };
const entry = (path: string, alternates: string[] = []) => ({ url: `${origin}${path}`, alternates });
const article = "/blog/hello";
const entries = [entry(article), entry("/blog/other"), entry("/blog"), entry("/"), entry("/catalog/org/skill")];

describe("IndexNow ownership and production guard", () => {
  test("public proof is exact and middleware does not redirect or negotiate Markdown", () => {
    expect(INDEXNOW_KEY).toBe("498a19c36795d0a81cb9c7d2a398d449");
    expect(readFileSync(`public${INDEXNOW_KEY_PATH}`, "utf8")).toBe(INDEXNOW_KEY);
    for (const accept of ["text/plain", "text/html", "text/markdown"]) {
      const response = middleware(new NextRequest(`${origin}${INDEXNOW_KEY_PATH}`, { headers: { accept } }));
      expect(response.status).toBe(200);
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.has("location")).toBe(false);
      expect(response.headers.has("x-middleware-rewrite")).toBe(false);
    }
  });

  test.each([
    [{}, false], [{ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "main" }, false],
    [{ VERCEL_ENV: "development", VERCEL_GIT_COMMIT_REF: "main" }, false],
    [{ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "feat/indexnow" }, false],
    [{ VERCEL_ENV: "production" }, false], [{ VERCEL_GIT_COMMIT_REF: "main" }, false],
    [production, true],
  ])("requires both production and main: %j", (env, expected) => {
    expect(isIndexNowProduction(env)).toBe(expected);
  });
});

describe("IndexNow canonical selection", () => {
  test("blog edits notify the article and index once, intersected with live URLs", () => {
    expect(selectIndexNowUrls(entries, ["apps/web/content/blog/hello.md", "apps/web/content/blog/hello.md"]))
      .toEqual([`${origin}/blog`, `${origin}${article}`]);
  });
  test("deleted or renamed articles notify the index and only live pages", () => {
    expect(selectIndexNowUrls(entries, ["apps/web/content/blog/removed.md", "apps/web/content/blog/hello.md"]))
      .toEqual([`${origin}/blog`, `${origin}${article}`]);
    expect(selectIndexNowUrls(entries, ["apps/web/content/blog/removed.md"]))
      .toEqual([`${origin}/blog`]);
    expect(selectIndexNowUrls([], ["apps/web/content/blog/hello.md"])).toEqual([]);
  });
  test("shared web and workspace code or assets invalidate all live canonicals", () => {
    for (const file of ["apps/web/src/app/page.tsx", "apps/web/src/styles/blog.css",
      "apps/web/public/images/cover.webp", "apps/web/assets/fonts/font.woff", "apps/web/next.config.ts",
      "packages/core/src/catalog.ts", "apps/web/content/shared.json"]) {
      expect(selectIndexNowUrls(entries, [file])).toEqual(entries.map((entry) => entry.url).sort());
    }
    expect(selectIndexNowUrls(entries, null)).toHaveLength(entries.length);
  });
  test("docs, tests, workflow and tooling-only changes submit nothing", () => {
    expect(selectIndexNowUrls(entries, ["CLAUDE.md", "AGENTS.md", "docs/indexnow.md", "apps/web/src/lib/blog.test.ts",
      ".github/workflows/indexnow.yml", "scripts/indexnow.ts", "apps/web/src/lib/indexnow.ts",
      "apps/web/test/publicCatalogFixtures.ts", "apps/api/src/test/helpers.ts"]))
      .toEqual([]);
    expect(selectIndexNowUrls(entries, [])).toEqual([]);
  });
  test("payloads are deterministic, deduplicated, same HTTPS host and at most 10,000 URLs", () => {
    const urls = Array.from({ length: 10_001 }, (_, i) => `${origin}/fr/${i}`);
    const payloads = indexNowPayloads([...urls, urls[0]!, "http://skillpack.app/fr", "https://skillpack.app.evil/fr", "https://evil.example/", "https://user@skillpack.app/", "/fr"]);
    expect(payloads.map((p) => p.urlList.length)).toEqual([10_000, 1]);
    expect(payloads[0]).toMatchObject({ host: "skillpack.app", key: INDEXNOW_KEY, keyLocation: `${origin}${INDEXNOW_KEY_PATH}` });
    expect(payloads).toEqual(indexNowPayloads([...urls].reverse()));
  });
});

describe("IndexNow sitemap reader", () => {
  test("parses XML entities, CDATA, namespaces and alternates without treating them as pages", () => {
    const parsed = parseIndexNowSitemap(`<sm:urlset xmlns:sm="urn:sitemap"><!-- <url><loc>bad</loc></url> -->
      <sm:url><sm:loc><![CDATA[${origin}${article}]]></sm:loc><xhtml:link href="${origin}/blog/alternate"/></sm:url>
      <sm:url><sm:loc>${origin}/fr?q=one&amp;page=2</sm:loc></sm:url>
      <sm:url><sm:loc>https://evil.example/page</sm:loc></sm:url></sm:urlset>`);
    expect(parsed.index).toBe(false);
    expect(parsed.entries).toEqual([entry(article, [`${origin}/blog/alternate`]), entry("/fr?q=one&page=2")]);
    expect(() => parseIndexNowSitemap("<html>Oops</html>")).toThrow("Invalid sitemap");
  });
  test("follows nested indexes once, ignores foreign hosts, and rejects redirects", async () => {
    const calls: string[] = [];
    const pages = {
      [`${origin}/sitemap.xml`]: `<sitemapindex><sitemap><loc>${origin}/child.xml</loc></sitemap><sitemap><loc>https://evil.example/sitemap.xml</loc></sitemap></sitemapindex>`,
      [`${origin}/child.xml`]: `<sitemapindex><sitemap><loc>${origin}/sitemap.xml</loc></sitemap><sitemap><loc>${origin}/pages.xml</loc></sitemap></sitemapindex>`,
      [`${origin}/pages.xml`]: `<urlset><url><loc>${origin}${article}</loc></url></urlset>`,
    };
    const fetcher: IndexNowFetch = async (url, options) => {
      calls.push(String(url));
      expect(options?.redirect).toBe("error");
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      return new Response(Object.entries(pages).find(([path]) => path === url)?.[1]);
    };
    expect(await readIndexNowSitemap(fetcher)).toEqual([entry(article)]);
    expect(calls).toEqual(Object.keys(pages));
  });
});

describe("IndexNow submission (all network calls mocked)", () => {
  test("preview/local and dry-run never make any network call", async () => {
    const logs: string[] = [];
    const fetcher: IndexNowFetch = () => { throw new Error("Network must not be used"); };
    await submitIndexNow([`${origin}${article}`], { env: {}, fetcher, log: (s) => logs.push(s) });
    await submitIndexNow([`${origin}${article}`], { env: production, dryRun: true, fetcher, log: (s) => logs.push(s) });
    expect(logs[0]).toBe("IndexNow: skipped (not production)");
    expect(logs[1]).toContain('"urlList"');
    expect(logs[1]).toContain(`${origin}${article}`);
    expect(logs[1]).toContain("dry-run (no POST)");
  });
  test("production verifies the live key before a bounded JSON POST", async () => {
    const calls: string[] = [];
    const fetcher: IndexNowFetch = async (url, options) => {
      calls.push(String(url));
      expect(options?.redirect).toBe("error");
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      if (calls.length === 1) return new Response(INDEXNOW_KEY, { headers: { "content-type": "text/plain" } });
      expect(options?.method).toBe("POST");
      expect(JSON.parse(String(options?.body))).toEqual(indexNowPayloads([`${origin}${article}`])[0]);
      return new Response(null, { status: 202 });
    };
    await submitIndexNow([`${origin}${article}`], { env: production, fetcher, log: () => {} });
    expect(calls).toEqual([`${origin}${INDEXNOW_KEY_PATH}`, INDEXNOW_ENDPOINT]);
  });
  test.each([
    [201, "text/plain", INDEXNOW_KEY],
    [200, "text/plain-variant", INDEXNOW_KEY],
    [200, "text/html", INDEXNOW_KEY],
    [200, "text/plain", `${INDEXNOW_KEY}\n`],
    [200, "text/plain", "wrong-key"],
  ])("rejects unexpected proof status, MIME or body before POST: %s %s", async (status, contentType, body) => {
    const calls: string[] = [];
    const fetcher: IndexNowFetch = async (url) => {
      calls.push(url);
      return new Response(body, { status, headers: { "content-type": contentType } });
    };
    await submitIndexNow([`${origin}${article}`], { env: production, fetcher, log: () => {} });
    expect(calls).toEqual([`${origin}${INDEXNOW_KEY_PATH}`]);
  });

  test("missing live key, timeout, and HTTP errors always resolve without failing CI", async () => {
    for (const failure of ["key", "timeout", "http"]) {
      const logs: string[] = [];
      let calls = 0;
      const fetcher: IndexNowFetch = async () => {
        calls++;
        if (failure === "timeout") throw new Error("timeout");
        if (failure === "key") return new Response("not live", { status: 404 });
        return calls === 1 ? new Response(INDEXNOW_KEY, { headers: { "content-type": "text/plain" } }) : new Response(null, { status: 429 });
      };
      await expect(submitIndexNow([`${origin}${article}`], { env: production, fetcher, log: (s) => logs.push(s) })).resolves.toBeUndefined();
      expect(calls).toBe(failure === "http" ? 2 : 1);
      expect(logs.join()).toMatch(/ignored/);
    }
  });
});

describe("IndexNow previous production baseline", () => {
  const current = { id: 10, sha: "a".repeat(40), environment: "Production", created_at: "2026-11-02T10:00:00Z" };
  const env = { GITHUB_REPOSITORY: "The-Vibe-Company/skillpack", GH_TOKEN: "mock-token" };
  const deployment = (id: number, day: string, creator = "vercel[bot]") => ({
    ...current, id, sha: id.toString().repeat(40), created_at: `2026-11-${day}T10:00:00Z`, creator: { login: creator },
  });

  test("uses previous successful Vercel production, even if now inactive, instead of HEAD^", async () => {
    const calls: string[] = [];
    const fetcher: IndexNowFetch = async (url, options) => {
      calls.push(url);
      expect(options?.redirect).toBe("error");
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      expect(options?.headers).toMatchObject({ Authorization: "Bearer mock-token" });
      if (url.includes("deployments?")) return Response.json([
        deployment(11, "03"), { ...current, creator: { login: "vercel[bot]" } },
        deployment(9, "01", "someone-else"), deployment(8, "01"), deployment(7, "01"),
      ]);
      if (url.includes("/8/statuses")) return Response.json([{ state: "failure" }]);
      if (url.includes("/7/statuses")) return Response.json([{ state: "inactive" }, { state: "success" }]);
      throw new Error(`Unexpected URL ${url}`);
    };
    expect(await previousProductionSha(current, { env, fetcher })).toBe("7".repeat(40));
    expect(calls).toHaveLength(3);
  });

  test("returns no baseline for a first production deployment and fails closed on history errors", async () => {
    expect(await previousProductionSha(current, { env, fetcher: async () => Response.json([]) })).toBeNull();
    await expect(previousProductionSha(current, { env, fetcher: async () => new Response(null, { status: 403 }) }))
      .rejects.toThrow("GitHub API HTTP 403");
  });
});
