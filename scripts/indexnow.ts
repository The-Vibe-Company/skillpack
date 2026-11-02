import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  isIndexNowProduction, previousProductionSha, readIndexNowSitemap, selectIndexNowUrls, submitIndexNow,
  type IndexNowDeployment,
} from "../apps/web/src/lib/indexnow.ts";

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", timeout: 10_000 }).trim();
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  if (!dryRun && !isIndexNowProduction(process.env)) {
    console.log("IndexNow: skipped (not production)");
    return;
  }
  if (args.some((arg) => !["--all", "--deployment", "--dry-run"].includes(arg)) ||
    args.includes("--all") === args.includes("--deployment")) throw new Error("Use --all or --deployment [--dry-run]");
  let changedFiles: string[] | null = null;
  if (args.includes("--deployment")) {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8"));
    const deployment: IndexNowDeployment = event.deployment;
    if (event.deployment_status?.state !== "success" || deployment.environment !== "Production" ||
      event.deployment?.creator?.login !== "vercel[bot]" ||
      process.env.GITHUB_EVENT_NAME !== "deployment_status") {
      console.log("IndexNow: skipped (not a successful production deployment)");
      return;
    }
    if (!/^[a-f0-9]{40}$/.test(deployment.sha)) throw new Error("Invalid deployment SHA");
    // Vercel uses a SHA as deployment.ref in this repository. Prove main ancestry.
    git("merge-base", "--is-ancestor", deployment.sha, "origin/main");
    if (git("rev-parse", "HEAD") !== deployment.sha) throw new Error("Checkout does not match deployment");
    const previous = await previousProductionSha(deployment);
    if (previous) {
      if (!/^[a-f0-9]{40}$/.test(previous)) throw new Error("Invalid previous deployment SHA");
      try {
        changedFiles = git("diff", "--name-only", "--no-renames", "-z", previous, deployment.sha)
          .split("\0").filter(Boolean);
        console.log(`IndexNow: diff ${previous}..${deployment.sha} (${changedFiles.length} files)`);
      } catch {
        console.log("IndexNow: baseline unavailable in Git; selecting all canonical URLs");
      }
    } else console.log("IndexNow: no previous production baseline; selecting all canonical URLs");
  }
  const entries = await readIndexNowSitemap();
  const urls = selectIndexNowUrls(entries, changedFiles);
  console.log(`IndexNow: selected ${urls.length} canonical URLs`);
  await submitIndexNow(urls, { dryRun });
}

// Deliberately resolve with exit 0 on API, sitemap, Git or configuration errors.
main().catch((error) => console.log(`IndexNow: failed (ignored): ${error instanceof Error ? error.message : String(error)}`));
