import { createServer } from 'vite';
const ROOT = new URL('..', import.meta.url).pathname;
const server = await createServer({ root: ROOT, configFile: ROOT + 'vite.config.ts', logLevel: 'warn', server: { middlewareMode: true, hmr: false } });
const N = await server.ssrLoadModule('/tests/golden/compare/node.ts');
const node = new N.GoldenNode(ROOT);
const name = process.argv[2];
const rec = node.record(name);
const P = { ...rec.params };
const base = node.referenceOptions(P);
const ref = N.measure(node.reference(name));
console.log('v21', ref.extent.r25, ref.extent.r50, ref.extent.r90);
for (let k = 0; k < 10; k++) {
  const r = node.renderCpu(P, { ...base, ...(k ? { placementKey: (P.seed + k * 7919000) >>> 0 } : {}) }, rec.zoom ?? 1);
  const m = N.measure(r.alpha);
  const c = N.compareMeasures(ref, m);
  console.log(k, m.extent.r25.toFixed(1), m.extent.r50.toFixed(1), m.extent.r90.toFixed(1), (100 * c.r50Rel).toFixed(1), (100 * c.r25Rel).toFixed(1), JSON.stringify([r.counts.knots, r.counts.stars]));
}
await server.close();
