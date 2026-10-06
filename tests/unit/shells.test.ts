/**
 * Shell galaxies on the CPU engine (src/fallback/kernels/shells.ts, src/sim/shells.ts) against v21's
 * own `shellSprites` and `shellArcs` (tests/golden/compare/v21-shells.ts, cut out of app23.js and
 * evaluated as written): the initial conditions by distribution, the integration and the detection
 * from identical starts, and the arcs as curves.
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { presetParams } from '../../src/core/presets';
import { CpuShells } from '../../src/fallback/kernels/shells';
import { detectArcsCpu, shellCurves, shellParamsOf, shellSteps } from '../../src/sim/shells';
import { v21ShellIC, v21ShellsRun, type V21Hand } from '../golden/compare/v21-shells';
import { META } from './support/vectors';

const ROOT = resolve(import.meta.dirname, '../..');
const KINDS = META.strokes?.kind ?? [];
// a hand: the first 40 tiles of the dots, whatever they are
const HAND: V21Hand = {
  dotPool: Array.from({ length: 40 }, (_, i) => (i * 7) % META.dots.size.length),
  dotSizes: Array.from(META.dots.size),
  strokeKinds: Array.from(KINDS.length ? KINDS : ['plain', 'faint', 'faint', 'beaded']),
};

function ks(a: number[], b: number[]): number {
  const x = a.slice().sort((p, q) => p - q);
  const y = b.slice().sort((p, q) => p - q);
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

/**
 * `chaotic`: a long infall packs the shells so tightly that a few of the 4,000 stars change bin
 * between f32 and v21's f64 steps, which moves a borderline peak in or out of the detection: only
 * most of v21's shells need be found.
 */
const CASES: [string, number, Partial<Parameters<typeof presetParams>[2]>, boolean][] = [
  ['Shell galaxy s7', 7, {}, false],
  ['Shell galaxy s4242', 4242, {}, false],
  ['a short infall, 3,000 stars', 11, { shellTime: 40, shellStars: 3000 }, false],
  ['a long one, other axis', 3, { shellTime: 110, shellAxis: 80, shellStars: 4000 }, true],
];

describe('shells against v21', () => {
  for (const [name, seed, extra, chaotic] of CASES) {
    it(name, () => {
      const P = presetParams('Shell galaxy', seed, extra);
      const p = shellParamsOf(P);
      const s = new CpuShells(p);
      s.init();
      // the same start in v21's layout: the engine's initial conditions through v21's integrator
      const X = new Float32Array(p.shellStars * 3);
      const V = new Float32Array(p.shellStars * 3);
      for (let i = 0; i < p.shellStars; i++)
        for (let k = 0; k < 3; k++) {
          X[i * 3 + k] = s.xs[i * 4 + k] as number;
          V[i * 3 + k] = s.vs[i * 4 + k] as number;
        }
      // initial conditions: the same distributions
      const ic = v21ShellIC(ROOT, P, HAND);
      for (let k = 0; k < 6; k++) {
        const mine = Array.from({ length: p.shellStars }, (_, i) =>
          k < 3 ? (X[i * 3 + k] as number) : (V[i * 3 + k - 3] as number),
        );
        const theirs = Array.from({ length: p.shellStars }, (_, i) =>
          k < 3 ? (ic.X[i * 3 + k] as number) : (ic.V[i * 3 + k - 3] as number),
        );
        expect(ks(mine, theirs), `initial coordinate ${String(k)}`).toBeLessThan(
          1.95 * Math.sqrt(2 / p.shellStars),
        );
      }
      // the integration and the detection, from the same start
      const v = v21ShellsRun(ROOT, P, HAND, { X, V });
      s.integrate(0, shellSteps(p));
      const errs = Array.from({ length: p.shellStars }, (_, i) =>
        Math.hypot(
          (s.xs[i * 4] as number) - (v.X[i * 3] as number),
          (s.xs[i * 4 + 1] as number) - (v.X[i * 3 + 1] as number),
          (s.xs[i * 4 + 2] as number) - (v.X[i * 3 + 2] as number),
        ),
      ).sort((a, b) => a - b);
      const q = (f: number) => errs[Math.floor(errs.length * f)] as number;
      console.log(
        `${name}: ${String(shellSteps(p))} steps, f32 against v21 from the same start: median ${q(0.5).toExponential(1)}, p99 ${q(0.99).toExponential(1)}, max ${(errs[errs.length - 1] as number).toExponential(1)}`,
      );
      expect(q(0.5)).toBeLessThan(1e-4);
      expect(q(0.99)).toBeLessThan(5e-3);
      // the shells found
      const arcs = detectArcsCpu(s.xs, p.shellStars);
      console.log(
        `${name}: v21 ${v.arcs.map((a) => `${a.R.toFixed(3)}${a.side > 0 ? '+' : '-'}${a.open.toFixed(2)}`).join(' ')} | engine ${arcs.map((a) => `${a.R.toFixed(3)}${a.side > 0 ? '+' : '-'}${a.open.toFixed(2)}`).join(' ')}`,
      );
      if (chaotic) {
        const found = v.arcs.filter((w) =>
          arcs.some((a) => a.side === w.side && Math.abs(a.R - w.R) < 0.01),
        );
        expect(found.length).toBeGreaterThanOrEqual(Math.ceil(v.arcs.length / 2));
      } else {
        expect(arcs.length).toBe(v.arcs.length);
        arcs.forEach((a, i) => {
          const w = v.arcs[i];
          expect(a.side).toBe(w?.side);
          expect(a.R).toBeCloseTo(w?.R ?? 0, 4);
          expect(a.open).toBeCloseTo(w?.open ?? 0, 2);
        });
      }
      // the dots: all of them, in the hand, and the arcs as 41-point curves with v21's strokes
      const dots = s.dots(
        Uint32Array.from([...Array.from({ length: 24 }, () => 0), ...HAND.dotPool]),
        Float32Array.from(HAND.dotSizes.map((z) => z)),
        84,
      );
      expect(dots.length).toBe(p.shellStars * 8);
      expect(v.dots.length).toBe(p.shellStars);
      const curves = shellCurves(
        arcs,
        p,
        META.strokes,
        v.curves.map((c) => c.k),
      );
      if (chaotic) return;
      expect(curves.length).toBe(v.curves.length);
      curves.forEach((c, i) => {
        const w = v.curves[i];
        expect(c.pts.length).toBe(41);
        expect(c.k).toBe(w?.k);
        for (const j of [0, 20, 40]) {
          // v21's pts2d are in the plate's units (galaxy units, scale 1)
          expect(c.pts[j]?.[0]).toBeCloseTo(w?.pts2d[j]?.[0] ?? 0, 3);
          expect(c.pts[j]?.[1]).toBeCloseTo(w?.pts2d[j]?.[1] ?? 0, 3);
        }
      });
    });
  }
});
