#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REPOSITORY = "The-Vibe-Company/skillpack";
export const TARGETS = ["darwin_amd64", "darwin_arm64", "linux_amd64", "linux_arm64", "windows_amd64", "windows_arm64"];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const compare = (a, b) => {
  const right = b.split(".").map(Number);
  for (const [i, part] of a.split(".").map(Number).entries()) if (part !== right[i]) return part - right[i];
  return 0;
};
export function canPublish(env) {
  return env.GITHUB_EVENT_NAME === "push" && env.GITHUB_REF === "refs/heads/main" && env.GITHUB_REPOSITORY === REPOSITORY;
}

function replaceInstallerMarker(source, marker, value, name) {
  const occurrences = source.split(marker).length - 1;
  if (occurrences !== 1) throw new Error(`${name} must contain exactly one ${marker} marker`);
  return source.replace(marker, value);
}

function parseInstallerTemplates(value) {
  if (value === null || Object.prototype.toString.call(value) !== "[object Object]") {
    throw new Error("both native installer templates are required");
  }
  const { shell, powershell } = value;
  if (Object.prototype.toString.call(shell) !== "[object String]" || Object.prototype.toString.call(powershell) !== "[object String]") {
    throw new Error("both native installer templates are required");
  }
  return { shell, powershell };
}

export function renderInstallerTemplates({ version, hashes, shell, powershell }) {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) throw new Error("invalid installer version");
  for (const target of TARGETS) {
    if (!/^[a-f0-9]{64}$/.test(hashes[target] ?? "")) throw new Error(`invalid installer checksum for ${target}`);
  }
  const shellCases = TARGETS.map((target) => `    ${target}) printf '%s\\n' '${hashes[target]}' ;;`).join("\n");
  const powershellCases = TARGETS.map((target) => `    "${target}" { return "${hashes[target]}" }`).join("\n");
  return {
    shell: replaceInstallerMarker(
      replaceInstallerMarker(shell, "__SKILLPACK_RELEASE_VERSION__", version, "shell installer"),
      "    # __SKILLPACK_PINNED_HASH_CASES__",
      shellCases,
      "shell installer",
    ),
    powershell: replaceInstallerMarker(
      replaceInstallerMarker(powershell, "__SKILLPACK_RELEASE_VERSION__", version, "PowerShell installer"),
      "    # __SKILLPACK_PINNED_HASH_SWITCH__",
      powershellCases,
      "PowerShell installer",
    ),
  };
}

export function prepareRelease({ dir, version, sha, privateKey, publicKey, installerTemplates }) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[a-f0-9]{40}$/.test(sha)) throw new Error("invalid release identity");
  const tag = `runtime-v${version}`;
  const base = `https://github.com/${REPOSITORY}/releases/download/${tag}`;
  const files = new Map();
  const assets = TARGETS.map((target) => {
    const record = JSON.parse(readFileSync(join(dir, `${target}.json`), "utf8"));
    const name = `skillpack-runtime_${version}_${target}${target.startsWith("windows_") ? ".zip" : ".tar.gz"}`;
    if (record.target !== target || record.version !== version || record.sourceSha !== sha || record.name !== name) throw new Error(`invalid asset metadata for ${target}`);
    const bytes = readFileSync(join(dir, name));
    if (bytes.length !== record.size || digest(bytes) !== record.sha256) throw new Error(`invalid asset digest for ${target}`);
    files.set(name, bytes);
    return { target, name, url: `${base}/${name}`, size: bytes.length, sha256: record.sha256, testedOS: record.testedOS };
  });
  if (installerTemplates) {
    const templates = parseInstallerTemplates(installerTemplates);
    const hashes = Object.fromEntries(assets.map((asset) => [asset.target, asset.sha256]));
    const rendered = renderInstallerTemplates({ version, hashes, ...templates });
    files.set("install.sh", Buffer.from(rendered.shell));
    files.set("install.ps1", Buffer.from(rendered.powershell));
  }
  const manifest = Buffer.from(JSON.stringify({ schemaVersion: 1, protocolVersion: 1, setupVersion: 1, version, sourceSha: sha, assets }, null, 2) + "\n");
  const signature = sign(null, manifest, privateKey);
  if (!verify(null, manifest, publicKey, signature)) throw new Error("CI signing key does not match pinned installer key");
  files.set("manifest.json", manifest);
  files.set("manifest.sig", Buffer.from(signature.toString("base64") + "\n"));
  files.set("SHA256SUMS", Buffer.from([...files].map(([name, bytes]) => `${digest(bytes)}  ${name}\n`).join("")));
  return { tag, version, sha, files, base };
}

