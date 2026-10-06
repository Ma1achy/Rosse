// scratch: ink budget of lanes and lines, v21 against ours
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';
const ROOT = new URL('..', import.meta.url).pathname;
const server = await createServer({ root: ROOT, configFile: ROOT + 'vite.config.ts', logLevel: 'warn', server: { middlewareMode: true, hmr: false } });
const N = await server.ssrLoadModule('/tests/golden/compare/node.ts');
const noise = await server.ssrLoadModule('/src/core/noise.ts');
const node = new N.GoldenNode(ROOT);
const sum = (a) => a.data.reduce((s, v) => s + v, 0);
for (const slug of ['grand-design', 'flocculent', 'tightly-wound']) for (const seed of [7, 4242]) {
  const row = [];
  for (const v of ['ribbons', 'nolanes', 'nolines']) {
    const dir = v === 'ribbons' ? 'tests/golden/reference/' : 'tmp-scratch/cap/';
    const name = `${slug}--${v}__s${seed}__home`;
    const rec = JSON.parse(readFileSync(ROOT + dir + name + '.json', 'utf8'));
    const ref = N.readPngAlpha(ROOT + dir + name + '.ink.png');
    noise.HACK.on = true; noise.HACK.seed = seed;
    const P = { ...rec.params };
    const r = node.renderCpu(P, { hand: rec.hand, ...node.referenceChoices(P) }, 1);
    row.push([sum(ref), sum(r.alpha)]);
  }
  const [a, b, c] = row;
  console.log(`${slug} s${seed}  total v21 ${a[0].toFixed(0)} ours ${a[1].toFixed(0)} | lanes v21 ${(a[0] - b[0]).toFixed(0)} ours ${(a[1] - b[1]).toFixed(0)} | lines v21 ${(b[0] - c[0]).toFixed(0)} ours ${(b[1] - c[1]).toFixed(0)} | stipple v21 ${c[0].toFixed(0)} ours ${c[1].toFixed(0)}`);
}
await server.close();
