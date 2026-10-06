import { createServer } from 'vite';
const ROOT = new URL('..', import.meta.url).pathname;
const server = await createServer({ root: ROOT, configFile: ROOT + 'vite.config.ts', logLevel: 'warn', server: { middlewareMode: true, hmr: false } });
const N = await server.ssrLoadModule('/tests/golden/compare/node.ts');
const node = new N.GoldenNode(ROOT);
for (const name of process.argv.slice(2)) {
  const rec = node.record(name);
  const P = { ...rec.params };
  const base = node.referenceOptions(P);
  const ring = (a) => {
    const out = new Float64Array(12);
    for (let y = 0; y < 800; y++) for (let x = 0; x < 800; x++) {
      const r = Math.hypot(x + 0.5 - 400, y + 0.5 - 400);
      out[Math.min(11, Math.floor(r / 50))] += a.data[y * 800 + x];
    }
    return out;
  };
  const v = ring(node.reference(name));
  const acc = new Float64Array(12);
  const K = 6;
  for (let k = 0; k < K; k++) {
    const r = node.renderCpu(P, { ...base, ...(k ? { placementKey: (P.seed + k * 7919000) >>> 0 } : {}) }, rec.zoom ?? 1);
    const o = ring(r.alpha);
    for (let i = 0; i < 12; i++) acc[i] += o[i] / K;
  }
  console.log(name, ' r/50px  v21   ours(mean)  ratio');
  for (let i = 0; i < 12; i++) console.log(i, v[i].toFixed(0).padStart(7), acc[i].toFixed(0).padStart(7), (acc[i] / v[i]).toFixed(3));
}
await server.close();
