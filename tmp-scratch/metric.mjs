// scratch: metric for some reference cases on the CPU engine, with or without the v21-noise hack
import { createServer } from 'vite';
const ROOT = new URL('..', import.meta.url).pathname;
const server = await createServer({ root: ROOT, configFile: ROOT + 'vite.config.ts', logLevel: 'warn', server: { middlewareMode: true, hmr: false } });
const N = await server.ssrLoadModule('/tests/golden/compare/node.ts');
const noise = await server.ssrLoadModule('/src/core/noise.ts');
const node = new N.GoldenNode(ROOT);
const hack = process.argv[2] === 'hack';
for (const name of process.argv.slice(3)) {
  const rec = node.record(name);
  const P = { ...rec.params };
  noise.HACK.on = hack;
  noise.HACK.seed = P.seed;
  const opts = { hand: rec.hand, ...(rec.variant === 'ribbons' ? node.referenceChoices(P) : {}) };
  const r = node.renderCpu(P, opts, rec.zoom ?? 1);
  const c = N.compareMeasures(N.measure(node.reference(name)), N.measure(r.alpha));
  console.log(name.padEnd(42), hack ? 'v21noise' : 'own     ', (100 * c.inkRel).toFixed(1).padStart(6), c.ssim.toFixed(3), c.ssimCoarse.toFixed(3), (100 * c.medianRel).toFixed(1), (100 * c.p90Rel).toFixed(1), JSON.stringify([r.counts.dots, r.counts.knots, r.counts.stars]), JSON.stringify([rec.stats.dots, rec.stats.knots, rec.stats.stars]));
}
await server.close();
