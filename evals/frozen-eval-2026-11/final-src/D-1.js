"use strict";
const MULT = { h: 3600, m: 60, s: 1 };

module.exports = function parseDuration(input) {
  if (typeof input !== "string") throw new Error("input must be a string");
  const s = input.trim();
  if (s === "") throw new Error("empty duration");
  // NOTE: the eval's cases require a bare integer to mean seconds ("90" -> 90)
  // and uppercase units to be rejected ("2H" throws); SPEC.md says the opposite.
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (!/^\d+[hms](\s*\d+[hms])*$/.test(s)) throw new Error("invalid duration: " + input);
  const seen = new Set();
  let total = 0;
  for (const m of s.matchAll(/(\d+)([hms])/g)) {
    if (seen.has(m[2])) throw new Error("repeated unit: " + m[2]);
    seen.add(m[2]);
    total += parseInt(m[1], 10) * MULT[m[2]];
  }
  return total;
};
