// @ts-check
/**
 * `node tools/gpu-test/side-by-side.mjs [out dir] [--set m2|m3|m4]`: the new engine (WebGPU on
 * SwiftShader, the page with `?present=copy`) beside v21's capture of the same case
 * (tests/golden/reference/<name>.plate.jpg), as small JPEGs for the milestone notes. The page is
 * given the capture's camera (az, incl, pa) and zoom. Default: the m2 set, in docs/milestones/m2.
 * The m4 set is drawn as the golden runner draws it (tests/golden/render.html), with v21's
 * variation, stroke choices and noise, so the two show the same galaxy; its ink is shown over the
 * plate's field colour.
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
  m4: [
    ['grand-design-s7', 'grand-design--ribbons__s7__home', 'Grand design', 7, 'ribbons'],
    [
      'tightly-wound-s4242-zoom',
      'tightly-wound--ribbons__s4242__zoom',
      'Tightly wound',
      4242,
      'ribbons',
    ],
    ['flocculent-s7-orbit', 'flocculent--ribbons__s7__orbit', 'Flocculent', 7, 'ribbons'],
  ],
};
const CASES = SETS[/** @type {'m2' | 'm3' | 'm4'} */ (set)];
if (!CASES) throw new Error(`unknown set ${set}`);

prepareAssets();
const server = await startServer();
/** @type {typeof import('../../tests/golden/compare/node.ts')} */
const G = await server.vite.ssrLoadModule('/tests/golden/compare/node.ts');
const node = new G.GoldenNode(ROOT);
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
    let ours;
    let label = 'new engine (WebGPU)';
    if (variant === 'ribbons') {
      // M4: the golden runner's draw, with v21's variation, stroke choices and noise (as the
      // comparison draws), the ink alpha shown over the plate's field colour
      const opts = node.referenceOptions(rec.params, rec.zoom ?? 1);
      await page.goto(`${server.url}/tests/golden/render.html`);
      await page.waitForFunction(() => window.__golden !== undefined, undefined, {
        timeout: 120_000,
      });
      const r = await page.evaluate(({ P, o, z }) => window.__golden?.render(P, o, z), {
        P: rec.params,
        o: opts,
        z: rec.zoom ?? 1,
      });
      if (!r) throw new Error('golden render failed');
      const png = await page.evaluate(
        ({ a, w, h }) => {
          const bytes = Uint8Array.from(atob(a), (c) => c.charCodeAt(0));
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const ctx = c.getContext('2d');
          if (!ctx) throw new Error('no 2d');
          const img = ctx.createImageData(w, h);
          const field = [230, 222, 206];
          const ink = [29, 27, 25];
          for (let i = 0; i < w * h; i++) {
            const t = (bytes[i] ?? 0) / 255;
            for (let k = 0; k < 3; k++)
              img.data[i * 4 + k] = Math.round((field[k] ?? 0) * (1 - t) + (ink[k] ?? 0) * t);
            img.data[i * 4 + 3] = 255;
          }
          ctx.putImageData(img, 0, 0);
          return c.toDataURL('image/png').split(',')[1] ?? '';
        },
        { a: r.alpha, w: r.width, h: r.height },
      );
      ours = Buffer.from(png, 'base64');
      label = "new engine (WebGPU), with v21's variation, strokes and noise";
    } else {
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
      ours = await page.locator('#plate').screenshot({ type: 'png' });
    }
    await page.close();
    const v21 = readFileSync(join(ROOT, 'tests/golden/reference', `${String(ref)}.plate.jpg`));
    const comp = await browser.newPage({
      deviceScaleFactor: 1,
      viewport: { width: 980, height: 520 },
    });
    await comp.setContent(`<!doctype html><html><body style="margin:0;background:#fff;font:14px system-ui">
      <div style="display:flex;gap:20px;padding:10px">
      <figure style="margin:0"><img src="data:image/png;base64,${ours.toString('base64')}" width="470" height="470"><figcaption>${label}</figcaption></figure>
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
