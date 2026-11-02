import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { parse } from "yaml";
import { INDEXNOW_KEY, INDEXNOW_ORIGIN } from "./indexnow";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const fixtureDir = mkdtempSync(join(tmpdir(), "skillpack-indexnow-"));
const git = (...args: string[]) => execFileSync("git", args, { cwd: fixtureDir, encoding: "utf8" }).trim();
let baseline = "";
let head = "";

beforeAll(() => {
  git("init", "--initial-branch=main");
  git("config", "user.name", "IndexNow test");
  git("config", "user.email", "indexnow@example.invalid");
  // Two commits after the previous production, so HEAD^ would miss the article.
  git("commit", "--allow-empty", "-m", "baseline");
  baseline = git("rev-parse", "HEAD");
  mkdirSync(join(fixtureDir, "apps/web/content/blog"), { recursive: true });
  writeFileSync(join(fixtureDir, "apps/web/content/blog/hello.md"), "article");
  git("add", "apps/web/content/blog/hello.md");
  git("commit", "-m", "intermediate article");
  writeFileSync(join(fixtureDir, "README.md"), "docs");
  git("add", "README.md");
  git("commit", "-m", "current docs");
  head = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", head);
});

afterAll(() => rmSync(fixtureDir, { recursive: true, force: true }));

// The child process cannot use the network: every URL must have a fixture response.
const preload = `
import { readFileSync, appendFileSync } from 'node:fs';
globalThis.fetch = async (url, options) => {
  appendFileSync(process.env.INDEXNOW_CALLS, JSON.stringify({ url, method: options?.method ?? 'GET' }) + '\\n');
  const pages = JSON.parse(readFileSync(process.env.INDEXNOW_FIXTURES, 'utf8'));
  if (!(url in pages)) throw new Error('Unmocked network request: ' + url);
  return new Response(pages[url], { headers: { 'content-type': 'text/plain' } });
};
`;

type CliOptions = {
  args?: string[];
  env?: Partial<NodeJS.ProcessEnv>;
  state?: string;
  creator?: string;
  environment?: string;
  sha?: string;
  unavailableSitemap?: boolean;
};

function runCli(options: CliOptions = {}) {
  const callsFile = join(fixtureDir, "calls.jsonl");
  const fixturesFile = join(fixtureDir, "responses.json");
  const eventFile = join(fixtureDir, "event.json");
  writeFileSync(callsFile, "");
  writeFileSync(eventFile, JSON.stringify({
    deployment_status: { state: options.state ?? "success" },
    deployment: { id: 2, sha: options.sha ?? head, environment: options.environment ?? "Production",
      creator: { login: options.creator ?? "vercel[bot]" }, created_at: "2026-11-02T10:00:00Z" },
  }));
  writeFileSync(fixturesFile, JSON.stringify(options.unavailableSitemap ? {} : {
    [`${INDEXNOW_ORIGIN}/sitemap.xml`]: `<urlset><url><loc>${INDEXNOW_ORIGIN}/blog</loc></url><url><loc>${INDEXNOW_ORIGIN}/blog/hello</loc></url><url><loc>${INDEXNOW_ORIGIN}/privacy</loc></url></urlset>`,
    "https://api.github.com/repos/The-Vibe-Company/skillpack/deployments?environment=Production&per_page=100": JSON.stringify([{
      id: 1, sha: baseline, environment: "Production", creator: { login: "vercel[bot]" }, created_at: "2026-11-01T10:00:00Z",
    }]),
    "https://api.github.com/repos/The-Vibe-Company/skillpack/deployments/1/statuses?per_page=100": JSON.stringify([{ state: "inactive" }, { state: "success" }]),
  }));
  const output = execFileSync(process.execPath, [
    "--experimental-strip-types", "--import", `data:text/javascript,${encodeURIComponent(preload)}`,
    join(root, "scripts/indexnow.ts"), ...(options.args ?? ["--deployment", "--dry-run"]),
  ], {
    cwd: fixtureDir, encoding: "utf8",
    env: { ...process.env, VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main", GH_TOKEN: "mock-token",
      GITHUB_EVENT_NAME: "deployment_status", GITHUB_EVENT_PATH: eventFile,
      GITHUB_REPOSITORY: "The-Vibe-Company/skillpack", INDEXNOW_CALLS: callsFile,
      INDEXNOW_FIXTURES: fixturesFile, ...options.env },
  });
  return { output, calls: readFileSync(callsFile, "utf8") };
}

