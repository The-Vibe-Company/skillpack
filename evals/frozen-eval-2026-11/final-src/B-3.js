module.exports = function parseDuration(input) {
  if (typeof input !== "string") throw new Error("input must be a string");
  const s = input.trim();
  if (s === "") throw new Error("empty duration");
  const mult = { h: 3600, m: 60, s: 1 };
  const seen = new Set();
  let total = 0;
  const re = /(\d+)([a-z]?)\s*/iy;
  let pos = 0;
  while (pos < s.length) {
    re.lastIndex = pos;
    const m = re.exec(s);
    if (!m) throw new Error("invalid duration: " + input);
    const unit = m[2].toLowerCase();
    if (!unit || !(unit in mult)) throw new Error("invalid unit in: " + input);
    if (seen.has(unit)) throw new Error("repeated unit: " + unit);
    seen.add(unit);
    total += Number(m[1]) * mult[unit];
    pos = re.lastIndex;
  }
  return total;
};
