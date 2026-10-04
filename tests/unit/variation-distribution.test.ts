/**
 * Our `makeVariation` (src/model/variation.ts, on the counter RNG of ADR 0004) against v21's,
 * replayed offline on v21's own stream (tests/golden/compare/v21.ts), over 2,000 seeds: the same
 * distributions, field by field. The golden runs draw with v21's replayed variation (ADR 0015),
 * so this test is what keeps our own variation honest.
 *
 * Statistics, for n = 2,000 independent seeds on each side:
 * - means: |Δ| ≤ 4 · √(s₁²/n + s₂²/n), four standard errors of a difference of means;
 * - standard deviations: |Δ| ≤ 4 · √(se₁² + se₂²), with se = s · √((κ − 1) / (4n)) the standard
 *   error of a sample standard deviation for a distribution of kurtosis κ (measured);
 * - counts (ns, nc, nd, the hand's number of pens): a two-sample χ² test on their histograms,
 *   bins with fewer than 10 expected merged, at the 0.1% level.
 * The seeds are fixed, so the test is deterministic; the 4σ and 0.1% levels say how unlikely it
 * would be for two identical distributions to fail it: about 6 × 10⁻⁵ per mean and 10⁻³ per
 * histogram.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Params } from '../../src/core/params';
import { presetParams } from '../../src/core/presets';
import { makeVariation, type DrawingsMeta, type Variation } from '../../src/model/variation';
import { v21Variation } from '../golden/compare/v21';

const N = 2000;

function meta(): DrawingsMeta {
  const idx = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../../assets-built/index.json'), 'utf8'),
  ) as { atlases: Record<string, { layers: number; meta: Record<string, unknown[]> }> };
  const get = (n: string) => {
    const x = idx.atlases[n];
    if (!x) throw new Error(n);
    return x;
  };
  return {
    dots: { src: get('dots').meta.src as string[], size: get('dots').meta.size as number[] },
    knots: { count: get('knots').layers },
    stars: { count: get('stars').layers },
    cores: { kind: get('cores').meta.kind as string[], style: get('cores').meta.style as string[] },
  };
}
const M = meta();

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
  const seMean = Math.sqrt((x.sd ** 2 + y.sd ** 2) / x.n);
  expect(
    Math.abs(x.mean - y.mean),
    `${name} mean ${String(x.mean)} vs ${String(y.mean)}`,
  ).toBeLessThanOrEqual(4 * seMean + 1e-12);
  const seSd = (m: ReturnType<typeof moments>) =>
    m.sd * Math.sqrt(Math.max(0, m.kurt - 1) / (4 * m.n));
  expect(
    Math.abs(x.sd - y.sd),
    `${name} sd ${String(x.sd)} vs ${String(y.sd)}`,
  ).toBeLessThanOrEqual(4 * Math.hypot(seSd(x), seSd(y)) + 1e-12);
}

/** χ² critical values at the 0.1% level, by degrees of freedom. */
const CHI2_999 = [0, 10.83, 13.82, 16.27, 18.47, 20.52, 22.46, 24.32, 26.12, 27.88, 29.59];

/** Two histograms of small integers come from the same distribution (two-sample χ²). */
function sameCounts(name: string, a: number[], b: number[]) {
  const keys = [...new Set([...a, ...b])].sort((p, q) => p - q);
  const ca = keys.map((k) => a.filter((x) => x === k).length);
  const cb = keys.map((k) => b.filter((x) => x === k).length);
  // merge neighbouring bins until each expects at least 10 on each side
  const bins: [number, number][] = [];
  let acc: [number, number] = [0, 0];
  keys.forEach((_, i) => {
    acc = [acc[0] + (ca[i] ?? 0), acc[1] + (cb[i] ?? 0)];
    if ((acc[0] + acc[1]) / 2 >= 10) {
      bins.push(acc);
      acc = [0, 0];
    }
  });
  if (acc[0] + acc[1] > 0) {
    const last = bins.pop() ?? [0, 0];
    bins.push([last[0] + acc[0], last[1] + acc[1]]);
  }
  let chi2 = 0;
  for (const [p, q] of bins) if (p + q > 0) chi2 += (p - q) ** 2 / (p + q);
  const df = Math.max(1, bins.length - 1);
  expect(chi2, `${name}: χ² ${chi2.toFixed(2)} on ${String(df)} df`).toBeLessThan(
    CHI2_999[Math.min(df, CHI2_999.length - 1)] ?? 30,
  );
}

