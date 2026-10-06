/**
 * Shared by the unit tests of the vector drawings: the packed library and the drawings' metadata,
 * read from assets-built/ (`npm test` packs it first), and two-sample statistics.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'vitest';
import { atlasFromBytes, type BuiltIndex } from '../../../src/marks/atlas';
import { VECTOR_ATLASES, type VectorLibrary, type VectorSheet } from '../../../src/marks/vector';
import { drawingsMeta } from '../../../src/model/scene';

export const ROOT = resolve(import.meta.dirname, '../../..');
const BUILT = resolve(ROOT, 'assets-built');
const index = JSON.parse(readFileSync(resolve(BUILT, 'index.json'), 'utf8')) as BuiltIndex;
const atlas = (n: 'dots' | 'knots' | 'stars' | 'cores') =>
  atlasFromBytes(
    n,
    index.atlases[n],
    new Uint8Array(readFileSync(resolve(BUILT, index.atlases[n].file))),
  );

export const LIBRARY = Object.fromEntries(
  VECTOR_ATLASES.map((n) => [
    n,
    JSON.parse(readFileSync(resolve(BUILT, index.vectors[n]?.file ?? ''), 'utf8')) as VectorSheet,
  ]),
) as VectorLibrary;

/** The drawings' metadata with every vector sheet. */
export const META = drawingsMeta(
  { dots: atlas('dots'), knots: atlas('knots'), stars: atlas('stars'), cores: atlas('cores') },
  LIBRARY.penlines,
  LIBRARY,
);

function moments(xs: number[]) {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const m2 = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const m4 = xs.reduce((a, b) => a + (b - mean) ** 4, 0) / n;
  const sd = Math.sqrt(m2);
  const kurt = m2 > 0 ? m4 / (m2 * m2) : 3;
  return { n, mean, sd, kurt };
}

/**
 * Means and standard deviations of two samples agree: |Δmean| ≤ 4 standard errors of the
 * difference, |Δsd| ≤ 4 · √(se₁² + se₂²) with se = s · √((κ − 1)/(4n)) (as
 * tests/unit/variation-distribution.test.ts).
 */
export function sameMoments(name: string, a: number[], b: number[]) {
  expect(a.length, `${name}: sample sizes`).toBeGreaterThan(30);
  expect(b.length, `${name}: sample sizes`).toBeGreaterThan(30);
  const x = moments(a);
  const y = moments(b);
  const seMean = Math.sqrt(x.sd ** 2 / x.n + y.sd ** 2 / y.n);
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

/** χ² critical values at the 0.1% level, by degrees of freedom (1–30). */
const CHI2_999 = [
  0, 10.83, 13.82, 16.27, 18.47, 20.52, 22.46, 24.32, 26.12, 27.88, 29.59, 31.26, 32.91, 34.53,
  36.12, 37.7, 39.25, 40.79, 42.31, 43.82, 45.31, 46.8, 48.27, 49.73, 51.18, 52.62, 54.05, 55.48,
  56.89, 58.3, 59.7,
];

/**
 * Two histograms of categories (small integers: tiles, counts) come from the same distribution:
 * a two-sample χ² test at the 0.1% level, neighbouring categories merged until each bin expects
 * at least 10, the samples' sizes allowed to differ.
 */
export function sameCounts(name: string, a: number[], b: number[]) {
  const keys = [...new Set([...a, ...b])].sort((p, q) => p - q);
  const count = (xs: number[]) => {
    const m = new Map<number, number>();
    for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
    return keys.map((k) => m.get(k) ?? 0);
  };
  const ca = count(a);
  const cb = count(b);
  const na = a.length;
  const nb = b.length;
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
  // two samples of sizes na and nb: Σ (√(nb/na)·p − √(na/nb)·q)² / (p + q)
  const ka = Math.sqrt(nb / na);
  const kb = Math.sqrt(na / nb);
  let chi2 = 0;
  for (const [p, q] of bins) if (p + q > 0) chi2 += (ka * p - kb * q) ** 2 / (p + q);
  const df = Math.max(1, bins.length - 1);
  // beyond the table, the Wilson–Hilferty approximation (z = 3.090 at 0.1%)
  const wh = df * (1 - 2 / (9 * df) + 3.09 * Math.sqrt(2 / (9 * df))) ** 3;
  expect(chi2, `${name}: χ² ${chi2.toFixed(2)} on ${String(df)} df`).toBeLessThan(
    CHI2_999[df] ?? wh,
  );
}