export async function publishRelease(bundle, api) {
  const newest = await api.latestVersion();
  if (newest && compare(newest, bundle.version) > 0) throw new Error("a newer runtime is already published");
  const existingTag = await api.getTag(bundle.tag);
  if (existingTag && existingTag !== bundle.sha) throw new Error("immutable release tag points at another source SHA");
  if (!existingTag) await api.createTag(bundle.tag, bundle.sha);
  let release = await api.getRelease(bundle.tag);
  if (!release) release = await api.createDraft(bundle.tag, bundle.sha);
  const present = await api.listAssets(release);
  if (present.some((name) => !bundle.files.has(name))) throw new Error("unexpected asset in runtime release");
  for (const [name, bytes] of bundle.files) {
    if (present.includes(name)) {
      if (!bytes.equals(await api.download(release, name))) throw new Error(`immutable asset differs: ${name}`);
    } else {
      if (!release.draft) throw new Error("published runtime release is incomplete");
      await api.upload(release, name, bytes);
    }
  }
  const complete = await api.listAssets(release);
  if (complete.length !== bundle.files.size || complete.some((name) => !bundle.files.has(name))) throw new Error("release inventory is incomplete");
  // Verify every uploaded byte before exposing the release to anonymous installers.
  for (const [name, bytes] of bundle.files) {
    if (!bytes.equals(await api.download(release, name))) throw new Error(`uploaded asset differs: ${name}`);
  }
  if (release.draft) await api.publish(release);
}

class GitHubReleases {
  constructor() { this.prefix = `repos/${REPOSITORY}`; }
  request(endpoint, args = [], optional = false) {
    try {
      const raw = execFileSync("gh", ["api", `${this.prefix}/${endpoint}`, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 4 * 1024 * 1024 });
      return JSON.parse(raw);
    } catch (error) {
      if (optional && String(error.stderr).includes("HTTP 404")) return null;
      throw new Error(`GitHub runtime release operation failed: ${endpoint}`);
    }
  }
  async latestVersion() {
    const versions = [];
    for (let page = 1; ; page++) {
      const releases = this.request(`releases?per_page=100&page=${page}`);
      for (const release of releases) if (!release.draft && /^runtime-v\d+\.\d+\.\d+$/.test(release.tag_name)) versions.push(release.tag_name.slice(9));
      if (releases.length < 100) break;
    }
    return versions.sort(compare).at(-1) ?? null;
  }
  async getTag(tag) { return this.request(`git/ref/tags/${tag}`, [], true)?.object?.sha ?? null; }
  async createTag(tag, sha) { this.request("git/refs", ["-f", `ref=refs/tags/${tag}`, "-f", `sha=${sha}`]); }
  async getRelease(tag) { return this.request(`releases/tags/${tag}`, [], true); }
  async createDraft(tag, sha) {
    return this.request("releases", ["-f", `tag_name=${tag}`, "-f", `target_commitish=${sha}`, "-f", `name=Skillpack runtime ${tag.slice(9)}`, "-F", "draft=true", "-f", "make_latest=false", "-f", "body=Portable usage collector. Install through Skillpack; the installer verifies the signed manifest and archive digest. See docs/skillpack-runtime.md for setup, privacy, and diagnostics."]);
  }
  async assets(release) { return this.request(`releases/${release.id}/assets?per_page=100`); }
  async listAssets(release) { return (await this.assets(release)).map((asset) => asset.name); }
  async download(release, name) {
    const asset = (await this.assets(release)).find((row) => row.name === name);
    if (!asset) throw new Error("release asset disappeared");
    return execFileSync("gh", ["api", `${this.prefix}/releases/assets/${asset.id}`, "-H", "Accept: application/octet-stream"], { maxBuffer: 150 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  }
  async upload(release, name, bytes) {
    const directory = mkdtempSync(join(tmpdir(), "skillpack-release-"));
    try {
      const path = join(directory, name);
      writeFileSync(path, bytes);
      execFileSync("gh", ["release", "upload", release.tag_name, path, "--repo", REPOSITORY], { stdio: ["ignore", "pipe", "pipe"] });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
  async publish(release) { this.request(`releases/${release.id}`, ["--method", "PATCH", "-F", "draft=false", "-f", "make_latest=false"]); }
}

async function main() {
  if (!canPublish(process.env)) throw new Error("runtime publication requires a canonical main push");
  const config = JSON.parse(readFileSync("packages/skillpack-skill/skill/runtime-release.json", "utf8"));
  const bundle = prepareRelease({
    dir: resolve(".context/runtime-dist"),
    version: readFileSync("runtime/VERSION", "utf8").trim(),
    sha: process.env.GITHUB_SHA,
    privateKey: createPrivateKey(process.env.SKILLPACK_RUNTIME_SIGNING_KEY ?? ""),
    publicKey: createPublicKey(config.publicKey),
    installerTemplates: {
      shell: readFileSync("runtime/install.sh", "utf8"),
      powershell: readFileSync("runtime/install.ps1", "utf8"),
    },
  });
  await publishRelease(bundle, new GitHubReleases());
  // No token: prove installers can fetch public bytes without GitHub credentials.
  for (const [name, bytes] of bundle.files) {
    let matched = false;
    for (let attempt = 0; attempt < 6 && !matched; attempt++) {
      const response = await fetch(`${bundle.base}/${name}`, { signal: AbortSignal.timeout(30_000) });
      matched = response.ok && digest(Buffer.from(await response.arrayBuffer())) === digest(bytes);
      if (!matched) await new Promise((done) => setTimeout(done, 5_000));
    }
    if (!matched) throw new Error(`anonymous download verification failed: ${name}`);
  }
  console.log(`Published and verified ${bundle.tag}: six native archives, signed manifest, and native installers.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error("Runtime release failed. Inspect the immutable draft/assets and configuration before retrying; existing published assets were not replaced."); process.exitCode = 1; });
}