function sample(P: (seed: number) => Params, make: (p: Params) => Variation): Variation[] {
  return Array.from({ length: N }, (_, i) => make(P(i + 1)));
}

describe('makeVariation: the same distributions as v21’s, over 2,000 seeds', () => {
  const configs: [string, (seed: number) => Params][] = [
    ['Grand design', (s) => presetParams('Grand design', s)],
    ['Flocculent, patchy 0.5', (s) => presetParams('Flocculent', s, { patchy: 0.5 })],
  ];
  for (const [name, P] of configs)
    it(
      name,
      () => {
        const ours = sample(P, (p) => makeVariation(p, M));
        const v21 = sample(P, (p) => v21Variation(p, M));
        const num = (f: (v: Variation) => number) => [ours.map(f), v21.map(f)] as const;
        const fields: [string, (v: Variation) => number][] = [
          ['arm 0 pitch', (v) => v.arms[0]?.pitch ?? NaN],
          ['arm 0 amp', (v) => v.arms[0]?.amp ?? NaN],
          ['arm 0 phase', (v) => v.arms[0]?.phase ?? NaN],
          ['arm 0 rmax', (v) => v.arms[0]?.rmax ?? NaN],
          ['arm 0 wig', (v) => v.arms[0]?.wig ?? NaN],
          ['arm 0 wf', (v) => v.arms[0]?.wf ?? NaN],
          ['arm 0 wp', (v) => v.arms[0]?.wp ?? NaN],
          ['arm 1 pitch', (v) => v.arms[1]?.pitch ?? NaN],
          ['arm 1 phase', (v) => v.arms[1]?.phase ?? NaN],
          ['lop', (v) => v.lop],
          ['lopA', (v) => v.lopA],
          ['warp', (v) => v.warp],
          ['warpA', (v) => v.warpA],
          ['spike', (v) => v.spike],
          ['hand size (dots)', (v) => v.dotPool.length],
          ['mean knot tile', (v) => v.knotPool.reduce((a, b) => a + b, 0) / v.knotPool.length],
        ];
        for (const [f, get] of fields) sameMoments(`${name}: ${f}`, ...num(get));
        // the fields of every spur, clump and dust patch, pooled
        const pool = (pick: (v: Variation) => number[]) =>
          [ours.flatMap(pick), v21.flatMap(pick)] as const;
        sameMoments(`${name}: spur R0`, ...pool((v) => v.spurs.map((s) => s.R0)));
        sameMoments(`${name}: spur len`, ...pool((v) => v.spurs.map((s) => s.len)));
        sameMoments(`${name}: spur pk`, ...pool((v) => v.spurs.map((s) => s.pk)));
        sameMoments(`${name}: clump R`, ...pool((v) => v.clumps.map((c) => c.R)));
        sameMoments(`${name}: clump s`, ...pool((v) => v.clumps.map((c) => c.s)));
        sameMoments(`${name}: clump n`, ...pool((v) => v.clumps.map((c) => c.n)));
        sameMoments(`${name}: dust R`, ...pool((v) => v.dust.map((d) => d.R)));
        sameMoments(`${name}: dust s`, ...pool((v) => v.dust.map((d) => d.s)));
        // the counts
        sameCounts(`${name}: ns`, ...num((v) => v.spurs.length));
        sameCounts(`${name}: nc`, ...num((v) => v.clumps.length));
        sameCounts(`${name}: nd`, ...num((v) => v.dust.length));
        sameCounts(`${name}: pens in the hand`, ...num((v) => v.hand.length));
        sameCounts(
          `${name}: whole sheet as the hand`,
          ...num((v) => (v.dotPool.length === 500 ? 1 : 0)),
        );
      },
      60_000,
    );
});
