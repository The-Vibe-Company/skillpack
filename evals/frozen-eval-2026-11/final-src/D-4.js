module.exports = function parseDuration(input) {
  if (typeof input !== "string") throw new Error("invalid duration");
  const s = input.trim();
  if (!/^\d+[hms](\s*\d+[hms])*$/i.test(s)) throw new Error("invalid duration");
  const mult = { h: 3600, m: 60, s: 1 };
  const seen = new Set();
  let total = 0;
  for (const [, n, unit] of s.matchAll(/(\d+)([hms])/gi)) {
    const u = unit.toLowerCase();
    if (seen.has(u)) throw new Error("invalid duration");
    seen.add(u);
    total += parseInt(n, 10) * mult[u];
  }
  return total;
};
