/**
 * The engine's own line-work choices (review M-2): the golden runs draw with v21's choices
 * (ADR 0018), so this test is what keeps the engine's own honest, as variation-distribution.test.ts
 * does for makeVariation. Over many seeds, with v21's replayed variation on both sides (so that only
 * the line-work's own draws and noise differ), the engine's `curves()` and `dustLanes()` against
 * v21's, cut out of app23.js and evaluated as written (tests/golden/compare/v21-curves.ts):
 * - the stroke rows the curves are drawn with (a histogram over every curve);
 * - the spurs' keep rate (v21: 0.6);
 * - the curves per galaxy and their lengths, which for `Flocculent` are its arms' pieces, cut where
 *   the noise says;
 * - the lanes' kept steps (lane points per galaxy) and the hatches per galaxy, feathers included;
 * and the lattice noise against v21's sin-hash noise for several salts and seeds (deliberate
 * divergence 5: other patterns, the same statistics).
 *
 * The statistics are those of variation-distribution.test.ts: means within 4 standard errors of a
 * difference, standard deviations likewise, histograms by a two-sample χ² at the 0.1% level. The
 * seeds are fixed, so the test is deterministic.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NoiseSalt, vnoise } from '../../src/core/noise';
import type { Params } from '../../src/core/params';
import { presetParams } from '../../src/core/presets';
import { atlasFromBytes, type BuiltIndex } from '../../src/marks/atlas';
import type { VectorSheet } from '../../src/marks/vector';
import { curves } from '../../src/model/curves';
import { dustLanes } from '../../src/model/lanes';
import { drawingsMeta } from '../../src/model/scene';
import { v21Variation } from '../golden/compare/v21';
import { v21Lines } from '../golden/compare/v21-curves';

const ROOT = resolve(import.meta.dirname, '../..');
const BUILT = resolve(ROOT, 'assets-built');
const index = JSON.parse(readFileSync(resolve(BUILT, 'index.json'), 'utf8')) as BuiltIndex;
const atlas = (n: 'dots' | 'knots' | 'stars' | 'cores' | 'strokes') =>
  atlasFromBytes(
    n,
    index.atlases[n],
    new Uint8Array(readFileSync(resolve(BUILT, index.atlases[n].file))),
  );
const penlines = JSON.parse(
  readFileSync(resolve(BUILT, index.vectors.penlines?.file ?? ''), 'utf8'),
) as VectorSheet;
const M = drawingsMeta(
  {
    dots: atlas('dots'),
    knots: atlas('knots'),
    stars: atlas('stars'),
    cores: atlas('cores'),
    strokes: atlas('strokes'),
  },
  penlines,
);
const KINDS = M.strokes?.kind ?? [];

const N = 600;

function moments(xs: number[]) {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const m2 = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const m4 = xs.reduce((a, b) => a + (b - mean) ** 4, 0) / n;
  const sd = Math.sqrt(m2);
  const kurt = m2 > 0 ? m4 / (m2 * m2) : 3;
  return { n, mean, sd, kurt };
}

/** Means and standard deviations agree (see the header). */
function sameMoments(name: string, a: number[], b: number[]) {
  const x = moments(a);
  const y = moments(b);
  const seMean = Math.sqrt(x.sd ** 2 / x.n + y.sd ** 2 / y.n);
  expect(
    Math.abs(x.mean - y.mean),
    `${name} mean ${x.mean.toFixed(4)} vs ${y.mean.toFixed(4)}`,
  ).toBeLessThanOrEqual(4 * seMean + 1e-12);
  const seSd = (m: ReturnType<typeof moments>) =>
    m.sd * Math.sqrt(Math.max(0, m.kurt - 1) / (4 * m.n));
  expect(
    Math.abs(x.sd - y.sd),
    `${name} sd ${x.sd.toFixed(4)} vs ${y.sd.toFixed(4)}`,
  ).toBeLessThanOrEqual(4 * Math.hypot(seSd(x), seSd(y)) + 1e-12);
}

