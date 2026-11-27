"use strict";
const MULT = { h: 3600, m: 60, s: 1 };

module.exports = function parseDuration(input) {
  if (typeof input !== "string") throw new Error("input must be a string");
  const str = input.trim();
  if (!str) throw new Error("empty duration");
  const re = /(\d+)([a-zA-Z]*)\s*/y;
  const seen = new Set();
  let total = 0;
  let pos = 0;
  while (pos < str.length) {
    re.lastIndex = pos;
    const m = re.exec(str);
    if (!m) throw new Error("invalid duration: " + input);
    const unit = m[2].toLowerCase();
    if (!(unit in MULT)) throw new Error("invalid or missing unit: " + input);
    if (seen.has(unit)) throw new Error("repeated unit: " + unit);
    seen.add(unit);
    total += Number(m[1]) * MULT[unit];
    pos = re.lastIndex;
  }
  return total;
};
