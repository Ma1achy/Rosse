/**
 * The merger's test stars on the CPU engine (src/fallback/kernels/merger.ts) against v21's own
 * `simulateMerger` (tests/golden/compare/v21-merger.ts, cut out of app23.js and evaluated as
 * written): the initial conditions by distribution, the integration from identical starts, the
 * timeline's blend, and `mergerGalaxyParams`.
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fromHalf, packHalf2, toHalf, unpackHalf2 } from '../../src/core/f16';
import type { Params } from '../../src/core/params';
import { presetParams } from '../../src/core/presets';
import { CpuMergerStars } from '../../src/fallback/kernels/merger';
import {
  describeMerger,
  mergerGalaxyParams,
  memoryBudget,
  snapSelect,
  type MergerDesc,
} from '../../src/sim/merger';
import {
  v21GalaxyParams,
  v21GalaxyPicks,
  v21MergerIC,
  v21MergerPicks,
  v21MergerRun,
} from '../golden/compare/v21-merger';

const ROOT = resolve(import.meta.dirname, '../..');

describe('f16 snapshots', () => {
  it('rounds to nearest even, as the GPU converts', () => {
    expect(toHalf(1)).toBe(0x3c00);
    expect(toHalf(-2)).toBe(0xc000);
    expect(toHalf(65504)).toBe(0x7bff);
    expect(toHalf(65520)).toBe(0x7c00);
    expect(toHalf(2 ** -24)).toBe(1);
    expect(toHalf(1 / 3)).toBe(0x3555);
    // ties go to even: 1 + 2^-11 is halfway between 1 and 1 + 2^-10
    expect(toHalf(1 + 2 ** -11)).toBe(0x3c00);
    expect(toHalf(1 + 3 * 2 ** -11)).toBe(0x3c02);
    expect(toHalf(Infinity)).toBe(0x7c00);
    expect(Number.isNaN(fromHalf(toHalf(NaN)))).toBe(true);
  });

  it('round-trips within half an ulp (2⁻¹¹ relative)', () => {
    let worst = 0;
    for (let k = 0; k < 20000; k++) {
      const x = (Math.sin(k * 12.9898) * 43758.5453) % 40;
      if (Math.abs(x) < 2 ** -14) continue;
      worst = Math.max(worst, Math.abs(fromHalf(toHalf(x)) - x) / Math.abs(x));
    }
    expect(worst).toBeLessThanOrEqual(2 ** -11 + 1e-7);
    const [a, b] = unpackHalf2(packHalf2(1.5, -0.25));
    expect([a, b]).toEqual([1.5, -0.25]);
  });
});

describe('mergerGalaxyParams against v21', () => {
  const cases: [string, Params][] = [
    'Merger: the Mice',
    'Merger: long tails',
    'Merger: minor, a stream',
    'Merger: spiral meets elliptical',
    'Merger: dry (two ellipticals)',
    'Merger: polar collision',
    'Merger: three-armed pair',
    'Sketches, torn apart',
  ].flatMap((n) =>
    [7, 4242].map((s): [string, Params] => [`${n} s${String(s)}`, presetParams(n, s)]),
  );
  cases.push(
    [
      'a lenticular pair with bars',
      presetParams('Merger: the Mice', 7, {
        mType1: 'lenticular',
        mType2: 'lenticular',
        mBar1: 1,
        mBar2: 1,
      }),
    ],
    [
      'a barred spiral and an elliptical',
      presetParams('Merger: the Mice', 3, {
        mBar1: 1,
        mType2: 'elliptical',
        starMix: 0.9,
        lines: 0.2,
      }),
    ],
  );
  for (const [name, P] of cases)
    it(name, () => {
      for (const g of [0, 1] as const) {
        const want = v21GalaxyParams(ROOT, P, g);
        const got = mergerGalaxyParams(P, g, {
          galaxy: [v21GalaxyPicks(P, 0), v21GalaxyPicks(P, 1)],
        }) as Record<string, unknown>;
        expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort());
        for (const [k, v] of Object.entries(want)) expect(got[k], k).toBeCloseTo(v as number, 12);
      }
    });
});

/** The two-sample Kolmogorov–Smirnov statistic. */
function ks(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const x = Array.from(a).sort((p, q) => p - q);
  const y = Array.from(b).sort((p, q) => p - q);
  let i = 0;
  let j = 0;
  let d = 0;
  while (i < x.length && j < y.length) {
    const vi = x[i] as number;
    const vj = y[j] as number;
    if (vi <= vj) i++;
    if (vj <= vi) j++;
    d = Math.max(d, Math.abs(i / x.length - j / y.length));
  }
  return d;
}

