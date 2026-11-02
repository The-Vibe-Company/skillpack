import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deploymentContext, resolveEvent, githubClient, paginate, retry, stickyComment, renderComment, readState, MARKER } from "./perf-github.mjs";
import { conclusion, previewAccessible, report, inspectDiff } from "./perf-guardrails.mjs";

const sha = "a".repeat(40);
const repository = "example/repo";
const pr = { number: 42, state: "open", head: { sha }, base: { sha: "b".repeat(40), repo: { full_name: repository } } };
const event = () => ({ deployment: { sha, environment: "Preview", creator: { login: "vercel[bot]" } }, deployment_status: { state: "success", environment_url: "https://preview.vercel.app" } });
const state = (extra = {}) => ({ sha, measured: false, rows: [], findings: [], ...extra });

test("deployment resolution requires Preview success from Vercel and exact current PR head SHA", async () => {
  assert.deepEqual(await deploymentContext(event(), async () => [pr], repository), { number: 42, sha, preview: "https://preview.vercel.app" });
  for (const modify of [
    (e) => { e.deployment.environment = "Production"; },
    (e) => { e.deployment_status.state = "failure"; },
    (e) => { e.deployment.creator.login = "other"; },
    (e) => { e.deployment.sha = "unsafe"; },
  ]) { const e = event(); modify(e); assert.equal(await deploymentContext(e, async () => [pr], repository), null); }
  for (const prs of [[], [pr, { ...pr, number: 43 }], [{ ...pr, state: "closed" }], [{ ...pr, head: { sha: "c".repeat(40) } }]]) {
    assert.equal(await deploymentContext(event(), async () => prs, repository), null);
  }
});
test("missing preview URL stays associated with PR for a neutral report; target events use PR", async () => {
  const e = event(); e.deployment_status.environment_url = "https://attacker.example";
  assert.equal((await deploymentContext(e, async () => [pr], repository)).preview, "");
  assert.equal((await resolveEvent({ pull_request: pr }, "pull_request_target", null, repository)).number, 42);
});
test("pagination includes later results; retries are bounded and redact provider errors", async () => {
  let calls = 0;
  assert.equal((await paginate(async () => ++calls === 1 ? Array(100).fill(pr) : [pr], "pulls")).length, 101);
  let attempts = 0;
  await assert.rejects(retry(async () => { attempts++; throw new Error("sensitive provider value"); }, { delay: async () => {} }), (error) => error.message === "External service unavailable");
  assert.equal(attempts, 3);
});
test("GitHub requests have timeouts; token is header-only, never errors", async () => {
  let seen;
  const api = githubClient({ repository, token: "test-only-token", fetcher: async (url, options) => {
    seen = { url, options }; return Response.json([]);
  } });
  await api("pulls");
  assert.equal(seen.url.includes("test-only-token"), false);
  assert.equal(seen.options.headers.Authorization, "Bearer test-only-token");
  assert.ok(seen.options.signal instanceof AbortSignal);
});
test("sticky updates bot-owned marker only and retains measurements on metadata edits", async () => {
  const measured = state({ measured: true, rows: [{ page: "/", prod: { perf: 90, lcp: 1000, tbt: 50, cls: 0.01 }, preview: { perf: 91, lcp: 990, tbt: 45, cls: 0.02 } }], findings: [{ check: "lighthouse", severity: "warning", message: "/: regression" }] });
  const comments = [{ id: 1, user: { login: "contributor" }, body: renderComment(measured) }, { id: 2, user: { login: "github-actions[bot]" }, body: renderComment(measured) }];
  const writes = [];
  const api = async (path, options) => { if (!options) return comments; writes.push({ path, ...options }); return {}; };
  const updated = await stickyComment(api, 42, state({ findings: [{ check: "leftovers", severity: "blocking", message: "marker" }] }));
  assert.equal(updated.rows.length, 1);
  assert.equal(updated.findings.length, 2);
  assert.equal(writes[0].path, "issues/comments/2");
  assert.equal(writes[0].method, "PATCH");
  assert.ok(writes[0].body.body.startsWith(MARKER));
  assert.equal(readState(writes[0].body.body, "b".repeat(40)), null);
  assert.equal(readState("invalid", sha), null);
});
test("new heads never inherit stale measurements and all metric deltas appear", async () => {
  const old = state({ measured: true, sha: "b".repeat(40), rows: [{ page: "/", prod: null, preview: null }] });
  const updated = await stickyComment(async (_path, options) => options ? {} : [{ id: 1, user: { login: "github-actions[bot]" }, body: renderComment(old) }], 42, state());
  assert.equal(updated.rows.length, 0);
  const text = renderComment(state({ rows: [{ page: "/", prod: { perf: 90, lcp: 1000, tbt: 50, cls: 0.01 }, preview: { perf: 91, lcp: 1300, tbt: 45, cls: 0.02 } }] }));
  for (const term of ["Performance /100", "LCP ms", "TBT ms", "CLS", "+300", "-5", "+0.010"]) assert.ok(text.includes(term));
});

