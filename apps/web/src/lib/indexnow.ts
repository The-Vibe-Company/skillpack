// Public ownership proof, not a credential. Keep public/<key>.txt in sync.
export const INDEXNOW_KEY = "498a19c36795d0a81cb9c7d2a398d449";
export const INDEXNOW_ORIGIN = "https://skillpack.app";
export const INDEXNOW_KEY_PATH = `/${INDEXNOW_KEY}.txt`;
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const TIMEOUT_MS = 8_000;

export type SitemapEntry = { url: string; alternates: string[] };
type Environment = Record<string, string | undefined>;
export type IndexNowFetch = (url: string, options?: RequestInit) => Promise<Response>;

export function isIndexNowProduction(env: Environment): boolean {
  return env.VERCEL_ENV === "production" && env.VERCEL_GIT_COMMIT_REF === "main";
}

export function isIndexNowUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return value.startsWith(`${INDEXNOW_ORIGIN}/`) && url.origin === INDEXNOW_ORIGIN &&
      !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

function xmlText(value: string): string {
  return value.trim().replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) =>
      String.fromCodePoint(code.toLowerCase().startsWith("x") ? parseInt(code.slice(1), 16) : Number(code)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

// Read only <loc> inside <url>/<sitemap>, never hreflang links as entries.
// No XML entities are fetched or expanded. Supports default/prefixed namespaces.
export function parseIndexNowSitemap(xml: string) {
  const clean = xml.replace(/<!--[\s\S]*?-->/g, "");
  const index = /<(?:[\w.-]+:)?sitemapindex\b/.test(clean);
  if (!index && !/<(?:[\w.-]+:)?urlset\b/.test(clean)) throw new Error("Invalid sitemap XML");
  const tag = index ? "sitemap" : "url";
  const blocks = clean.matchAll(new RegExp(`<(?:[\\w.-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${tag}>`, "g"));
  const entries: SitemapEntry[] = [];
  for (const [, block] of blocks) {
    if (!block) continue;
    const loc = block.match(/<(?:[\w.-]+:)?loc\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?loc>/);
    if (!loc) continue;
    const url = xmlText(loc[1] ?? "");
    if (!isIndexNowUrl(url)) continue;
    const alternates = [...block.matchAll(/\bhref\s*=\s*["']([^"']+)["']/g)]
      .map((match) => xmlText(match[1] ?? "")).filter(isIndexNowUrl);
    entries.push({ url, alternates });
  }
  return { index, entries };
}

export async function readIndexNowSitemap(fetcher: IndexNowFetch = fetch): Promise<SitemapEntry[]> {
  const seen = new Set<string>();
  const entries: SitemapEntry[] = [];
  async function visit(url: string, depth: number) {
    if (seen.has(url)) return;
    if (!isIndexNowUrl(url) || depth > 5 || seen.size >= 100) throw new Error("Sitemap traversal limit");
    seen.add(url);
    const response = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" });
    if (!response.ok) throw new Error(`Sitemap HTTP ${response.status}`);
    const parsed = parseIndexNowSitemap(await response.text());
    if (parsed.index) {
      for (const entry of parsed.entries) await visit(entry.url, depth + 1);
    } else entries.push(...parsed.entries);
  }
  await visit(`${INDEXNOW_ORIGIN}/sitemap.xml`, 0);
  return entries;
}

export function selectIndexNowUrls(entries: SitemapEntry[], changedFiles: string[] | null): string[] {
  const all = new Set(entries.map((entry) => entry.url).filter(isIndexNowUrl));
  // Content slugs must match filenames (parseBlogPost enforces this at build time).
  // Shared rendering, assets and workspace packages can affect every public page.
  const sharedChange = changedFiles?.some((file) =>
    !/\.(test|spec)\.[cm]?[jt]sx?$/.test(file) && !/(^|\/)(test|tests|__tests__)\//.test(file) &&
    file !== "apps/web/src/lib/indexnow.ts" && (
      /^apps\/web\/(src|public|assets)\//.test(file) ||
      /^packages\/[^/]+\/src\//.test(file) ||
      /^apps\/web\/(next\.config\.[^/]+|content\/(?!blog\/))/.test(file)
    ));
  if (changedFiles === null || sharedChange) return [...all].sort();
  const paths = changedFiles.flatMap((file) => {
    const match = file.match(/^apps\/web\/content\/blog\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/);
    return match ? [`/blog/${match[1]}`, "/blog"] : [];
  });
  const selected = new Set(paths.map((path) => `${INDEXNOW_ORIGIN}${path}`));
  // Removed/renamed pages are never invented; the live sitemap is authoritative.
  return [...selected].filter((url) => all.has(url)).sort();
}

export function indexNowPayloads(urls: string[]) {
  const unique = [...new Set(urls.filter(isIndexNowUrl))].sort();
  const payloads = [];
  for (let i = 0; i < unique.length; i += 10_000) {
    payloads.push({
      host: "skillpack.app",
      key: INDEXNOW_KEY,
      keyLocation: `${INDEXNOW_ORIGIN}${INDEXNOW_KEY_PATH}`,
      urlList: unique.slice(i, i + 10_000),
    });
  }
  return payloads;
}

// Repeating a payload is safe; URLs are unique and deterministically ordered.
// All network failures are best effort. Never fail a deployment or CI check.
export async function submitIndexNow(
  urls: string[],
  { env = process.env, dryRun = false, fetcher = fetch, log = console.log }:
  { env?: Environment; dryRun?: boolean; fetcher?: IndexNowFetch; log?: (message: string) => void } = {},
): Promise<void> {
  if (!dryRun && !isIndexNowProduction(env)) {
    log("IndexNow: skipped (not production)");
    return;
  }
  const payloads = indexNowPayloads(urls);
  if (!payloads.length) { log("IndexNow: skipped (no changed URLs)"); return; }
  if (dryRun) {
    for (const payload of payloads) log(`IndexNow: dry-run (no POST)\n${JSON.stringify(payload, null, 2)}`);
    return;
  }
  try {
    // Ensure the proof is already live at the canonical host, without redirects.
    const proof = await fetcher(`${INDEXNOW_ORIGIN}${INDEXNOW_KEY_PATH}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error",
    });
    if (proof.status !== 200 || proof.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "text/plain" ||
      await proof.text() !== INDEXNOW_KEY) throw new Error("Production key file is not live");
    for (const payload of payloads) {
      const response = await fetcher(INDEXNOW_ENDPOINT, {
        method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error",
      });
      log(`IndexNow: HTTP ${response.status} (${payload.urlList.length} URLs)${response.ok ? "" : " — ignored (best effort)"}`);
    }
  } catch (error) {
    log(`IndexNow: submission failed (ignored): ${error instanceof Error ? error.message : String(error)}`);
  }
}

export type IndexNowDeployment = { id: number; sha: string; environment: string; created_at: string; creator?: { login: string } };

export async function previousProductionSha(
  current: IndexNowDeployment,
  { env = process.env, fetcher = fetch }: { env?: Environment; fetcher?: IndexNowFetch } = {},
): Promise<string | null> {
  const repository = env.GITHUB_REPOSITORY;
  if (!repository || !env.GH_TOKEN) throw new Error("Missing GitHub deployment context");
  async function api(path: string) {
    const response = await fetcher(`https://api.github.com/repos/${repository}/${path}`, {
      headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(8_000), redirect: "error",
    });
    if (!response.ok) throw new Error(`GitHub API HTTP ${response.status}`);
    return response.json();
  }
  // Include inactive deployments: Vercel/GitHub can mark an older success inactive.
  // Compare the last live commit, not HEAD^ (several commits may ship together).
  const deployments: IndexNowDeployment[] = await api("deployments?environment=Production&per_page=100");
  for (const deployment of deployments) {
    if (deployment.creator?.login !== "vercel[bot]" || deployment.environment !== "Production" ||
      deployment.id === current.id || deployment.created_at >= current.created_at) continue;
    const statuses: { state: string }[] = await api(`deployments/${deployment.id}/statuses?per_page=100`);
    if (statuses.some(({ state }) => state === "success")) return deployment.sha;
  }
  return null;
}