/** The 0.1% critical value of the two-sample KS statistic. */
const ksCrit = (n: number, m: number) => 1.95 * Math.sqrt((n + m) / (n * m));

/** The engine's initial conditions with v21's galaxy-level picks (the spin and the pitch). */
function engineStars(P: Params): { d: MergerDesc; s: CpuMergerStars } {
  const d = describeMerger(P, v21MergerPicksOf(P));
  const s = new CpuMergerStars(d);
  s.init();
  return { d, s };
}
const v21MergerPicksOf = (P: Params) => v21MergerPicks(ROOT, P);

describe('initial conditions against v21 (distributions, same spin and pitch)', () => {
  const cases: [string, Params][] = [
    ['the Mice (two spirals)', presetParams('Merger: the Mice', 7)],
    ['spiral meets elliptical, tilted', presetParams('Merger: spiral meets elliptical', 4242)],
    ['dry (two ellipticals)', presetParams('Merger: dry (two ellipticals)', 7)],
    ['three-armed pair with a bar', presetParams('Merger: three-armed pair', 4242)],
    [
      'lenticular pair',
      presetParams('Merger: the Mice', 11, {
        mType1: 'lenticular',
        mType2: 'lenticular',
        mBar1: 1,
      }),
    ],
  ];
  for (const [name, P] of cases)
    it(name, () => {
      const v = v21MergerIC(ROOT, P);
      const { d, s } = engineStars(P);
      expect(d.total).toBe(v.G.length);
      expect(Array.from(v.N)).toEqual(d.n);
      // the same replayed spin and pitch
      for (const g of [0, 1] as const) {
        expect(d.gals[g].n[2]).toBeCloseTo(
          Math.cos((g === 0 ? P.mSpin1 : P.mSpin2) * (Math.PI / 180)),
          12,
        );
        expect(d.gals[g].pitch).toBe(v.pitch[g]);
      }
      const worst: string[] = [];
      for (const g of [0, 1]) {
        const lo = g === 0 ? 0 : d.n[0];
        const hi = g === 0 ? d.n[0] : d.total;
        const core = d.gals[g as 0 | 1].core;
        const col = (get: (i: number) => number) =>
          Array.from({ length: hi - lo }, (_, k) => get(lo + k));
        const crit = ksCrit(hi - lo, hi - lo);
        const series: [string, (i: number) => number, (i: number) => number][] = [
          ['x', (i) => (s.xs[i * 4] as number) - core[0], (i) => (v.X[i * 3] as number) - core[0]],
          [
            'y',
            (i) => (s.xs[i * 4 + 1] as number) - core[1],
            (i) => (v.X[i * 3 + 1] as number) - core[1],
          ],
          [
            'z',
            (i) => (s.xs[i * 4 + 2] as number) - core[2],
            (i) => (v.X[i * 3 + 2] as number) - core[2],
          ],
          ['vx', (i) => (s.vs[i * 4] as number) - core[3], (i) => (v.V[i * 3] as number) - core[3]],
          [
            'vy',
            (i) => (s.vs[i * 4 + 1] as number) - core[4],
            (i) => (v.V[i * 3 + 1] as number) - core[4],
          ],
          [
            'vz',
            (i) => (s.vs[i * 4 + 2] as number) - core[5],
            (i) => (v.V[i * 3 + 2] as number) - core[5],
          ],
          ['R0', (i) => s.ic[i * 4 + 2] as number, (i) => v.R0[i] as number],
          ['DX', (i) => s.ic[i * 4] as number, (i) => v.DX[i] as number],
          ['DY', (i) => s.ic[i * 4 + 1] as number, (i) => v.DY[i] as number],
        ];
        for (const [label, a, b] of series) {
          // atoms (the cap of an elliptical's radius) differ in the last f32 bit: quantise
          const q = (x: number) => Math.round(x * 1e5) / 1e5;
          const D = ks(
            col((i) => q(a(i))),
            col((i) => q(b(i))),
          );
          worst.push(`${String(g)}:${label} ${D.toFixed(3)}`);
          expect(D, `galaxy ${String(g)} ${label}`).toBeLessThanOrEqual(crit);
        }
      }
      console.log(`${name}: KS ${worst.join(', ')}`);
    });
});

