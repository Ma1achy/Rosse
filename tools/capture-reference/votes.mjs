// @ts-check
/**
 * Captures v21's `fromVotes` outputs, for tests/unit/from-votes.test.ts (milestone M12).
 *
 * v21 keeps `fromVotes`, `fromReal`, `describe` and `shortType` inside the page's closure. This
 * serves a copy of the reference page with ONE line added after its `window.__EXPORT` hook, which
 * hands those functions (and `DEF`, `REAL`, `TYPES`, `catVotes`, `catExtra`, `loadCat`; the ones
 * defined later in the file as getters) to the test through `window.__FV`. Nothing else is touched: the functions are v21's own, run in
 * Chromium. The reference page on disk is not modified.
 *
 * It records:
 *   - all 42 real galaxies: `fromReal(REAL[i])` (the parameters as a sparse difference from DEF,
 *     the odd feature, `describe` and `shortType`);
 *   - ~330 catalogue rows (every type of v21's buttons, the star-or-artefact rows and an even
 *     spread), with the arguments `showCat` computes (replicated here from L1788-1790) and
 *     `fromVotes`' output;
 *   - 12 of those rows again through v21's own `showCat` (`__GEN.find(objid)`), which sets the
 *     page's `P` and writes the caption: both must equal what the replica gave, which is how the
 *     replica of the arguments is checked.
 * For a star-or-artefact galaxy v21's `fromVotes` returns the bare parameters (no `.p`), and
 * `showCat` throws; both are recorded (`bare: true`, `showCatError`).
 *
 * Usage: node tools/capture-reference/votes.mjs [--out tests/vectors/from-votes.json]
 * then: npx prettier --write tests/vectors/from-votes.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

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
const HOOK = 'window.__EXPORT = function () { return exportSVG(); };';
const EXPOSE =
  'window.__FV = { fromVotes: fromVotes, fromReal: fromReal, describe: describe, shortType: shortType, get DEF() { return DEF; }, get REAL() { return REAL; }, get TYPES() { return TYPES; }, catVotes: catVotes, catExtra: catExtra, loadCat: loadCat, cat: function () { return CAT; } };';

const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const out = resolve(ROOT, outArg >= 0 ? (args[outArg + 1] ?? '') : 'tests/vectors/from-votes.json');

const src = readFileSync(PAGE, 'utf8');
if (src.split(HOOK).length !== 2) throw new Error('the __EXPORT hook was not found exactly once');
const html = src.replace(HOOK, HOOK + ' ' + EXPOSE);

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
/** @type {string[]} */
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.goto(url);
await page.waitForFunction(() => /** @type {any} */ (window).__GEN?.stats().ms != null, null, {
  timeout: 120_000,
});

