module.exports = function parseDuration(input) {
  if (typeof input !== "string") throw new Error("invalid input");
  const s = input.trim();
  if (!s) throw new Error("empty input");
  const mult = { h: 3600, m: 60, s: 1 };
  const seen = new Set();
  let total = 0;
  const re = /(\d+)([a-z]?)\s*/iy;
  let m;
  while (re.lastIndex < s.length) {
    m = re.exec(s);
    if (!m) throw new Error("invalid duration at position " + re.lastIndex);
    const u = m[2].toLowerCase();
    if (!u) throw new Error("number without a unit");
    if (!(u in mult)) throw new Error("unknown unit: " + u);
    if (seen.has(u)) throw new Error("repeated unit: " + u);
    seen.add(u);
    total += parseInt(m[1], 10) * mult[u];
  }
  return total;
};