/** χ² critical values at the 0.1% level, by degrees of freedom (1–30). */
function chi2Critical(df: number): number {
  // Wilson–Hilferty: χ²_p ≈ df (1 − 2/(9 df) + z √(2/(9 df)))³, z = 3.090 for p = 0.999
  const z = 3.090232;
  return df * (1 - 2 / (9 * df) + z * Math.sqrt(2 / (9 * df))) ** 3;
}

/** Two histograms come from the same distribution (two-sample χ², unequal sample sizes). */
function sameCounts(name: string, a: number[], b: number[]) {
  const keys = [...new Set([...a, ...b])].sort((p, q) => p - q);
  const na = a.length;
  const nb = b.length;
  const ca = new Map<number, number>();
  const cb = new Map<number, number>();
  for (const x of a) ca.set(x, (ca.get(x) ?? 0) + 1);
  for (const x of b) cb.set(x, (cb.get(x) ?? 0) + 1);
  // merge neighbouring bins until each holds at least 10 on the smaller side's scale
  const bins: [number, number][] = [];
  let acc: [number, number] = [0, 0];
  for (const k of keys) {
    acc = [acc[0] + (ca.get(k) ?? 0), acc[1] + (cb.get(k) ?? 0)];
    if (Math.min(acc[0] / na, acc[1] / nb) * Math.min(na, nb) >= 10) {
      bins.push(acc);
      acc = [0, 0];
    }
  }
  if (acc[0] + acc[1] > 0) {
    const last = bins.pop() ?? [0, 0];
    bins.push([last[0] + acc[0], last[1] + acc[1]]);
  }
  const ka = Math.sqrt(nb / na);
  const kb = Math.sqrt(na / nb);
  let chi2 = 0;
  for (const [p, q] of bins) if (p + q > 0) chi2 += (ka * p - kb * q) ** 2 / (p + q);
  const df = Math.max(1, bins.length - 1);
  expect(chi2, `${name}: χ² ${chi2.toFixed(2)} on ${String(df)} df`).toBeLessThan(chi2Critical(df));
}

interface Sample {
  rows: number[];
  spursKept: number[];
  curvesNonSpur: number[];
  lengths: number[];
  lanePts: number[];
  hatches: number[];
}

function sample(preset: string, extra: Partial<Params> = {}): { ours: Sample; v21: Sample } {
  const empty = (): Sample => ({
    rows: [],
    spursKept: [],
    curvesNonSpur: [],
    lengths: [],
    lanePts: [],
    hatches: [],
  });
  const ours = empty();
  const v21 = empty();
  for (let i = 0; i < N; i++) {
    // v21's lanes read their noise at 0.01 · seed (0.1 · seed edge-on), so consecutive seeds share
    // its lattice rows: seeds 137 apart land on distinct rows, and the draws are independent
    const seed = 1 + 137 * i;
    const P = presetParams(preset, seed, extra);
    const V = v21Variation(P, M);
    const C = curves(P, V, M.strokes, P.incl);
    const L = dustLanes(P, V, penlines, P.incl);
    const T = v21Lines(ROOT, P, V, KINDS);
    const TL = T.lanes();
    const spur = (w: number) => w === 0.7;
    ours.rows.push(...C.map((c) => c.k));
    v21.rows.push(...T.curves.map((c) => c.k));
    const nSp = V.spurs.length;
    if (nSp) {
      ours.spursKept.push(C.filter((c) => c.role === 'spur').length / nSp);
      v21.spursKept.push(T.curves.filter((c) => spur(c.w)).length / nSp);
    }
    ours.curvesNonSpur.push(C.filter((c) => c.role !== 'spur').length);
    v21.curvesNonSpur.push(T.curves.filter((c) => !spur(c.w)).length);
    ours.lengths.push(...C.filter((c) => c.role !== 'spur').map((c) => c.pts.length));
    v21.lengths.push(...T.curves.filter((c) => !spur(c.w)).map((c) => c.pts.length));
    ours.lanePts.push(L.pts.length);
    v21.lanePts.push(TL.pts.length);
    ours.hatches.push(L.hatches.length);
    v21.hatches.push(TL.strokes.length);
  }
  return { ours, v21 };
}

