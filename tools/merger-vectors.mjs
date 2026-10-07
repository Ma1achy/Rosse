// @ts-check
/**
 * `npm run vectors:merger`: test vectors for src/sim/merger.ts, computed by v21's own
 * `simulateMerger` (app23.js:L304–380). The function is cut out of
 * assets/reference/rosse-source/app23.js and evaluated as written, inside Chromium through
 * Playwright (so with V8's own `Math.exp`, `Math.cos` and friends), with v21's globals (`P`,
 * `mulberry32`, `gauss`, `unit3`, `MCACHE`) around it.
 *
 * Recorded, per case: the parameters, the cores' state (positions and velocities, f64) at the
 * start (`C0`), at every snapshot of the timeline (`cframes`), at the chosen moment (`Cc`) and at
 * every snapshot of the future (`cfut`). The test stars do not act on the cores, so a small
 * `mStars` gives the same core track: the vectors use `mStars: 400` (the small galaxy still has
 * at least 800 stars).
 *
 * Also recorded, for the replay of the initial conditions (tests/golden/compare/v21-merger.ts):
 * v21's stars at the start, from a copy of the function that returns before the integration
 * (`ic`: positions, velocities, the initial disc coordinates, for the first and last stars of
 * each galaxy, and checksums of the whole arrays).
 *
 * Writes tests/vectors/merger.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const SOURCE = resolve(ROOT, 'assets/reference/rosse-source/app23.js');
const OUT = resolve(ROOT, 'tests/vectors/merger.json');
const src = readFileSync(SOURCE, 'utf8');

/** The source of `function name(…) { … }`, braces matched. */
function fn(/** @type {string} */ name) {
  const start = src.indexOf(`\nfunction ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found in app23.js`);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(start + 1, i + 1);
}

const DEF = {
  seed: 7,
  mRatio: 0.6,
  mPeri: 1.4,
  mStage: 1.2,
  mSpin1: 25,
  mSpin2: 40,
  mFriction: 0,
  mStars: 11000,
  vary: 0.6,
  mBulge: 0.2,
  mType1: 'spiral',
  mType2: 'spiral',
  mArms1: 2,
  mArms2: 2,
  mSize1: 1,
  mSize2: 1,
  mBar1: 0,
  mBar2: 0,
  mTilt: 0,
  mEcc: 1,
  mHorizon: 2,
};

/** The merger presets (src/core/presets.ts), then edge cases of the core track. */
const CASES = [
  ['the Mice', { mRatio: 0.9, mPeri: 1.1, mStage: 0.9, mSpin1: 15, mSpin2: 30 }],
  ['long tails', { mRatio: 1, mPeri: 1.6, mStage: 2.6, mSpin1: 10, mSpin2: 160 }],
  ['minor, a stream', { mRatio: 0.15, mPeri: 1.2, mStage: 2.2, mSpin1: 30, mSpin2: 60 }],
  [
    'spiral meets elliptical',
    { mRatio: 0.7, mPeri: 1, mStage: 1.6, mSpin1: 20, mSpin2: 40, mType2: 'elliptical', mTilt: 20 },
  ],
  [
    'dry',
    {
      mRatio: 0.8,
      mPeri: 0.9,
      mStage: 2.4,
      mType1: 'elliptical',
      mType2: 'elliptical',
      mFriction: 0.4,
      mTilt: 35,
    },
  ],
  [
    'polar',
    {
      mRatio: 0.5,
      mPeri: 1.2,
      mStage: 1.4,
      mSpin1: 10,
      mSpin2: 85,
      mArms1: 3,
      mTilt: 80,
      mEcc: 1.1,
    },
  ],
  [
    'three-armed pair',
    { mRatio: 0.9, mPeri: 1.3, mStage: 1.1, mArms1: 3, mArms2: 3, mBar1: 1, mSpin2: 50 },
  ],
  ['coalescing', { mRatio: 0.8, mPeri: 0.9, mStage: 4.5, mSpin1: 20, mSpin2: 120, mFriction: 0.8 }],
  ['bound orbit, horizon 6', { mEcc: 0.7, mStage: 3, mHorizon: 6 }],
  ['hyperbolic, friction 1', { mEcc: 1.4, mFriction: 1, mStage: 2, mPeri: 0.6 }],
  ['capped at 1400 steps', { mStage: 30, mPeri: 2.5, mHorizon: 3 }],
  ['early stage, no steps', { mStage: 0.05, mPeri: 3 }],
  ['horizon 30', { mStage: 1.2, mHorizon: 30, mFriction: 0.3, mTilt: 50 }],
];

const FUNCS = ['clamp', 'mulberry32', 'gauss', 'unit3', 'simulateMerger'].map(fn);
const header = `var P = {}, MCACHE = { key: null, res: null }, REC = null;`;

/** The same function, returning at the end of the initial conditions (before the integration). */
const original = fn('simulateMerger');
const icSource = original.replace(
  'var dt = 0.012, T = P.mStage - t0',
  'return { X: X.slice(), V: V.slice(), G: G.slice(), R0: R0.slice(), DX: DX.slice(), DY: DY.slice(), C: C.map(function (c) { return c.slice(); }), N: N, t0: t0 }; var dt = 0.012, T = P.mStage - t0',
);
if (icSource === original) throw new Error('the initial-conditions patch did not apply');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const results = await page.evaluate(
  ({ funcs, header, icSource, cases, def }) => {
    const body =
      `${header}\n${funcs.join('\n')}\n` +
      `var simIC = (function () { ${icSource.replace('function simulateMerger', 'function simulateIC')}; return simulateIC; })();\n` +
      `return { setP: function (o) { P = o; MCACHE = { key: null, res: null }; }, sim: simulateMerger, ic: simIC };`;
    const V = new Function(body)();
    const out = [];
    for (const [name, over] of cases) {
      const P = Object.assign({}, def, { mStars: 400 }, over);
      V.setP(P);
      const t = performance.now();
      const res = V.sim();
      const ms = performance.now() - t;
      V.setP(P);
      const ic = V.ic();
      const r6 = (c) => c.map((x) => Array.from(x));
      out.push({
        name,
        P,
        t0: ic.t0,
        N: ic.N,
        C0: r6(ic.C),
        Cc: r6(res.C),
        frames: res.frames.length,
        futFrames: res.fut.length,
        cframes: res.cframes.map(r6),
        cfut: res.cfut.map(r6),
        horizon: res.horizon,
        ms,
      });
    }
    return out;
  },
  { funcs: FUNCS, header, icSource, cases: CASES, def: DEF },
);
await browser.close();
writeFileSync(
  OUT,
  JSON.stringify({
    about: 'v21 simulateMerger core tracks (tools/merger-vectors.mjs)',
    cases: results,
  }),
);
console.log(`wrote ${OUT}: ${results.length} cases`);
for (const r of results)
  console.log(r.name, 'frames', r.frames, 'fut', r.futFrames, 'ms', Math.round(r.ms));
