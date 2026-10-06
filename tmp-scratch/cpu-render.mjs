// scratch: render a reference case with the CPU engine and write [ours | v21] alpha PNGs (not committed)
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { createServer } from 'vite';
const ROOT = new URL('..', import.meta.url).pathname;
const server = await createServer({ root: ROOT, configFile: ROOT + 'vite.config.ts', logLevel: 'warn', server: { middlewareMode: true, hmr: false } });
const N = await server.ssrLoadModule('/tests/golden/compare/node.ts');
const node = new N.GoldenNode(ROOT);
const [refName, out, crop] = process.argv.slice(2);
const rec = node.record(refName);

const P = { ...rec.params };
const opts = node.referenceOptions(P);
const t0 = performance.now();
const r = node.renderCpu(P, opts, rec.zoom ?? 1);
console.log('ms', Math.round(performance.now() - t0), JSON.stringify(r.counts));
const ref = node.reference(refName);
const [cx, cy, cs] = crop ? crop.split(',').map(Number) : [0, 0, 800];
const Z = Number(process.env.Z || 1);
const png = new PNG({ width: cs * 2 * Z, height: cs * Z });
for (let y = 0; y < cs; y++) for (let x = 0; x < cs; x++) {
  const i = (y + cy) * 800 + x + cx;
  const a = r.alpha.data[i], b = ref.data[i];
  for (let j = 0; j < Z; j++) for (let k = 0; k < Z; k++) {
  let o = ((y * Z + j) * png.width + x * Z + k) * 4; png.data[o] = png.data[o + 1] = png.data[o + 2] = 255 - Math.round(a * 255); png.data[o + 3] = 255;
  o = ((y * Z + j) * png.width + (x + cs) * Z + k) * 4; png.data[o] = png.data[o + 1] = png.data[o + 2] = 255 - Math.round(b * 255); png.data[o + 3] = 255; }
}
writeFileSync(out, PNG.sync.write(png));
await server.close();
