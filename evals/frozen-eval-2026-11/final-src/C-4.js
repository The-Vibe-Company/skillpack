"use strict";
const MULT = { h: 3600, m: 60, s: 1 };

module.exports = function parseDuration(input) {
  if (typeof input !== "string") throw new Error("input must be a string");
  const s = input.trim();
  if (!s) throw new Error("empty duration");
  const re = /(\d+)([a-z])\s*/iy;
  const seen = new Set();
  let total = 0;
  let pos = 0;
  while (pos < s.length) {
    re.lastIndex = pos;
    const m = re.exec(s);
    if (!m) throw new Error("invalid duration: " + JSON.stringify(input));
    const unit = m[2].toLowerCase();
    if (!(unit in MULT)) throw new Error("unknown unit: " + m[2]);
    if (seen.has(unit)) throw new Error("repeated unit: " + unit);
    seen.add(unit);
    total += Number(m[1]) * MULT[unit];
    pos = re.lastIndex;
  }
  return total;
};