test("incomplete same-SHA reruns retain proven blocking measurements until a valid replacement", async () => {
  const old = state({ measured: true, rows: [{ page: "/", prod: { perf: 90, lcp: 1000, tbt: 50, cls: 0.01 }, preview: { perf: 70, lcp: 1400, tbt: 200, cls: 0.1 } }], findings: [{ check: "lighthouse", severity: "blocking", message: "/: median preview CLS exceeds 0.05." }] });
  const api = async (_path, options) => options ? {} : [{ id: 1, user: { login: "github-actions[bot]" }, body: renderComment(old) }];
  const missing = await stickyComment(api, 42, state({ measured: true, rows: [{ page: "/", prod: old.rows[0].prod, preview: null }] }));
  assert.equal(conclusion(missing.findings), "failure");
  assert.equal(missing.rows[0].preview.cls, 0.1);
  const fixed = await stickyComment(api, 42, state({ measured: true, rows: [{ page: "/", prod: old.rows[0].prod, preview: old.rows[0].prod }] }));
  assert.equal(conclusion(fixed.findings), "success");
});
test("publication refuses stale heads and publishes failures on actual PR SHA", async () => {
  const writes = [];
  const api = async (path, options) => {
    if (!options) return path === "pulls/42" ? pr : [];
    writes.push({ path, ...options }); return {};
  };
  const failed = state({ findings: [{ check: "assets", severity: "blocking", message: "oversize" }] });
  await report(api, pr, failed, repository);
  const check = writes.find((call) => call.path === "check-runs");
  assert.equal(check.body.head_sha, sha);
  assert.equal(check.body.conclusion, "failure");
  assert.equal(await report(async () => ({ ...pr, head: { sha: "c".repeat(40) } }), pr, failed, repository), null);
  assert.equal(conclusion([{ severity: "warning" }]), "neutral");
  assert.equal(conclusion([]), "success");
});
test("protected/missing/network previews are unavailable, no credential redirects", async () => {
  let calls = 0;
  await previewAccessible("https://preview.vercel.app", "test-only-bypass", async (url, options) => {
    calls++;
    assert.equal(options.redirect, "manual");
    assert.equal(options.headers["x-vercel-protection-bypass"], "test-only-bypass");
    return new Response("ok", { headers: { "content-type": "text/html" } });
  });
  assert.equal(calls, 2);
  await assert.rejects(previewAccessible("https://preview.vercel.app", "", async (_url, options) => {
    assert.deepEqual(options.headers, {});
    return new Response("login", { status: 401 });
  }));
  await assert.rejects(previewAccessible("https://evil.example", "secret", async () => { throw new Error("must not fetch"); }));
});
test("diff reads changed blobs only and blocking fixtures do not require large committed files", async () => {
  const calls = [];
  const findings = await inspectDiff("b".repeat(40), sha, { ...pr, title: "DO NOT MERGE" }, { runGit: (...args) => {
    calls.push(args);
    if (args[0] === "merge-base") return "b".repeat(40);
    if (args[0] === "diff") return "apps/web/public/logo.png\0screenshots/pr-42.txt\0apps/web/src/page.tsx\0";
    if (args[0] === "cat-file") return args[2].endsWith("logo.png") ? String(519 * 1024) : "30";
    if (args[0] === "show") return '<Image priority className="hidden sm:block" />';
    throw new Error("Unexpected git command");
  } });
  assert.ok(findings.some((f) => f.check === "assets" && f.severity === "blocking"));
  assert.equal(findings.filter((f) => f.check === "leftovers").length, 2);
  assert.ok(findings.some((f) => f.check === "preload" && f.severity === "blocking"));
  assert.ok(calls.find((args) => args[0] === "diff").includes("--diff-filter=ACMRT"));
  assert.ok(calls.filter((args) => args[0] === "show").every((args) => !args[1].endsWith("logo.png")));
});

test("CLI blocks a real temporary diff fixture and ignores deleted leftovers", () => {
  const cwd = mkdtempSync(join(tmpdir(), "perf-fixture-"));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
  try {
    git("init"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
    writeFileSync(join(cwd, "base.txt"), "baseline"); git("add", "base.txt"); git("commit", "-m", "fixture baseline");
    const base = git("rev-parse", "HEAD");
    mkdirSync(join(cwd, "screenshots"));
    writeFileSync(join(cwd, "screenshots/pr-42.txt"), "tiny fixture");
    writeFileSync(join(cwd, "page.tsx"), '<Image priority className="hidden sm:block" />');
    git("add", "screenshots/pr-42.txt", "page.tsx"); git("commit", "-m", "blocking fixture");
    const script = fileURLToPath(new URL("./perf-guardrails.mjs", import.meta.url));
    const eventPath = join(cwd, "event.json");
    const run = () => {
      const head = git("rev-parse", "HEAD");
      writeFileSync(eventPath, JSON.stringify({ pull_request: { ...pr, head: { sha: head }, base: { ...pr.base, sha: base } } }));
      return spawnSync(process.execPath, [script, "--static"], { cwd, encoding: "utf8", timeout: 20_000,
        env: { ...process.env, GITHUB_REPOSITORY: repository, GITHUB_EVENT_PATH: eventPath, GITHUB_STEP_SUMMARY: "" } });
    };
    assert.equal(run().status, 1);
    git("rm", "screenshots/pr-42.txt", "page.tsx"); git("commit", "-m", "remove fixture");
    assert.equal(run().status, 0);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("unavailable gitlink or diff cannot erase independent violations", async () => {
  const runGit = (...args) => {
    if (args[0] === "merge-base") return "b".repeat(40);
    if (args[0] === "diff") return "screenshots/pr-42.txt\0unavailable-submodule\0logo.svg\0";
    if (args[0] === "cat-file" && args[2].endsWith("unavailable-submodule")) throw new Error("Missing object");
    return "60000";
  };
  const found = await inspectDiff("b".repeat(40), sha, { title: "DO NOT MERGE" }, { runGit });
  assert.equal(found.filter((finding) => finding.check === "leftovers").length, 2);
  assert.ok(found.some((finding) => finding.check === "assets" && finding.severity === "blocking"));
  assert.ok(found.some((finding) => finding.check === "infrastructure"));
  const unavailable = await inspectDiff("b".repeat(40), sha, { title: "DO NOT MERGE" }, { runGit: () => { throw new Error("Missing base"); } });
  assert.equal(conclusion(unavailable), "failure");
});