describe('the integration against v21, from the same initial conditions', () => {
  /** v21 (f64 arithmetic, f32 storage) from the engine's initial conditions. */
  function compare(P: Params, label: string) {
    const d = describeMerger(P, v21MergerPicksOf(P));
    const s = new CpuMergerStars(d);
    s.init();
    // the engine's starts, in v21's layout
    const X = new Float32Array(d.total * 3);
    const V = new Float32Array(d.total * 3);
    for (let i = 0; i < d.total; i++)
      for (let k = 0; k < 3; k++) {
        X[i * 3 + k] = s.xs[i * 4 + k] as number;
        V[i * 3 + k] = s.vs[i * 4 + k] as number;
      }
    const v = v21MergerRun(ROOT, P, { X, V });
    s.run();
    return { d, s, v, label };
  }

  /** |Δ| per star, in galaxy units, between two position lists. */
  const errors = (a: ArrayLike<number>, stride: number, b: ArrayLike<number>, n: number) =>
    Array.from({ length: n }, (_, i) =>
      Math.hypot(
        (a[i * stride] as number) - (b[i * 3] as number),
        (a[i * stride + 1] as number) - (b[i * 3 + 1] as number),
        (a[i * stride + 2] as number) - (b[i * 3 + 2] as number),
      ),
    ).sort((p, q) => p - q);

  const report = (name: string, e: number[]) => {
    const q = (p: number) => e[Math.min(e.length - 1, Math.floor(e.length * p))] as number;
    const line = `${name}: median ${q(0.5).toExponential(2)}, p99 ${q(0.99).toExponential(2)}, max ${(e[e.length - 1] as number).toExponential(2)} units`;
    console.log(line);
    return { median: q(0.5), p99: q(0.99), max: e[e.length - 1] as number };
  };

  it('the Mice at the chosen moment (f32 stars against v21)', () => {
    const P = presetParams('Merger: the Mice', 7, { mStars: 6000 });
    const { d, s, v } = compare(P, 'the Mice');
    expect(d.track.chosen.steps).toBeGreaterThan(100);
    const e = report('the Mice, chosen moment', errors(s.chosen, 4, v.X, d.total));
    // one plate pixel is about 1/90 of a unit; most stars agree far better
    expect(e.median).toBeLessThan(2e-4);
    expect(e.p99).toBeLessThan(5e-3);
  });

  it('the Mice at the end of a horizon of 3 (the future)', () => {
    const P = presetParams('Merger: the Mice', 4242, { mStars: 6000, mHorizon: 3 });
    const { d, s, v } = compare(P, 'the Mice, horizon 3');
    const last = v.fut[v.fut.length - 1] as Float32Array;
    const e = report('the Mice, horizon 3', errors(s.horizon, 4, last, d.total));
    expect(e.median).toBeLessThan(1e-3);
    expect(e.p99).toBeLessThan(5e-2);
  });

  it('long tails: close and distant stars, p99 and max reported', () => {
    const P = presetParams('Merger: long tails', 7, { mStars: 6000 });
    const { d, s, v } = compare(P, 'long tails');
    const e = report('long tails, chosen moment', errors(s.chosen, 4, v.X, d.total));
    expect(e.median).toBeLessThan(5e-4);
    expect(e.p99).toBeLessThan(2e-2);
  });

  it('the timeline blend (f16 snapshots) against v21’s snapAt', () => {
    const P = presetParams('Merger: the Mice', 7, { mStars: 6000 });
    const { d, s, v } = compare(P, 'timeline');
    for (const t of [0, 0.25, 0.5, 0.8, 0.99]) {
      const sel = snapSelect(d.track, t);
      const mine = s.blend(sel);
      // v21's snapAt over its own frames
      const n = v.frames.length;
      const x = Math.min(Math.max(t * (n - 1), 0), n - 1);
      const i0 = Math.floor(x);
      const i1 = Math.min(n - 1, i0 + 1);
      const a = x - i0;
      const A0 = v.frames[i0] as Float32Array;
      const A1 = v.frames[i1] as Float32Array;
      const want = new Float32Array(A0.length);
      for (let k = 0; k < want.length; k++)
        want[k] =
          a < 1e-4 || i0 === i1
            ? (A0[k] as number)
            : (A0[k] as number) * (1 - a) + (A1[k] as number) * a;
      const e = report(`blend at ${String(t)}`, errors(mine, 4, want, d.total));
      // f16 relative to the nearer core: about 2^-11 of the distance to it
      expect(e.p99).toBeLessThan(2e-2);
      expect(e.median).toBeLessThan(2e-3);
    }
    for (const t of [1.2, 1.5, 1.9]) {
      const sel = snapSelect(d.track, t);
      const mine = s.blend(sel);
      const n = v.fut.length;
      const x = Math.min(Math.max(((t - 1) / (d.track.horizon - 1)) * (n - 1), 0), n - 1);
      const i0 = Math.floor(x);
      const i1 = Math.min(n - 1, i0 + 1);
      const a = x - i0;
      const A0 = v.fut[i0] as Float32Array;
      const A1 = v.fut[i1] as Float32Array;
      const want = new Float32Array(A0.length);
      for (let k = 0; k < want.length; k++)
        want[k] =
          a < 1e-4 || i0 === i1
            ? (A0[k] as number)
            : (A0[k] as number) * (1 - a) + (A1[k] as number) * a;
      const e = report(`blend at ${String(t)}`, errors(mine, 4, want, d.total));
      expect(e.median).toBeLessThan(5e-3);
    }
  });
});

describe('the memory budget (ADR 0009)', () => {
  it('the Mice at the defaults, and the worst case', () => {
    const mice = memoryBudget(describeMerger(presetParams('Merger: the Mice', 7)));
    const worst = memoryBudget(
      describeMerger(
        presetParams('Merger: long tails', 7, { mStars: 30000, mHorizon: 30, mRatio: 1 }),
      ),
    );
    const mb = (x: number) => `${(x / 2 ** 20).toFixed(1)} MiB`;
    console.log(
      `memory, the Mice: ${Object.entries(mice)
        .map(([k, x]) => `${k} ${mb(x)}`)
        .join(', ')}`,
    );
    console.log(
      `memory, 30,000 stars and a horizon of 30: ${Object.entries(worst)
        .map(([k, x]) => `${k} ${mb(x)}`)
        .join(', ')}`,
    );
    expect(mice.total).toBeLessThan(40 * 2 ** 20);
    expect((worst.timelineF16 as number) + (worst.futureF16 as number)).toBeLessThanOrEqual(
      64 * 2 ** 20,
    );
    expect(worst.total).toBeLessThan(160 * 2 ** 20);
  });
});
