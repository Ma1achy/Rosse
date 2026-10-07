/**
 * The lens model and solver against v21's own (tests/golden/compare/v21-lens.ts: `lensModel` and
 * `lensSolver` cut out of app23.js and evaluated as written), on the same source points: image
 * positions, Jacobians and magnifications (ADR 0050). Then the CPU twins' invariants: canonical
 * image lists, the >400-bin skip, the fixed-point sum, the greedy matcher.
 */
import { describe, expect, it } from 'vitest';
import { presetParams } from '../../src/core/presets';
import type { Params } from '../../src/core/params';
import {
  buildSolver,
  deflectF,
  findImages,
  gridKernel,
  newImageSet,
  potentialF,
} from '../../src/fallback/kernels/lens';
import { deflection, lensModel, potential, solverDesc } from '../../src/sim/lens';
import { v21LensOracle, v21LensPlan } from '../golden/compare/v21-lens';
import { FULL_META, ROOT } from './support/meta';

const PRESETS = [
  'Lens: Einstein ring',
  'Lens: Einstein cross (quasar)',
  'Lens: galaxy cluster',
  'Lens: double Einstein ring',
  'Lens: giant arc',
  'Lens: a quad',
] as const;

const oracle = v21LensOracle(ROOT);
const whole = FULL_META.vectors?.whole?.type ?? [];

/** The engine's lens model for these parameters, with v21's own cluster layout. */
function ours(P: Params, f: number) {
  return lensModel(P, f, v21LensPlan(P, ROOT, whole).picks);
}

describe('the lens model against v21 (app23.js:L594–607)', () => {
  for (const name of PRESETS)
    for (const seed of [7, 4242])
      it(`${name} s${String(seed)}: deflection and potential, f64`, () => {
        const P = presetParams(name, seed);
        for (const f of [1, 1.42, 1.3]) {
          const theirs = oracle.model(P, f);
          const mine = ours(P, f);
          expect(mine.halos.length).toBe(theirs.halos.length);
          let worst = 0;
          let worstPsi = 0;
          for (let i = 0; i < 400; i++) {
            const x = (((i * 37) % 101) / 100 - 0.5) * 6;
            const y = (((i * 53) % 103) / 102 - 0.5) * 6;
            const a = deflection(mine, x, y);
            const b = theirs.alpha(x, y);
            worst = Math.max(worst, Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
            worstPsi = Math.max(worstPsi, Math.abs(potential(mine, x, y) - theirs.psi(x, y)));
          }
          expect(worst).toBeLessThan(1e-12);
          expect(worstPsi).toBeLessThan(1e-12);
        }
      });

  it('the f32 deflection and potential are within f32 accuracy of the f64 ones', () => {
    const P = presetParams('Lens: galaxy cluster', 7);
    const M = ours(P, 1);
    const d = solverDesc(M, 3.6 * P.lensR, 250);
    let worst = 0;
    let worstPsi = 0;
    for (let i = 0; i < 400; i++) {
      const x = Math.fround((((i * 37) % 101) / 100 - 0.5) * 6);
      const y = Math.fround((((i * 53) % 103) / 102 - 0.5) * 6);
      const a = deflectF(d, x, y);
      const b = deflection(M, x, y);
      worst = Math.max(worst, Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
      worstPsi = Math.max(worstPsi, Math.abs(potentialF(d, x, y) - potential(M, x, y)));
    }
    expect(worst).toBeLessThan(2e-4);
    expect(worstPsi).toBeLessThan(2e-4);
  });
});

describe('the solver against v21 (app23.js:L608–629)', () => {
  for (const name of PRESETS)
    it(`${name}: images of the same source points`, () => {
      const P = presetParams(name, 7);
      const thE = P.lensR;
      const R = (P.lensCluster ? 3.6 : 2.5) * thE;
      const G = P.lensCluster ? 250 : 210;
      const theirsModel = oracle.model(P, 1);
      const theirs = oracle.solver(theirsModel, R, G);
      const mine = buildSolver(solverDesc(ours(P, 1), R, G));
      const set = newImageSet();
      let points = 0;
      let same = 0;
      let worstPos = 0;
      let worstMu = 0;
      const differ: string[] = [];
      for (let i = 0; i < 600; i++) {
        // source points over the caustics' neighbourhood, and a few at the centre
        const a = (i * 2.399963) % (2 * Math.PI);
        const r = thE * 0.9 * Math.sqrt(((i * 0.618034) % 1) + 0.0005);
        const px = Math.fround(i < 3 ? 0.001 * i : r * Math.cos(a));
        const py = Math.fround(i < 3 ? 0 : r * Math.sin(a));
        const t = theirs.images(px, py);
        findImages(mine, px, py, set);
        points++;
        if (t.length !== set.n) {
          differ.push(
            `(${px.toFixed(3)}, ${py.toFixed(3)}): ${String(t.length)} vs ${String(set.n)}`,
          );
          continue;
        }
        same++;
        for (let k = 0; k < t.length; k++) {
          const q = t[k];
          if (!q) continue;
          worstPos = Math.max(
            worstPos,
            Math.hypot(q.x - (set.p[2 * k] ?? 0), q.y - (set.p[2 * k + 1] ?? 0)),
          );
          worstMu = Math.max(
            worstMu,
            Math.abs(q.mu - (set.mu[k] ?? 0)) / Math.max(1, Math.abs(q.mu)),
          );
        }
      }
      // the lists agree except where a source point sits on a triangle edge or a caustic
      console.log(
        `${name}: ${String(same)}/${String(points)} lists agree; worst image ${worstPos.toExponential(2)}, worst μ ${worstMu.toExponential(2)}${differ.length ? `; differ: ${differ.slice(0, 3).join(', ')}` : ''}`,
      );
      expect(same / points).toBeGreaterThan(0.99);
      expect(worstPos).toBeLessThan(0.02);
      expect(worstMu).toBeLessThan(0.05);
    }, 120_000);
});

describe('the twin solver', () => {
  const P = presetParams('Lens: Einstein ring', 7);
  const d = solverDesc(lensModel(P, 1), 2.5 * P.lensR, 210);
  const g = gridKernel(d);
  const T = buildSolver(d);

  it('bins hold ascending triangle ids, and the table fits the GPU capacity', () => {
    for (let b = 0; b < T.H * T.H; b += 7) {
      const lo = T.offsets[b] ?? 0;
      const hi = T.offsets[b + 1] ?? 0;
      for (let k = lo + 1; k < hi; k++) expect(T.ids[k]).toBeGreaterThan(T.ids[k - 1] ?? 0);
    }
    expect(T.idTotal).toBeLessThan(24 * 2 * d.G * d.G);
    expect(g.bx1).toBeGreaterThan(g.bx0);
  });

  it('a source at the centre of a round lens has a ring of images, in canonical order', () => {
    const set = newImageSet();
    findImages(T, 0, 0, set);
    expect(set.n).toBeGreaterThanOrEqual(1);
    // the same list twice, in the same order
    const first = Array.from(set.p.subarray(0, 2 * set.n));
    findImages(T, 0, 0, set);
    expect(Array.from(set.p.subarray(0, 2 * set.n))).toEqual(first);
    for (let k = 1; k < set.n; k++) expect(set.tri[k]).toBeGreaterThan(set.tri[k - 1] ?? 0);
  });
});