const data = await page.evaluate(async () => {
  const w = /** @type {any} */ (window);
  const FV = w.__FV;
  /** @param {any} p sparse difference from DEF */
  const sparse = (p) => {
    /** @type {Record<string, unknown>} */
    const o = {};
    for (const k of Object.keys(p)) if (p[k] !== FV.DEF[k]) o[k] = p[k];
    return o;
  };
  /** @param {any} res */
  const pack = (res) => {
    const bare = res.p === undefined;
    return { bare, p: sparse(bare ? res : res.p), odd: bare ? null : res.odd };
  };

  const real = FV.REAL.map((/** @type {any} */ g, /** @type {number} */ i) => {
    const res = FV.fromReal(g);
    const o = pack(res);
    return {
      i,
      id: g.id,
      ...o,
      describe: o.bare ? null : FV.describe(g, res),
      shortType: o.bare ? null : FV.shortType(res.p, res.odd),
    };
  });

  const cat = await FV.loadCat();
  const N = cat.N;
  const c = cat.cols;
  /** the arguments of showCat (app23.js:L1789-1790), replicated */
  const argsOf = (/** @type {number} */ i) => {
    const qb = c.q[i];
    const q = qb ? (qb - 1) / 254 : 0.8;
    const pa = (c.pa[i] / 255) * 180;
    const wv = ((c.wind[i] << 24) >> 24) / 127;
    return {
      votes: FV.catVotes(i),
      q,
      pa,
      windSign: Math.abs(wv) > 0.25 ? Math.sign(wv) : 0,
      seed: Number(BigInt(cat.ids[i]) % 9973n) + 1,
      ex: FV.catExtra(i),
    };
  };
  /** @type {Set<number>} */
  const picked = new Set([0, 1, N - 1]);
  const spread = (/** @type {number[]} */ list, /** @type {number} */ n) => {
    for (let k = 0; k < n && list.length; k++)
      picked.add(/** @type {number} */ (list[Math.floor(((k + 0.5) * list.length) / n)]));
  };
  for (const name of Object.keys(FV.TYPES)) {
    const f = FV.TYPES[name];
    const idx = [];
    for (let i = 0; i < N; i++) if (f(i, c)) idx.push(i);
    spread(idx, name === 'any' ? 60 : 22);
  }
  const stars = [];
  for (let i = 0; i < N; i++) if (c.star[i] > c.smooth[i] && c.star[i] > c.feat[i]) stars.push(i);
  spread(stars, 24);
  // smooth galaxies with a disturbed or other odd feature and a red colour: the shell branch
  const shells = [];
  for (let i = 0; i < N; i++)
    if (
      c.odd[i] > 7 &&
      c.smooth[i] >= c.feat[i] &&
      c.gr[i] > 190 &&
      (c.disturbed[i] > 6 || c.other[i] > 6)
    )
      shells.push(i);
  spread(shells, 20);
  const withMissing = [];
  for (let i = 0; i < N; i++) if (!c.q[i] || !c.conc[i] || !c.gr[i]) withMissing.push(i);
  spread(withMissing, 12);
  const indices = [...picked].sort((a, b) => a - b);

  const rows = indices.map((i) => {
    const a = argsOf(i);
    const res = FV.fromVotes(a.votes, a.q, a.pa, a.windSign, a.seed, a.ex);
    return { i, objid: cat.ids[i], ...pack(res) };
  });

  // v21's own showCat on 12 non-star rows, and on 2 star rows (it throws on those)
  /** @type {any[]} */
  const showCat = [];
  const pickShow = rows
    .filter((r) => !r.bare)
    .filter((_r, k, a) => k % Math.floor(a.length / 12) === 0)
    .slice(0, 12);
  for (const r of pickShow) {
    w.__GEN.find(r.objid);
    await new Promise((ok) => setTimeout(ok, 50)); // findGalaxy runs showCat in a promise
    const P = JSON.parse(JSON.stringify(w.__GEN.P()));
    const entry = rows.find((x) => x.i === r.i);
    const equal = JSON.stringify(sparse(P)) === JSON.stringify(entry?.p);
    showCat.push({ i: r.i, objid: r.objid, equal, caption: w.__GEN.catInfo() });
  }
  const bare = rows.filter((r) => r.bare).slice(0, 2);
  for (const r of bare) {
    w.__GEN.find(r.objid); // showCat throws inside the promise; findGalaxy writes the message to the caption
    await new Promise((ok) => setTimeout(ok, 50));
    showCat.push({ i: r.i, objid: r.objid, showCatError: w.__GEN.catInfo() });
  }
  return { real, rows, showCat };
});

await browser.close();
server.close();

const bad = data.showCat.filter((/** @type {any} */ s) => s.equal === false);
if (bad.length)
  throw new Error(
    `the replica of showCat's arguments differs on rows ${bad.map((/** @type {any} */ b) => b.i).join(', ')}`,
  );

const manifest = {
  about:
    "v21's fromVotes, captured from the reference page itself (tools/capture-reference/votes.mjs). `p` is the parameter set as a difference from DEF; `bare` marks a star-or-artefact galaxy, for which v21's fromVotes returns the parameters without `.p`. `real` is fromReal over the 42 real galaxies; `rows` are catalogue rows (arguments as showCat computes them); `showCat` rows were also run through v21's own showCat, and the page's caption is recorded.",
  reference: 'assets/reference/pages/rosse-v21.html',
  pageErrors: pageErrors.length,
  real: data.real,
  rows: data.rows,
  showCat: data.showCat,
};
writeFileSync(out, JSON.stringify(manifest));
console.log(
  `${data.real.length} real galaxies, ${data.rows.length} catalogue rows (${data.rows.filter((/** @type {any} */ r) => r.bare).length} bare), ${data.showCat.length} through showCat -> ${out}`,
);
