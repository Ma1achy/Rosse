// @ts-check
/**
 * Captures v21's plates as ink images with the draw calls that made them (M6's plates test,
 * tests/unit/plates.test.ts and tests/gpu/plates.ts).
 *
 *   node tools/capture-reference/plates.mjs [--out tests/golden/plates]
 *
 * For each case, the v21 page is served from memory with `drawSprites` and `drawRibbons` wrapped
 * (as tools/profile-reference does; the page itself is not changed on disk): every call's atlas,
 * instance rows, ink, offset and gain are recorded, then the canvas is read back, premultiplied
 * and 800 × 800, as the golden captures are. A case is a few hundred stars with the line work
 * switched off, so every pass is sprites only and the engine can draw the same rows. The tool
 * refuses a case in which v21 draws a ribbon.
 *
 * Written per case: `<name>.json` (parameters, theme, the calls) and `<name>.ink.png`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
/** @type {typeof import('playwright')} */
const { chromium } = (() => {
  try {
    return require('playwright');
  } catch {
    return require(require.resolve('playwright', { paths: ['/opt/node22/lib/node_modules'] }));
  }
})();

const ROOT = resolve(import.meta.dirname, '../..');
const PAGE = join(ROOT, 'assets/reference/pages/rosse-v21.html');
const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const out = resolve(ROOT, outArg >= 0 ? (args[outArg + 1] ?? '') : 'tests/golden/plates');

/**
 * The cases: the two plates presets on both surfaces, with what v21 draws as ribbons or vector
 * lines switched off (lines, bubbles, dust lanes, the drawn core's nuclear spiral is already off).
 */
const LINES_OFF = {
  stars: 900,
  lines: 0,
  bubbles: 0,
  dustScribble: 0,
  starMix: 0,
  field: 0,
  fgstars: 0,
  sparkle: 0.7,
  knots: 0.6,
};
export const CASES = [
  { name: 'slip-paper', preset: 'Plates slipped', theme: 'light', seed: 7, overrides: LINES_OFF },
  { name: 'slip-chalk', preset: 'Plates slipped', theme: 'dark', seed: 4242, overrides: LINES_OFF },
  {
    name: 'colour-paper',
    preset: 'Stellar populations',
    theme: 'light',
    seed: 7,
    overrides: LINES_OFF,
  },
  {
    name: 'colour-chalk',
    preset: 'Stellar populations',
    theme: 'dark',
    seed: 4242,
    overrides: LINES_OFF,
  },
];

/** The page with `drawSprites` and `drawRibbons` recording their calls into `window.__calls`. */
function patched() {
  let html = readFileSync(PAGE, 'utf8');
  for (const n of ['drawSprites', 'drawRibbons']) {
    const needle = `function ${n}(`;
    if (html.split(needle).length - 1 !== 1) throw new Error(`expected one "${needle}"`);
    html = html.replace(needle, `function ${n}__raw(`);
  }
  const hook = `
function drawSprites(atlas, rows, ink, off, gain) {
  var c = window.__calls; if (c && rows.length) {
    var g = function (x) { return Number(Math.fround(x).toPrecision(9)); };
    c.push({ kind: 'sprites', atlas: atlas, ink: Array.prototype.map.call(ink, g), off: [off[0], off[1]], gain: g(gain),
      rows: rows.map(function (r) { return Array.prototype.map.call(r, g); }) });
  }
  return drawSprites__raw(atlas, rows, ink, off, gain);
}
function drawRibbons(V, ink, off, gain, texName) {
  var c = window.__calls; if (c && V.length) c.push({ kind: 'ribbons', vertices: V.length / 5 });
  return drawRibbons__raw(V, ink, off, gain, texName);
}
`;
  const anchor = 'window.__GEN = {';
  if (html.split(anchor).length - 1 !== 1) throw new Error('could not find the __GEN hook');
  return html.replace(anchor, hook + anchor);
}

const html = patched();
const server = createServer((_req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(html);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(undefined)));
const addr = server.address();
const url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/`;
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
mkdirSync(out, { recursive: true });
try {
  for (const c of CASES) {
    const context = await browser.newContext({
      viewport: { width: 1400, height: 1100 },
      deviceScaleFactor: 1,
      colorScheme: 'light',
    });
    await context.addInitScript((theme) => {
      try {
        localStorage.setItem('foundry-theme', theme);
      } catch {
        /* storage unavailable: the page defaults to light */
      }
    }, c.theme);
    const page = await context.newPage();
    await page.route('**/*', (route) => {
      const u = route.request().url();
      if (u.startsWith(url) || u.startsWith('data:')) void route.continue();
      else void route.abort();
    });
    await page.goto(url);
    await page.addStyleTag({
      content: '#gl{width:800px!important;height:800px!important;max-width:none!important}',
    });
    await page.waitForFunction(
      () => {
        const cv = /** @type {HTMLCanvasElement | null} */ (document.getElementById('gl'));
        const g = /** @type {any} */ (window).__GEN;
        return !!cv && cv.width === 800 && !!g && g.stats().ms != null;
      },
      null,
      { timeout: 120_000 },
    );
    const state = await page.evaluate(
      ({ preset, seed, overrides }) => {
        const G = /** @type {any} */ (window).__GEN;
        G.preset(preset);
        G.set({ seed });
        /** @type {any} */ (window).__calls = [];
        G.set(overrides);
        const calls = /** @type {any} */ (window).__calls;
        /** @type {any} */ (window).__calls = null;
        const cv = /** @type {HTMLCanvasElement} */ (document.getElementById('gl'));
        return {
          P: JSON.parse(JSON.stringify(G.P())),
          calls,
          size: cv.width,
          ink: cv.toDataURL('image/png'),
        };
      },
      { preset: c.preset, seed: c.seed, overrides: c.overrides },
    );
    if (state.calls.some((/** @type {any} */ x) => x.kind === 'ribbons'))
      throw new Error(`${c.name}: v21 drew ribbons; switch more line work off`);
    writeFileSync(
      join(out, `${c.name}.ink.png`),
      Buffer.from(state.ink.split(',')[1] ?? '', 'base64'),
    );
    writeFileSync(
      join(out, `${c.name}.json`),
      JSON.stringify({
        name: c.name,
        preset: c.preset,
        theme: c.theme,
        seed: c.seed,
        plates: state.P.plates,
        params: state.P,
        size: state.size,
        calls: state.calls,
      }) + '\n',
    );
    console.log(`${c.name}: ${state.calls.length} draw calls`);
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
