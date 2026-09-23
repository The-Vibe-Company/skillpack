import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  normalizeOpenCodeEvent,
  runRuntime,
} from "./opencode-runtime.mjs";

test("normalizes chat.message without carrying prompt data", () => {
  const envelope = normalizeOpenCodeEvent({ sessionID: "ses-1", messageID: "msg-1" });
  assert.deepEqual(envelope, {
    hook_event_name: "SessionStart",
    session_id: "ses-1",
  });
  assert.equal(JSON.stringify(envelope).includes("messageID"), false);
});

test("normalizes only a successful structured Skill result", () => {
  const envelope = normalizeOpenCodeEvent(
    {
      tool: "skill",
      sessionID: "ses-2",
      callID: "call-2",
      args: { name: "prompt-shaped-value" },
    },
    {
      title: "ignored title",
      output: "ignored tool output",
      metadata: {
        name: "runtime-proof",
        dir: "/registered/runtime-proof",
        truncated: false,
      },
    },
  );
  assert.deepEqual(envelope, {
    hook_event_name: "PostToolUse",
    session_id: "ses-2",
    tool_name: "Skill",
    tool_use_id: "call-2",
    tool_input: { skill: "/registered/runtime-proof" },
    tool_response: { success: true, commandName: "runtime-proof" },
  });
  assert.equal(JSON.stringify(envelope).includes("prompt-shaped-value"), false);
  assert.equal(JSON.stringify(envelope).includes("ignored tool output"), false);
});

test("ignores errors, unknown tools, text-only output, and malformed metadata", () => {
  assert.equal(normalizeOpenCodeEvent({ sessionID: "ses-3", tool: "shell" }, { metadata: { dir: "/x" } }), null);
  assert.equal(normalizeOpenCodeEvent({ sessionID: "ses-3", tool: "skill" }, { error: "failed", metadata: { dir: "/x" } }), null);
  assert.equal(normalizeOpenCodeEvent({ sessionID: "ses-3", tool: "skill" }, { output: "skill", title: "skill" }), null);
  assert.equal(normalizeOpenCodeEvent({ sessionID: "ses-3", tool: "skill" }, { metadata: { name: "example" } }), null);
  assert.equal(normalizeOpenCodeEvent({ sessionID: "ses-3", tool: "skill" }, { metadata: { name: "example", dir: "/x" } }), null);
  assert.equal(normalizeOpenCodeEvent({ sessionID: "ses-3", tool: "skill" }, { metadata: { name: 42, dir: null } }), null);
});

test("does not invoke an absent or invalid active runtime", () => {
  const calls = [];
  const result = runRuntime({ hook_event_name: "SessionStart", session_id: "ses-4" }, {
    stateDir: "/path/that/does/not/exist",
    spawn: (...args) => calls.push(args),
  });
  assert.equal(result, false);
  assert.deepEqual(calls, []);
});

test("uses direct argv execution with a bounded timeout", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "skillpack-opencode-"));
  try {
    const binary = join(stateDir, "versions", "0.1.0", process.platform === "win32" ? "skillpack-runtime.exe" : "skillpack-runtime");
    mkdirSync(join(stateDir, "versions", "0.1.0"), { recursive: true });
    const bytes = Buffer.from("runtime test binary");
    writeFileSync(binary, bytes);
    writeFileSync(join(stateDir, "active.json"), JSON.stringify({
      version: "0.1.0",
      binary: binary.slice(stateDir.length + 1),
      binarySha256: createHash("sha256").update(bytes).digest("hex"),
    }));
    const calls = [];
    const result = runRuntime({ hook_event_name: "SessionStart", session_id: "ses-5" }, {
      stateDir,
      spawn: (...args) => calls.push(args),
    });
    assert.equal(result, true);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0][1], ["--state-dir", realpathSync(stateDir), "hook", "--agent", "opencode"]);
    assert.equal(calls[0][2].shell, false);
    assert.equal(calls[0][2].timeout, 2000);
    assert.equal(calls[0][2].input.includes("ses-5"), true);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("rejects an active runtime whose digest or containment is invalid", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "skillpack-opencode-invalid-"));
  try {
    mkdirSync(join(stateDir, "versions"), { recursive: true });
    writeFileSync(join(stateDir, "outside-runtime"), "outside");
    writeFileSync(join(stateDir, "active.json"), JSON.stringify({
      version: "0.1.0",
      binary: "../outside-runtime",
      binarySha256: "0".repeat(64),
    }));
    const calls = [];
    const result = runRuntime({ hook_event_name: "SessionStart", session_id: "ses-6" }, {
      stateDir,
      spawn: (...args) => calls.push(args),
    });
    assert.equal(result, false);
    assert.deepEqual(calls, []);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("does not invoke the runtime with an invalid active runtime", () => {
  const calls = [];
  const result = runRuntime({ hook_event_name: "SessionStart", session_id: "ses-5" }, {
    stateDir: "/path/that/does/not/exist",
    spawn: (...args) => calls.push(args),
  });
  assert.equal(result, false);
  assert.deepEqual(calls, []);
});