describe("the engine's own line-work choices have v21's distributions (review M-2)", () => {
  const configs: [string, string, Partial<Params>][] = [
    ['Grand design', 'Grand design', {}],
    ['Flocculent (arm pieces)', 'Flocculent', {}],
    ['Dusty spiral (lanes and feathers)', 'Dusty spiral', {}],
    ['Barred spiral (ring lane)', 'Barred spiral', { barStyle: 'ribbon', ringStyle: 'ribbon' }],
    // incE > 74: the edge-on midplane stroke and its three rows of hatches
    ['Edge-on with dust (midplane stroke and hatches)', 'Edge-on with dust', {}],
  ];
  for (const [name, preset, extra] of configs)
    it(
      name,
      () => {
        const { ours, v21 } = sample(preset, extra);
        sameCounts(`${name}: stroke rows`, ours.rows, v21.rows);
        if (v21.spursKept.length)
          sameMoments(`${name}: spur keep rate`, ours.spursKept, v21.spursKept);
        sameCounts(`${name}: curves (spurs aside)`, ours.curvesNonSpur, v21.curvesNonSpur);
        sameMoments(`${name}: curve lengths`, ours.lengths, v21.lengths);
        if (v21.lanePts.some((x) => x > 0)) {
          sameMoments(`${name}: lane points`, ours.lanePts, v21.lanePts);
          sameMoments(`${name}: hatches`, ours.hatches, v21.hatches);
        }
      },
      120_000,
    );

  it('the spur keep rate is 0.6 on both sides', () => {
    const { ours, v21 } = sample('Grand design');
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(Math.abs(mean(ours.spursKept) - 0.6)).toBeLessThan(0.05);
    expect(Math.abs(mean(v21.spursKept) - 0.6)).toBeLessThan(0.05);
  }, 120_000);
});

/** v21's own `vnoise` (app23.js:L73–75), cut out and evaluated as written. */
function v21Vnoise(): (x: number, y: number) => number {
  const src = readFileSync(resolve(ROOT, 'assets/reference/rosse-source/app23.js'), 'utf8');
  const hash2 = /\nfunction hash2\([^\n]*\n/.exec(src)?.[0] ?? '';
  const vn = /\nfunction vnoise\([^\n]*\n[^\n]*\n/.exec(src)?.[0] ?? '';
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const make = new Function(`${hash2}${vn}return vnoise;`) as () => (
    x: number,
    y: number,
  ) => number;
  return make();
}

describe('the lattice noise has v21 noise statistics, every salt and several seeds', () => {
  const v21 = v21Vnoise();
  const salts: [string, number][] = [
    ['flocc', NoiseSalt.flocc],
    ['patchy', NoiseSalt.patchy],
    ['ring', NoiseSalt.ring],
    ['floccArm', NoiseSalt.floccArm],
    ['laneEdge', NoiseSalt.laneEdge],
    ['laneRing', NoiseSalt.laneRing],
    ['laneArm', NoiseSalt.laneArm],
    ['wobbleX', NoiseSalt.wobbleX],
  ];
  for (const [name, salt] of salts)
    for (const seed of [7, 4242, 90_001])
      it(`${name}, seed ${String(seed)}`, () => {
        const a: number[] = [];
        const b: number[] = [];
        // about 14,000 lattice cells: sampling errors of a few thousandths
        for (let i = 0; i < 200; i++)
          for (let j = 0; j < 200; j++) {
            const x = i * 0.61 + 0.11;
            const y = j * 0.53 + 0.07;
            a.push(vnoise(x, y, seed, salt));
            b.push(v21(x + seed * 0.37, y - seed * 0.11));
          }
        const stats = (s: number[]) => {
          const m = s.reduce((p, q) => p + q, 0) / s.length;
          const sd = Math.sqrt(s.reduce((p, q) => p + (q - m) ** 2, 0) / s.length);
          const tail = [0.3, 0.45, 0.6, 0.75].map((t) => s.filter((x) => x > t).length / s.length);
          return { m, sd, tail };
        };
        const A = stats(a);
        const B = stats(b);
        expect(Math.abs(A.m - B.m)).toBeLessThan(0.015);
        expect(Math.abs(A.sd - B.sd)).toBeLessThan(0.015);
        A.tail.forEach((t, k) => {
          expect(Math.abs(t - (B.tail[k] ?? 0))).toBeLessThan(0.02);
        });
      });
});
