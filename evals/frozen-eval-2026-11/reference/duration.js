module.exports = function (input) {
  if (typeof input !== "string") throw new Error("bad");
  const s = input.trim(); if (!s) throw new Error("empty");
  const re = /(\d+)([hms])\s*/giy; let i = 0, seen = {}, t = 0, m;
  while (i < s.length) { re.lastIndex = i; m = re.exec(s); if (!m) throw new Error("bad");
    const u = m[2].toLowerCase(); if (seen[u]) throw new Error("rep"); seen[u] = 1;
    t += Number(m[1]) * { h: 3600, m: 60, s: 1 }[u]; i = re.lastIndex; }
  return t;
};
