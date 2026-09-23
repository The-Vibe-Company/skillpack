import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import test from "node:test";
import { prepareRelease, publishRelease, canPublish, TARGETS } from "./runtime-release.mjs";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "runtime-release-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sha = "a".repeat(40);
  for (const target of TARGETS) {
    const name = `skillpack-runtime_0.1.0_${target}${target.startsWith("windows") ? ".zip" : ".tar.gz"}`;
    const bytes = Buffer.from(target);
    writeFileSync(join(dir, name), bytes);
    writeFileSync(join(dir, `${target}.json`), JSON.stringify({ target, version: "0.1.0", sourceSha: sha, name, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), testedOS: target }));
  }
  const keys = generateKeyPairSync("ed25519");
  return { dir, sha, ...keys };
}

test("only canonical main push can sign or publish", () => {
  const valid = { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: "The-Vibe-Company/skillpack" };
  assert.equal(canPublish(valid), true);
  for (const override of [{ GITHUB_EVENT_NAME: "pull_request" }, { GITHUB_EVENT_NAME: "merge_group" }, { GITHUB_REF: "refs/heads/feature" }, { GITHUB_REPOSITORY: "fork/skillpack" }]) {
    assert.equal(canPublish({ ...valid, ...override }), false);
  }
});

test("manifest signs all six exact-SHA archives and rejects tampering or missing target", (t) => {
  const f = fixture(t);
  const bundle = prepareRelease({ ...f, version: "0.1.0" });
  assert.equal(bundle.files.size, 9);
  assert.ok(verify(null, bundle.files.get("manifest.json"), f.publicKey, Buffer.from(bundle.files.get("manifest.sig").toString().trim(), "base64")));
  writeFileSync(join(f.dir, "linux_arm64.json"), "{}");
  assert.throws(() => prepareRelease({ ...f, version: "0.1.0" }), /asset metadata/);
});

function remote() {
  const state = { tag: null, release: null, files: new Map(), published: 0, uploaded: 0, failAt: 3 };
  return { state,
    latestVersion: async () => null,
    getTag: async () => state.tag,
    createTag: async (_tag, sha) => { state.tag = sha; },
    getRelease: async () => state.release,
    createDraft: async () => { state.release = { id: 1, draft: true }; return state.release; },
    listAssets: async () => [...state.files.keys()],
    download: async (_release, name) => state.files.get(name),
    upload: async (_release, name, bytes) => {
      if (state.uploaded++ === state.failAt) throw new Error("connection lost");
      state.files.set(name, bytes);
    },
    publish: async () => { state.release.draft = false; state.published++; },
  };
}

test("interrupted upload remains draft; retry completes once without replacing assets", async (t) => {
  const f = fixture(t);
  const bundle = prepareRelease({ ...f, version: "0.1.0" });
  const api = remote();
  await assert.rejects(publishRelease(bundle, api), /connection lost/);
  assert.equal(api.state.release.draft, true);
  await publishRelease(bundle, api);
  assert.equal(api.state.files.size, 9);
  assert.equal(api.state.published, 1);
  const uploads = api.state.uploaded;
  await publishRelease(bundle, api);
  assert.equal(api.state.uploaded, uploads);
  assert.equal(api.state.published, 1);
  api.state.files.set("manifest.json", Buffer.from("tampered"));
  await assert.rejects(publishRelease(bundle, api), /immutable asset/);
});

test("different source SHA or a newer published runtime refuses publication", async (t) => {
  const bundle = prepareRelease({ ...fixture(t), version: "0.1.0" });
  const api = remote();
  api.state.tag = "b".repeat(40);
  await assert.rejects(publishRelease(bundle, api), /tag/);
  api.state.tag = null;
  api.latestVersion = async () => "0.2.0";
  await assert.rejects(publishRelease(bundle, api), /newer/);
});
