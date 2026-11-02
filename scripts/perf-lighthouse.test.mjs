import { test } from "node:test";
import assert from "node:assert/strict";
import { median, extractMetrics, evaluatePage, collectMetrics, previewOrigin, PRODUCTION } from "./perf-lighthouse.mjs";

const metrics = (overrides = {}) => ({ perf: 90, lcp: 1000, tbt: 50, cls: 0.02, ...overrides });
test("medians reject incomplete/nonfinite series and ignore outlier order", () => {
  assert.equal(median([900, 2, 1]), 2);
  assert.equal(median([1, 3, 2, 4]), 2.5);
  for (const series of [[], [1, 2], [1, 2, NaN], [1, -1, 2]]) assert.equal(median(series), null);
});
test("CLS is independently blocking; regression thresholds use strict AND", () => {
  assert.equal(evaluatePage("/", metrics(), metrics({ cls: 0.051 }))[0].severity, "blocking");
  assert.deepEqual(evaluatePage("/", metrics(), metrics({ cls: 0.05, lcp: 1300, tbt: 150 })), []);
  assert.deepEqual(evaluatePage("/", metrics({ lcp: 10_000 }), metrics({ lcp: 10_500 })), []);
  assert.equal(evaluatePage("/", metrics(), metrics({ lcp: 1301 }))[0].severity, "warning");
  assert.equal(evaluatePage("/", metrics(), metrics({ tbt: 151 }), true)[0].severity, "blocking");
  assert.equal(evaluatePage("/", null, metrics({ cls: 0.1 }))[0].severity, "blocking");
  assert.equal(evaluatePage("/", metrics(), null)[0].severity, "warning");
});
test("only HTTPS Vercel origins are accepted, credentials/query/path removed", () => {
  assert.equal(previewOrigin("https://a.vercel.app/foo?secret=no"), "https://a.vercel.app");
  for (const url of ["http://a.vercel.app", "https://evil.com", "https://a.vercel.app.evil.com", "https://user:pass@a.vercel.app", "https://a.vercel.app:444"]) assert.throws(() => previewOrigin(url));
});
test("extract only complete numeric metrics from the expected successful page", () => {
  const lhr = { finalDisplayedUrl: `${PRODUCTION}/`, categories: { performance: { score: 0.9 } }, audits: {
    "http-status-code": { score: 1 }, "largest-contentful-paint": { numericValue: 1000 },
    "total-blocking-time": { numericValue: 50 }, "cumulative-layout-shift": { numericValue: 0.02 },
  } };
  assert.deepEqual(extractMetrics(lhr, `${PRODUCTION}/`), metrics());
  for (const change of [{ runtimeError: {} }, { finalDisplayedUrl: `${PRODUCTION}/login` }, { finalDisplayedUrl: "https://vercel.com/login" }, { audits: {} }]) {
    assert.throws(() => extractMetrics({ ...lhr, ...change }, `${PRODUCTION}/`));
  }
});
test("runs alternate within each page; only preview receives bypass; medians resist outliers", async () => {
  const calls = [];
  const result = await collectMetrics("https://preview.vercel.app", { pages: ["/"], bypass: "test-only-bypass", audit: async (url, secret) => {
    calls.push([url, secret]);
    return metrics({ lcp: calls.length === 2 ? 999999 : 1000 });
  } });
  assert.equal(calls.length, 6);
  assert.deepEqual(calls.map(([, secret]) => secret), ["", "test-only-bypass", "", "test-only-bypass", "", "test-only-bypass"]);
  assert.deepEqual(calls.map(([url]) => new URL(url).origin), Array(3).fill([PRODUCTION, "https://preview.vercel.app"]).flat());
  assert.equal(result.rows[0].preview.lcp, 1000);
  assert.deepEqual(result.findings, []);
});
test("retry pairs keep alternating, failures/invalid metrics cannot become a blocking score", async () => {
  let calls = 0;
  const recovered = await collectMetrics("https://p.vercel.app", { pages: ["/"], audit: async () => {
    if (++calls <= 2) throw new Error("network");
    return metrics();
  } });
  assert.equal(calls, 8);
  assert.deepEqual(recovered.rows[0].counts, { prod: 3, preview: 3 });
  const failed = await collectMetrics("https://p.vercel.app", { pages: ["/"], audit: async () => metrics({ cls: NaN }) });
  assert.equal(failed.rows[0].preview, null);
  assert.deepEqual(failed.findings.map((f) => f.severity), ["warning"]);
});
test("runtime page composition above two hints warns", async () => {
  const result = await collectMetrics("https://p.vercel.app", { pages: ["/"], audit: async () => metrics({ preloads: 3 }) });
  assert.equal(result.findings[0].check, "preload");
  assert.equal(result.findings[0].severity, "warning");
});
