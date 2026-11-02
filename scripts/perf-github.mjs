import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { previewOrigin } from "./perf-lighthouse.mjs";

export const MARKER = "<!-- skillpack:perf-guardrails -->";
export const STATE_MARKER = "<!-- skillpack:perf-state ";

export async function retry(operation, { attempts = 3, delay = (ms) => new Promise((done) => setTimeout(done, ms)) } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); } catch {
      if (attempt + 1 >= attempts) throw new Error("External service unavailable");
      await delay(500 * 2 ** attempt);
    }
  }
}

export function githubClient({ token = process.env.GH_TOKEN, repository = process.env.GITHUB_REPOSITORY, fetcher = fetch } = {}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? "")) throw new Error("Invalid repository");
  return async (path, { method = "GET", body } = {}) => retry(async () => {
    const options = {
      method, signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
    };
    if (body) options.body = JSON.stringify(body);
    const response = await fetcher(`https://api.github.com/repos/${repository}/${path}`, options);
    // Never surface provider bodies; errors may echo credentials or arbitrary PR text.
    if (!response.ok) throw new Error("GitHub unavailable");
    return response.status === 204 ? null : response.json();
  });
}

export async function paginate(api, path) {
  const rows = [];
  for (let page = 1; page <= 100; page++) {
    const batch = await api(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error("Invalid pagination");
    rows.push(...batch);
    if (batch.length < 100) return rows;
  }
  throw new Error("Pagination limit");
}

export function sameHead(pr, sha, repository) {
  return pr.state === "open" && pr.head?.sha === sha && pr.base?.repo?.full_name === repository;
}

export async function deploymentContext(event, api, repository) {
  const deployment = event.deployment;
  if (event.deployment_status?.state !== "success" || !deployment ||
    deployment.environment?.toLowerCase() === "production" || deployment.creator?.login !== "vercel[bot]" ||
    !/^[a-f0-9]{40}$/.test(deployment.sha ?? "")) return null;
  const prs = await paginate(api, `commits/${deployment.sha}/pulls`);
  const candidates = prs.filter((pr) => sameHead(pr, deployment.sha, repository));
  // Ambiguity is neutral: never attach a report to an unrelated or outdated PR.
  if (candidates.length !== 1) return null;
  const pr = candidates[0];
  let preview = "";
  try { preview = previewOrigin(event.deployment_status.environment_url || event.deployment_status.target_url); } catch { /* Missing/unsupported URL remains neutral. */ }
  return { number: pr.number, sha: pr.head.sha, preview };
}

export function readState(body, sha) {
  const encoded = body?.split(STATE_MARKER)[1]?.split(" -->")[0];
  try {
    const state = JSON.parse(Buffer.from(encoded ?? "", "base64").toString());
    return state.sha === sha && Array.isArray(state.rows) ? state : null;
  } catch { return null; }
}

const cell = (value) => String(value).replace(/[\r\n|<>`]/g, " ");
const delta = (a, b, digits = 0) => `${b - a >= 0 ? "+" : ""}${(b - a).toFixed(digits)}`;

export function renderComment(state) {
  const lines = [MARKER, "## Performance guardrails", "", `Head: \`${state.sha}\`. Mobile Lighthouse; ≥3 valid runs per side, alternating production/preview in one job.`, "",
    "| Page | Metric | Production median | Preview median | Delta |", "| --- | --- | ---: | ---: | ---: |"];
  for (const row of state.rows) {
    for (const [key, label, digits] of [["perf", "Performance /100", 1], ["lcp", "LCP ms", 0], ["tbt", "TBT ms", 0], ["cls", "CLS", 3]]) {
      const a = row.prod?.[key]; const b = row.preview?.[key];
      lines.push(`| ${cell(row.page)} | ${label} | ${a == null ? "Unavailable" : a.toFixed(digits)} | ${b == null ? "Unavailable" : b.toFixed(digits)} | ${a == null || b == null ? "—" : delta(a, b, digits)} |`);
    }
  }
  if (!state.rows.length) lines.push("| Pending deployment | All | — | — | — |");
  lines.push("", "| Check | Result |", "| --- | --- |");
  for (const name of ["assets", "preload", "leftovers", "lighthouse", "infrastructure"]) {
    const found = state.findings.filter((finding) => finding.check === name);
    lines.push(`| ${name} | ${found.some((f) => f.severity === "blocking") ? "BLOCKING" : found.length ? "WARNING" : name === "lighthouse" && !state.rows.length ? "Pending preview" : "Pass"} |`);
  }
  for (const finding of state.findings.slice(0, 70)) lines.push(`- **${cell(finding.severity)}** ${cell(finding.message)}${finding.path ? ` (${cell(finding.path)}${finding.line ? `:${finding.line}` : ""})` : ""}`);
  if (state.findings.length > 70) lines.push(`- ${state.findings.length - 70} additional findings; see job summary.`);
  lines.push("", "CLS >0.05 blocks. LCP >20% AND >300 ms, or TBT >100 ms: warnings unless PERF_REGRESSION_BLOCKING=true. Missing network/protection/quota evidence is neutral.", "",
    `${STATE_MARKER}${Buffer.from(JSON.stringify(state)).toString("base64")} -->`);
  return lines.join("\n");
}

export async function stickyComment(api, number, state) {
  const comments = await paginate(api, `issues/${number}/comments`);
  const own = comments.filter((comment) => comment.user?.login === "github-actions[bot]" && comment.body?.startsWith(MARKER));
  const first = own[0];
  const old = readState(first?.body, state.sha);
  if (old?.measured) {
    const retained = old.rows.filter((previous) => {
      const current = state.rows.find((row) => row.page === previous.page);
      return !current?.prod || !current?.preview;
    });
    const retainedPages = new Set(retained.map((row) => row.page));
    const previousFindings = old.findings.filter((finding) => finding.check === "lighthouse" && retained.some((row) => finding.message.startsWith(`${row.page}:`)));
    state = { ...state, measured: true,
      rows: [...state.rows.filter((row) => !retainedPages.has(row.page)), ...retained],
      findings: [...state.findings, ...previousFindings.filter((oldFinding) => !state.findings.some((finding) => finding.message === oldFinding.message && finding.severity === oldFinding.severity))],
    };
  }
  const body = renderComment(state);
  if (body.length > 60_000) throw new Error("Comment capacity exceeded");
  if (first) await api(`issues/comments/${first.id}`, { method: "PATCH", body: { body } });
  else await api(`issues/${number}/comments`, { method: "POST", body: { body } });
  // Reconcile a retried POST whose first response was lost, and historical duplicates.
  const refreshed = await paginate(api, `issues/${number}/comments`);
  const marked = refreshed.filter((comment) => comment.user?.login === "github-actions[bot]" && comment.body?.startsWith(MARKER));
  for (const duplicate of marked.slice(1)) await api(`issues/comments/${duplicate.id}`, { method: "DELETE" });
  return state;
}

export async function resolveEvent(event, eventName, api, repository) {
  if (eventName === "deployment_status") return deploymentContext(event, api, repository);
  const pr = event.pull_request;
  if (!pr || pr.state !== "open" || pr.base?.repo?.full_name !== repository) return null;
  return { number: pr.number, sha: pr.head.sha, preview: "" };
}

async function main() {
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    const context = await resolveEvent(event, process.env.GITHUB_EVENT_NAME, githubClient(), process.env.GITHUB_REPOSITORY);
    if (context) appendFileSync(process.env.GITHUB_OUTPUT, `number=${context.number}\nsha=${context.sha}\npreview=${context.preview}\n`);
    else console.log("::warning::No unique current PR / preview found; guardrails are neutral.");
  } catch { console.log("::warning::GitHub resolution unavailable (network/quota); guardrails are neutral."); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
