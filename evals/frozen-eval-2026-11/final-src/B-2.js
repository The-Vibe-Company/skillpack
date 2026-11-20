module.exports = function parseDuration(input) {
  if (typeof input !== "string") throw new Error("invalid duration");
  const s = input.trim();
  if (!s || !/^\d+[hms](\s+\d+[hms])*$/i.test(s.replace(/(?<=[hms])(?=\d)/gi, " "))) {
    throw new Error("invalid duration");
  }
  const mult = { h: 3600, m: 60, s: 1 };
  const seen = new Set();
  let total = 0;
  for (const [, n, u] of s.matchAll(/(\d+)([hms])/gi)) {
    const k = u.toLowerCase();
    if (seen.has(k)) throw new Error("repeated unit");
    seen.add(k);
    total += Number(n) * mult[k];
  }
  return total;
};
