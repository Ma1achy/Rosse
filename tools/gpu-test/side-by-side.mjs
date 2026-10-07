// @ts-check
/**
 * `node tools/gpu-test/side-by-side.mjs [out dir] [--set m2|m3|m4|m5|m7|m8]`: the new engine (WebGPU on
 * SwiftShader, the page with `?present=copy`) beside v21's capture of the same case
 * (tests/golden/reference/<name>.plate.jpg), as small JPEGs for the milestone notes. The page is
 * given the capture's camera (az, incl, pa) and zoom. Default: the m2 set, in docs/milestones/m2.
 * The m4 set is drawn as the golden runner draws it (tests/golden/render.html), with v21's
 * variation, stroke choices and noise, so the two show the same galaxy; its ink is shown over the
 * plate's field colour. The m5 set is drawn the same way, with v21's part picks too, and the m8 set
 * (mergers and the simulated shells) with v21's galaxy-level draws as well.
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
  // M6: the single-galaxy presets as the page draws them, plates and all (golden variant `single`,
  // or `vectors` where M5 captured the same overrides)
  m6: [
    ['plates-slipped-s7', 'plates-slipped--single__s7__home', 'Plates slipped', 7, 'single'],
    [
      'stellar-populations-s4242-orbit',
      'stellar-populations--single__s4242__orbit',
      'Stellar populations',
      4242,
      'single',
    ],
    [
      'grand-design-s7-chalkboard',
      'grand-design--single__s7__home__chalk',
      'Grand design',
      7,
      'single',
    ],
  ],
  // every single-galaxy preset at seed 7, home (a check by eye; `node … --set m6all`)
  m6all: [
    ...[
      ['Grand design', 'single'],
      ['Barred spiral', 'vectors'],
      ['Flocculent', 'single'],
      ['Hand-drawn arms', 'vectors'],
      ['Tightly wound', 'single'],
      ['Loose, open arms', 'single'],
      ['Ringed', 'vectors'],
      ['Disc, no arms', 'vectors'],
      ['Smooth, round', 'single'],
      ['Cigar-shaped', 'single'],
      ['Edge-on with dust', 'vectors'],
      ['Dusty spiral', 'single'],
      ['Hand wobble', 'single'],
      ['Radio jet', 'vectors'],
      ['Stellar streams', 'vectors'],
      ['Shell galaxy', 'vectors'],
      ['Plates slipped', 'single'],
      ['Stellar populations', 'single'],
    ].map(([preset, variant]) => {
      const slug = String(preset)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      return [`${slug}-s7`, `${slug}--${variant}__s7__home`, preset, 7, variant];
    }),
  ],
  m5: [
    ['hand-drawn-arms-s7', 'hand-drawn-arms--vectors__s7__home', 'Hand-drawn arms', 7, 'vectors'],
    [
      'barred-spiral-s4242-orbit',
      'barred-spiral--vectors__s4242__orbit',
      'Barred spiral',
      4242,
      'vectors',
    ],
    ['radio-jet-s7-zoom', 'radio-jet--vectors__s7__zoom', 'Radio jet', 7, 'vectors'],
  ],
  m7: [
    [
      'star-bright-s7',
      'star-bright-with-spikes--stars__s7__home',
      'Star: bright, with spikes',
      7,
      'stars',
    ],
    [
      'layered-spiral-star-s4242-orbit',
      'layered-spiral-beside-a-bright-star--layered__s4242__orbit',
      'Layered: spiral beside a bright star',
      4242,
      'layered',
    ],
    ['deep-field-s7', 'deep-field--sky__s7__home', 'Deep field', 7, 'sky'],
  ],
  m8: [
    ['the-mice-s7', 'merger-the-mice--mergers__s7__home', 'Merger: the Mice', 7, 'mergers'],
    [
      'sketches-torn-apart-s4242-zoom',
      'sketches-torn-apart--mergers__s4242__zoom',
      'Sketches, torn apart',
      4242,
      'mergers',
    ],
    ['shell-galaxy-s7', 'shell-galaxy--shells__s7__home', 'Shell galaxy', 7, 'mergers'],
  ],
};
const CASES = SETS[/** @type {'m2' | 'm3' | 'm4' | 'm5' | 'm6' | 'm6all' | 'm7' | 'm8'} */ (set)];
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
    if (variant === 'single') {
      // M6: the plates as the page shows them, on the capture's surface (v21's variation, stroke
      // choices, noise and part picks, as the comparison draws)
      const opts = node.referenceOptions(rec.params, rec.zoom ?? 1, rec.preset);
      await page.goto(`${server.url}/tests/golden/render.html`);
      await page.waitForFunction(() => window.__golden !== undefined, undefined, {
        timeout: 120_000,
      });
      const r = await page.evaluate(({ P, o, z, s }) => window.__golden?.plate(P, o, z, s), {
        P: rec.params,
        o: opts,
        z: rec.zoom ?? 1,
        s: rec.surface === 'chalkboard' ? 'chalk' : 'paper',
      });
      if (!r) throw new Error('golden plate failed');
      const png = await page.evaluate(
        ({ a, w, h }) => {
          const bytes = Uint8ClampedArray.from(atob(a), (c) => c.charCodeAt(0));
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const ctx = c.getContext('2d');
          if (!ctx) throw new Error('no 2d');
          ctx.putImageData(new ImageData(bytes, w, h), 0, 0);
          return c.toDataURL('image/png').split(',')[1] ?? '';
        },
        { a: r.rgba, w: r.width, h: r.height },
      );
      ours = Buffer.from(png, 'base64');
      label = "new engine (WebGPU), with v21's variation, strokes, noise and part picks";
    } else if (
      ['ribbons', 'vectors', 'stars', 'layered', 'sky', 'mergers'].includes(String(variant))
    ) {
      // M4, M5: the golden runner's draw, with v21's variation, stroke choices, noise and part
      // picks (as the comparison draws), the ink alpha shown over the plate's field colour
      const opts = node.referenceOptions(rec.params, rec.zoom ?? 1, rec.preset);
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
      label =
        variant === 'mergers'
          ? "new engine (WebGPU), with v21's galaxy-level draws, variations, strokes, noise and part picks"
          : variant === 'vectors'
            ? "new engine (WebGPU), with v21's variation, strokes, noise and part picks"
            : "new engine (WebGPU), with v21's variation, strokes and noise";
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
