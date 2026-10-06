// scratch: engine re-key pairs (same structure, other dots) for some cases
import { createServer } from 'vite';
const ROOT = new URL('..', import.meta.url).pathname;
const server = await createServer({ root: ROOT, configFile: ROOT + 'vite.config.ts', logLevel: 'warn', server: { middlewareMode: true, hmr: false } });
const N = await server.ssrLoadModule('/tests/golden/compare/node.ts');
const node = new N.GoldenNode(ROOT);
const out = [];
for (const name of process.argv.slice(2)) {
  const rec = node.record(name);
  const P = { ...rec.params };
  const base = node.referenceOptions(P);
  const m0 = N.measure(node.renderCpu(P, base, rec.zoom ?? 1).alpha);
  const row = [];
  for (let k = 1; k <= 4; k++) {
    const r = node.renderCpu(P, { ...base, placementKey: (P.seed + k * 7919000) >>> 0 }, rec.zoom ?? 1);
    const c = N.compareMeasures(m0, N.measure(r.alpha));
    row.push(c.ssimCoarse.toFixed(3) + '/' + (100*c.r50Rel).toFixed(1)+'/'+(100*c.r25Rel).toFixed(1));
    out.push(c);
  }
  console.log(name.padEnd(42), row.join(' '));
}
const s = (xs) => { const a = xs.slice().sort((x, y) => x - y); return [a[Math.floor(0.05 * (a.length - 1))], a[Math.floor(a.length / 2)]].map((v) => v.toFixed(3)).join(' / '); };
console.log('coarse p5/median', s(out.map((c) => c.ssimCoarse)), ' ssim p5/median', s(out.map((c) => c.ssim)));
await server.close();
