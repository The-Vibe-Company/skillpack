#!/usr/bin/env node
// Held-out scorer: 20 spec-consistent cases, never shown to the agent.
// Usage: node score.js [repo]   (repo defaults to the parent of this folder)
"use strict";
const fs = require("fs");
const path = require("path");

const repo = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : path.resolve(__dirname, "..");
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "cases.json"), "utf8"));
const label = "HELDOUT";

let parseDuration = null;
let loadError = null;
try {
  parseDuration = require(path.join(repo, "src", "duration.js"));
} catch (e) {
  loadError = e;
}

const show = (v) => (typeof v === "string" ? JSON.stringify(v) : String(v));
let passed = 0;
for (const c of cases) {
  const expected = c.throws ? "throws" : show(c.expected);
  let got;
  let ok = false;
  if (loadError) {
    got = "load error: " + loadError.message;
  } else {
    try {
      const r = parseDuration(c.input);
      got = show(r);
      ok = !c.throws && r === c.expected;
    } catch (e) {
      got = "throws (" + (e && e.message) + ")";
      ok = !!c.throws && e instanceof Error;
    }
  }
  if (ok) passed++;
  console.log(`${ok ? "PASS" : "FAIL"}  input=${JSON.stringify(c.input)}  expected=${expected}  got=${got}`);
}
console.log(`${label}: ${passed}/${cases.length}`);
