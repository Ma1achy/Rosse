// @ts-check
/**
 * Captures v21's SVG export (`exportSVG`, app23.js:L1155, through the page's `window.__EXPORT`)
 * for a few presets: the elements per layer (`counts`), the layers present and the size of the
 * file. Written to tests/vectors/svg-v21.json for tests/unit/svg.test.ts (milestone M12).
 *
 * The cases are the golden 'single' cases' overrides (starMix 0, field 0, fgstars 0: the sky and
 * the drawn stars are M7's), seed 7, the preset's own view.
 *
 * Usage: node tools/capture-reference/svg.mjs [--out tests/vectors/svg-v21.json]
 *        [--save-svgs dir]   also write each preset's SVG there
 * then: npx prettier --write tests/vectors/svg-v21.json
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
const PAGE = resolve(ROOT, 'assets/reference/pages/rosse-v21.html');
export const SVG_CASES = [
  'Grand design',
  'Flocculent',
  'Dusty spiral',
  'Smooth, round',
  'Edge-on with dust',
];
const OVERRIDES = { starMix: 0, field: 0, fgstars: 0 };
const SEED = 7;

const args = process.argv.slice(2);
const opt = (/** @type {string} */ k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const out = resolve(ROOT, opt('--out') ?? 'tests/vectors/svg-v21.json');
const saveDir = opt('--save-svgs');

const html = readFileSync(PAGE);
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
const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
await page.goto(url);
await page.addStyleTag({
  content: '#gl{width:800px!important;height:800px!important;max-width:none!important}',
});
await page.waitForFunction(() => /** @type {any} */ (window).__GEN?.stats().ms != null, null, {
  timeout: 120_000,
});

/** @type {any[]} */
const cases = [];
for (const preset of SVG_CASES) {
  const r = await page.evaluate(
    ({ preset, seed, overrides }) => {
      const w = /** @type {any} */ (window);
      w.__GEN.preset(preset);
      w.__GEN.set({ seed });
      w.__GEN.set(overrides);
      const e = w.__EXPORT();
      return { counts: e.counts, svg: e.svg, stats: w.__GEN.stats() };
    },
    { preset, seed: SEED, overrides: OVERRIDES },
  );
  if (saveDir) {
    mkdirSync(saveDir, { recursive: true });
    writeFileSync(
      join(saveDir, `v21-${preset.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.svg`),
      r.svg,
    );
  }
  cases.push({
    preset,
    seed: SEED,
    overrides: OVERRIDES,
    counts: r.counts,
    layers: Object.keys(r.counts).filter((k) => r.counts[k] > 0),
    svgBytes: r.svg.length,
    stats: r.stats,
  });
  console.log(preset, JSON.stringify(r.counts));
}
await browser.close();
server.close();
writeFileSync(
  out,
  JSON.stringify({
    about:
      "v21's exportSVG for five presets (tools/capture-reference/svg.mjs): the elements per layer, with the golden 'single' overrides at seed 7, the preset's own view.",
    cases,
  }),
);
