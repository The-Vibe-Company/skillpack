import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { collectMetrics, PAGES, previewOrigin } from "./perf-lighthouse.mjs";
import { githubClient, sameHead, stickyComment, renderComment, retry } from "./perf-github.mjs";

const warning = (message) => ({ check: "infrastructure", severity: "warning", message });
const git = (...args) => execFileSync("git", args, { encoding: "utf8", timeout: 30_000, maxBuffer: 20 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
const validSha = (sha) => /^[a-f0-9]{40}$/.test(sha ?? "");

export async function inspectDiff(base, head, pr, { runGit = git } = {}) {
  if (!validSha(base) || !validSha(head)) throw new Error("Invalid commit");
  const { inspectAssets, inspectLeftovers, inspectPreloads } = await import("./perf-static.mjs");
  let paths;
  const findings = inspectLeftovers([], pr);
  try {
    const ancestor = runGit("merge-base", base, head).trim();
    paths = runGit("diff", "--name-only", "--no-renames", "--diff-filter=ACMRT", "-z", ancestor, head, "--").split("\0").filter(Boolean);
  } catch { return [...findings, warning("Diff unavailable; PR metadata checks still apply.")]; }
  findings.push(...inspectLeftovers(paths.map((path) => ({ path })), {}));
  for (const path of paths) {
    try {
      const size = Number(runGit("cat-file", "-s", `${head}:${path}`).trim());
      if (!Number.isFinite(size)) throw new Error("Invalid blob size");
      findings.push(...inspectAssets([{ path, size }]));
      if (/\.[jt]sx$/.test(path) && !/\.(test|spec)\.[jt]sx$/.test(path)) {
        if (size > 2 * 1024 * 1024) findings.push(warning("JSX file exceeds analysis capacity; preload lint unavailable for that file."));
        else findings.push(...inspectPreloads(path, runGit("show", `${head}:${path}`)));
      }
    } catch { findings.push({ ...warning("Changed blob unavailable; remaining files and metadata still checked."), path }); }
  }
  return findings;
}

export async function previewAccessible(origin, bypass, fetcher = fetch) {
  previewOrigin(origin);
  // Probe all measured pages. Redirects are deliberately not followed with credentials.
  for (const page of PAGES) {
    await retry(async () => {
      const response = await fetcher(new URL(page, origin), {
        redirect: "manual", signal: AbortSignal.timeout(15_000),
        headers: bypass ? { "x-vercel-protection-bypass": bypass } : {},
      });
      await response.body?.cancel();
      if (!response.ok || response.headers.get("x-vercel-mitigated") || !response.headers.get("content-type")?.includes("text/html")) {
        throw new Error("Preview unavailable or protected");
      }
    });
  }
}

export function conclusion(findings) {
  return findings.some((f) => f.severity === "blocking") ? "failure" : findings.some((f) => f.severity === "warning") ? "neutral" : "success";
}

export async function report(api, pr, state, repository) {
  // Jobs serialize by PR, then recheck head before publishing to avoid stale deployments.
  const current = await api(`pulls/${pr.number}`);
  if (!sameHead(current, state.sha, repository)) return null;
  state = await stickyComment(api, pr.number, state);
  const checks = await api(`commits/${state.sha}/check-runs?check_name=Performance%20guardrails&per_page=100`);
  const existing = checks.check_runs?.find((check) => check.name === "Performance guardrails" && check.app?.slug === "github-actions");
  const checkBody = {
    name: "Performance guardrails", head_sha: state.sha, status: "completed",
    conclusion: conclusion(state.findings),
    output: { title: "Mobile performance and diff guardrails", summary: renderComment({ ...state, findings: state.findings.slice(0, 70) }).split("<!-- skillpack:perf-state")[0] },
  };
  if (existing) {
    delete checkBody.head_sha;
    await api(`check-runs/${existing.id}`, { method: "PATCH", body: checkBody });
  } else await api("check-runs", { method: "POST", body: checkBody });
  return state;
}

async function main() {
  const local = process.argv.includes("--static");
  const findings = [];
  let state;
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    const api = local ? null : githubClient();
    const number = local ? event.pull_request?.number : Number(process.env.PERF_PR);
    if (!Number.isSafeInteger(number) || number < 1) throw new Error("PR unavailable");
    const pr = local ? event.pull_request : await api(`pulls/${number}`);
    const sha = local ? pr.head.sha : process.env.PERF_SHA;
    if (!sameHead(pr, sha, process.env.GITHUB_REPOSITORY)) return;
    state = { sha, measured: false, rows: [], findings };
    if (!local) {
      // Fetch PR objects into the object database; never check out or execute PR code.
      try { await retry(async () => { git("fetch", "--no-tags", "origin", `pull/${number}/head`, pr.base.sha); }); }
      catch { findings.push(warning("PR object fetch unavailable; available blobs and PR metadata still checked.")); }
    }
    try { findings.push(...await inspectDiff(pr.base.sha, sha, pr)); }
    catch { findings.push(warning("Diff analysis unavailable; no static verdict (fetch/dependencies/capacity).")); }
    if (!local && process.env.GITHUB_EVENT_NAME === "deployment_status") {
      try {
        const preview = previewOrigin(process.env.PERF_PREVIEW);
        await previewAccessible(preview, process.env.VERCEL_AUTOMATION_BYPASS_SECRET);
        const measured = await collectMetrics(preview, {
          bypass: process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
          blocking: process.env.PERF_REGRESSION_BLOCKING === "true",
        });
        state.rows = measured.rows;
        state.measured = true;
        findings.push(...measured.findings);
      } catch {
        findings.push({ check: "lighthouse", severity: "warning", message: "Preview missing, protected or unavailable. For protected previews configure VERCEL_AUTOMATION_BYPASS_SECRET; no performance verdict." });
      }
    }
    if (!local) {
      try { state = await report(api, pr, state, process.env.GITHUB_REPOSITORY) ?? state; }
      catch { findings.push(warning("GitHub comment/check publication unavailable (network/quota/permissions).")); }
    }
  } catch { findings.push(warning("Guardrails unavailable (network/quota/event); no performance verdict.")); }
  state ??= { sha: process.env.PERF_SHA ?? "unavailable", measured: false, rows: [], findings };
  const body = renderComment(state).split("<!-- skillpack:perf-state")[0];
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, body);
  // Generic log only: PR titles, source text, provider errors and secrets stay out of logs.
  const result = conclusion(state.findings);
  console.log(result === "failure" ? "::error::Performance guardrails found blocking violations; see job summary." : result === "neutral" ? "::warning::Guardrails include unavailable evidence or warnings; see job summary." : "Performance guardrails passed.");
  process.exitCode = result === "failure" ? 1 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
