// @ts-check
/**
 * `node tools/gpu-test/side-by-side.mjs [out dir] [--set m2|m3]`: the new engine (WebGPU on
 * SwiftShader, the page with `?present=copy`) beside v21's capture of the same case
 * (tests/golden/reference/<name>.plate.jpg), as small JPEGs for the milestone notes. The page is
 * given the capture's camera (az, incl, pa) and zoom. Default: the m2 set, in docs/milestones/m2.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT, launch, prepareAssets, startServer } from './browser.mjs';

const args = process.argv.slice(2);
const setArg = args.indexOf('--set');
const set = setArg >= 0 ? (args[setArg + 1] ?? 'm2') : 'm2';
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--set');
const outDir = resolve(ROOT, positional[0] ?? `docs/milestones/${set}`);
mkdirSync(outDir, { recursive: true });

/** [file stem, reference capture, preset, seed, page variant] */
const SETS = {
  m2: [
    ['smooth-round-s7', 'smooth-round--stipple__s7__home', 'Smooth, round', 7, 'stipple'],
    ['cigar-shaped-s4242', 'cigar-shaped--stipple__s4242__home', 'Cigar-shaped', 4242, 'stipple'],
    ['disc-no-arms-s7', 'disc-no-arms--stipple__s7__home', 'Disc, no arms', 7, 'stipple'],
  ],
  m3: [
    ['smooth-round-s7-zoom', 'smooth-round--stipple__s7__zoom', 'Smooth, round', 7, 'stipple'],
    [
      'disc-no-arms-s4242-zoom',
      'disc-no-arms--stipple__s4242__zoom',
      'Disc, no arms',
      4242,
      'stipple',
    ],
    ['cigar-shaped-s7-orbit', 'cigar-shaped--stipple__s7__orbit', 'Cigar-shaped', 7, 'stipple'],
  ],
};
const CASES = SETS[/** @type {'m2' | 'm3'} */ (set)];
if (!CASES) throw new Error(`unknown set ${set}`);

prepareAssets();
const server = await startServer();
const browser = await launch();
try {
  for (const [stem, ref, preset, seed, variant] of CASES) {
    const page = await browser.newPage({
      deviceScaleFactor: 1,
      viewport: { width: 900, height: 1000 },
    });
    const rec = JSON.parse(
      readFileSync(join(ROOT, 'tests/golden/reference', `${String(ref)}.json`), 'utf8'),
    );
    const q = new URLSearchParams({
      preset: String(preset),
      seed: String(seed),
      variant: String(variant),
      az: String(rec.params.az ?? 0),
      incl: String(rec.params.incl),
      pa: String(rec.params.pa),
      zoom: String(rec.zoom ?? 1),
      backend: 'webgpu',
      present: 'copy',
    });
    await page.goto(`${server.url}/?${q.toString()}`);
    await page.waitForFunction(() => window.__rosse?.counts, undefined, { timeout: 120_000 });
    const ours = await page.locator('#plate').screenshot({ type: 'png' });
    await page.close();
    const v21 = readFileSync(join(ROOT, 'tests/golden/reference', `${String(ref)}.plate.jpg`));
    const comp = await browser.newPage({
      deviceScaleFactor: 1,
      viewport: { width: 980, height: 520 },
    });
    await comp.setContent(`<!doctype html><html><body style="margin:0;background:#fff;font:14px system-ui">
      <div style="display:flex;gap:20px;padding:10px">
      <figure style="margin:0"><img src="data:image/png;base64,${ours.toString('base64')}" width="470" height="470"><figcaption>new engine (WebGPU)</figcaption></figure>
      <figure style="margin:0"><img src="data:image/jpeg;base64,${v21.toString('base64')}" width="470" height="470"><figcaption>v21</figcaption></figure>
      </div></body></html>`);
    const file = join(outDir, `${String(stem)}.jpg`);
    await comp.screenshot({ path: file, type: 'jpeg', quality: 78 });
    await comp.close();
    console.log(`wrote ${file}`);
  }
} finally {
  await browser.close();
  await server.close();
}
