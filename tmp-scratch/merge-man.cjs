const fs = require('fs');
const t = JSON.parse(fs.readFileSync('tmp-scratch/t-man.json'));
const o = JSON.parse(fs.readFileSync('tmp-scratch/o-man.json'));
const names = new Set(t.captures.map((c) => c.name));
const add = o.captures.filter((c) => !names.has(c.name));
console.log('theirs', t.captures.length, 'ours', o.captures.length, 'added', add.length);
const diff = o.captures
  .filter((c) => names.has(c.name))
  .filter((c) => JSON.stringify(c) !== JSON.stringify(t.captures.find((x) => x.name === c.name)));
console.log('differing common', diff.length, diff.slice(0, 3).map((c) => [c.name, JSON.stringify(c), JSON.stringify(t.captures.find((x) => x.name === c.name))]));
const out = { ...t, extra: { ...(t.extra || {}), ...(o.extra || {}) }, captures: [...t.captures, ...add].sort((a, b) => a.name.localeCompare(b.name)) };
fs.writeFileSync('tests/golden/reference/manifest.json', JSON.stringify(out, null, 2) + '\n');
console.log(Object.keys(out), JSON.stringify(out.extra).slice(0, 400), JSON.stringify(t.extra), JSON.stringify(o.extra));
