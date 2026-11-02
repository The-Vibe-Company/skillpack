// Isolated process with no GitHub token. Do not log reports, errors, headers or URLs.
import lighthouse from "lighthouse";
import { launch } from "chrome-launcher";
import puppeteer from "puppeteer-core";
import { extractMetrics, previewOrigin, PRODUCTION } from "./perf-lighthouse.mjs";

let chrome;
let browser;
// Bound Chrome launch, navigation, Lighthouse and cleanup, including orphan children.
const watchdog = setTimeout(() => {
  if (chrome?.pid) { try { process.kill(chrome.pid, "SIGKILL"); } catch { /* Already stopped. */ } }
  process.exit(2);
}, 90_000);
try {
  const url = new URL(process.argv[2]);
  const isPreview = url.origin !== PRODUCTION;
  if (isPreview) previewOrigin(url.href);
  chrome = await launch({ chromeFlags: ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage"], logLevel: "silent" });
  browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${chrome.port}`, protocolTimeout: 20_000 });
  const page = await browser.newPage();
  let navigationOk = false;
  page.on("response", (response) => {
    const request = response.request();
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      navigationOk = response.ok() && !response.headers()["x-vercel-mitigated"];
    }
  });
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const headers = { ...request.headers() };
    // Never send the bypass to production, redirects or third-party subresources.
    delete headers["x-vercel-protection-bypass"];
    if (isPreview && process.env.PERF_BYPASS && new URL(request.url()).origin === url.origin) {
      headers["x-vercel-protection-bypass"] = process.env.PERF_BYPASS;
    }
    void request.continue({ headers }).catch(() => {});
  });
  const result = await lighthouse(url.href, {
    port: chrome.port, logLevel: "silent", onlyCategories: ["performance"],
    formFactor: "mobile", throttlingMethod: "simulate", maxWaitForLoad: 35_000,
  }, undefined, page);
  if (!navigationOk) throw new Error("Main document unavailable");
  const metrics = extractMetrics(result?.lhr, url.href);
  // Runtime page composition complements the file-scoped syntax lint. Srcset
  // deduplication is approximate, so this signal warns rather than blocks.
  const preloads = await page.evaluate(() => new Set([
    ...document.querySelectorAll('img[fetchpriority="high"],link[rel="preload"][as="image"]'),
  ].map((image) => image.currentSrc || image.src || image.href || image.imageSrcset)).size);
  process.stdout.write(JSON.stringify({ ...metrics, preloads }));
} catch {
  process.exitCode = 2;
} finally {
  try { await browser?.close(); } catch { /* Cleanup is bounded by watchdog. */ }
  try { await chrome?.kill(); } catch { /* Already stopped. */ }
  clearTimeout(watchdog);
}
