import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

export const PAGES = ["/", "/blog/what-is-skill-md"];
export const RUNS = 3;
export const PRODUCTION = "https://skillpack.app";

export function previewOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".vercel.app") || url.username || url.password || url.port) {
    throw new Error("Unsupported preview origin");
  }
  return url.origin;
}

export function median(values) {
  if (values.length < RUNS || values.some((value) => !Number.isFinite(value) || value < 0)) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function extractMetrics(lhr, expected) {
  if (lhr?.runtimeError || !lhr?.finalDisplayedUrl) throw new Error("Invalid audit");
  const final = new URL(lhr.finalDisplayedUrl);
  const target = new URL(expected);
  if (final.origin !== target.origin || final.pathname.replace(/\/$/, "") !== target.pathname.replace(/\/$/, "")) {
    throw new Error("Unexpected audit destination");
  }
  // The performance-only preset omits the SEO HTTP-status audit. The worker
  // separately verifies the main-document HTTP response in that configuration.
  if (lhr.audits?.["http-status-code"] && lhr.audits["http-status-code"].score !== 1) throw new Error("HTTP error page");
  const metrics = {
    perf: lhr.categories?.performance?.score == null ? null : lhr.categories.performance.score * 100,
    lcp: lhr.audits?.["largest-contentful-paint"]?.numericValue,
    tbt: lhr.audits?.["total-blocking-time"]?.numericValue,
    cls: lhr.audits?.["cumulative-layout-shift"]?.numericValue,
  };
  if (Object.values(metrics).some((value) => !Number.isFinite(value) || value < 0)) throw new Error("Missing audit metrics");
  return metrics;
}

export function summarize(samples) {
  if (samples.length < RUNS) return null;
  const values = Object.fromEntries(["perf", "lcp", "tbt", "cls"].map((key) => [key, median(samples.map((sample) => sample[key]))]));
  return Object.values(values).includes(null) ? null : values;
}

export function evaluatePage(page, prod, preview, blocking = false) {
  const findings = [];
  if (!preview) return [{ check: "lighthouse", severity: "warning", message: `${page}: fewer than three valid preview runs; no performance verdict.` }];
  if (preview.cls > 0.05) findings.push({ check: "lighthouse", severity: "blocking", message: `${page}: median preview CLS exceeds 0.05.` });
  if (!prod) findings.push({ check: "lighthouse", severity: "warning", message: `${page}: fewer than three valid production runs; regression comparison unavailable.` });
  else {
    const severity = blocking ? "blocking" : "warning";
    if (preview.lcp > prod.lcp * 1.2 && preview.lcp - prod.lcp > 300) findings.push({ check: "lighthouse", severity, message: `${page}: median LCP regresses by more than 20% AND 300 ms.` });
    if (preview.tbt - prod.tbt > 100) findings.push({ check: "lighthouse", severity, message: `${page}: median TBT regresses by more than 100 ms.` });
  }
  return findings;
}

// Only compact numeric metrics leave the child. Raw reports can contain request headers.
export function auditInChild(url, secret = "", { timeout = 100_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [fileURLToPath(new URL("./perf-audit-worker.mjs", import.meta.url)), url], {
      timeout, killSignal: "SIGKILL", maxBuffer: 16_384,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, CHROME_PATH: process.env.CHROME_PATH, PERF_BYPASS: secret },
    }, (error, stdout) => {
      if (error) return reject(new Error("Audit unavailable"));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error("Audit unavailable")); }
    });
  });
}

export async function collectMetrics(preview, { audit = auditInChild, bypass = "", blocking = false, pages = PAGES } = {}) {
  const rows = [];
  const findings = [];
  for (const page of pages) {
    const samples = { prod: [], preview: [] };
    // Each round alternates prod/preview on the same runner. Retry complete pairs,
    // never three prod runs followed by three preview runs or impute missing values.
    for (let round = 0; round < 5; round++) {
      for (const side of ["prod", "preview"]) {
        try {
          const value = await audit(new URL(page, side === "prod" ? PRODUCTION : preview).href, side === "preview" ? bypass : "");
          if (["perf", "lcp", "tbt", "cls"].some((key) => !Number.isFinite(value[key]) || value[key] < 0)) throw new Error("Invalid metrics");
          samples[side].push(value);
        } catch { /* Network, browser and protection failures are unavailable samples. */ }
      }
      if (samples.prod.length >= RUNS && samples.preview.length >= RUNS) break;
    }
    const prod = summarize(samples.prod);
    const next = summarize(samples.preview);
    rows.push({ page, prod, preview: next, counts: { prod: samples.prod.length, preview: samples.preview.length } });
    findings.push(...evaluatePage(page, prod, next, blocking));
    if (samples.preview.some((sample) => sample.preloads > 2)) findings.push({ check: "preload", severity: "warning", message: `${page}: rendered mobile page exceeds two explicit image priority/preload hints; review composed components and responsive srcsets.` });
  }
  return { rows, findings };
}