describe("IndexNow CLI guards and best-effort exit", () => {
  test.each([
    { state: "failure" }, { creator: "someone-else" }, { environment: "Preview" },
    { env: { GITHUB_EVENT_NAME: "push" } }, { sha: "invalid" },
    { sha: "f".repeat(40) }, { sha: "baseline" },
  ])("rejects invalid deployment context before any network request: %j", (options) => {
    const result = runCli(options);
    expect(result.calls).toBe("");
    expect(result.output).toMatch(/skipped|failed \(ignored\)/);
  });

  test("rejects a checkout mismatch even when the SHA belongs to main", () => {
    const result = runCli({ sha: baseline });
    expect(result.calls).toBe("");
    expect(result.output).toContain("Checkout does not match deployment");
  });

  test.each(["preview", "development", ""])('never submits from %s', (environment) => {
    const result = runCli({ args: ["--all"], env: { VERCEL_ENV: environment } });
    expect(result.calls).toBe("");
    expect(result.output).toContain("skipped (not production)");
  });

  test("dry-run reads sitemap but never proof or IndexNow endpoint", () => {
    const result = runCli({ args: ["--all", "--dry-run"], env: { VERCEL_ENV: "development" } });
    expect(result.output).toContain("selected 3 canonical URLs");
    expect(result.output).toContain("dry-run (no POST)");
    expect(result.calls.trim().split("\n")).toHaveLength(1);
    expect(result.calls).toContain("sitemap.xml");
    expect(result.calls).not.toContain(INDEXNOW_KEY);
  });

  test("deployment diffs all commits since previous production and intersects live sitemap", () => {
    const result = runCli();
    expect(result.output).toContain(`diff ${baseline}..${head} (2 files)`);
    expect(result.output).toContain("selected 2 canonical URLs");
    expect(result.output).toContain(`${INDEXNOW_ORIGIN}/blog/hello`);
    expect(result.output).not.toContain(`${INDEXNOW_ORIGIN}/privacy`);
    expect(result.calls).not.toContain('"method":"POST"');
  });

  test("configuration and sitemap failures exit successfully", () => {
    expect(runCli({ args: ["--wrong", "--dry-run"] }).output).toContain("failed (ignored)");
    expect(runCli({ args: ["--all", "--dry-run"], unavailableSitemap: true }).output).toContain("failed (ignored)");
  });

  test("workflow gates Vercel production successes and runs after main verification", () => {
    const workflow = parse(readFileSync(join(root, ".github/workflows/indexnow.yml"), "utf8"));
    expect(Object.keys(workflow.on)).toEqual(["deployment_status"]);
    expect(workflow.permissions).toEqual({ contents: "read", deployments: "read" });
    const job = workflow.jobs.submit;
    expect(job.if).toContain("deployment_status.state == 'success'");
    expect(job.if).toContain("deployment.environment == 'Production'");
    expect(job.if).toContain("deployment.creator.login == 'vercel[bot]'");
    expect(job["continue-on-error"]).toBe(true);
    const verify = job.steps.find((step: { id?: string }) => step.id === "main");
    expect(verify.run).toContain('git merge-base --is-ancestor "$DEPLOYED_SHA" origin/main');
    const submit = job.steps.at(-1);
    expect(submit.if).toBe("steps.main.outputs.verified == 'true'");
    expect(submit.env).toMatchObject({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" });
    expect(submit.run).toContain("scripts/indexnow.ts --deployment || true");
  });
});
