/**
 * v21's own lensing, for the golden comparison and the solver tests (ADR 0050, as ADR 0015 and
 * 0021 do for the variation, the strokes and the parts).
 *
 * Nothing is ported: `lensModel` and `lensSolver` (app23.js:L594–629) are cut out of app23.js by
 * name and evaluated unchanged, as ./v21-curves.ts does for `curves()`. They are the oracle of
 * tests/unit/lens.test.ts: image positions, Jacobians and magnifications, on the same source
 * points. `v21LensPlan` replays the discrete choices `lensSprites10` makes (L684–707) from its
 * own sequential stream `mulberry32(seed · 613 + 5)`, line for line, so the golden runner can
 * hand them to the engine (`LensPicks`): the cluster's layout, each source's options, the member
 * galaxies' drawings.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Params } from '../../../src/core/params';
import type { Halo, LensPicks, LensPickSource } from '../../../src/sim/lens';
import { mulberry32 } from './v21';

export interface V21Image {
  x: number;
  y: number;
  J: [number, number, number, number];
  mu: number;
}

export interface V21Solver {
  images(px: number, py: number): V21Image[];
  R: number;
  cell: number;
}

export interface V21Model {
  alpha(x: number, y: number): [number, number];
  psi(x: number, y: number): number;
  halos: (Halo & { member?: boolean })[];
}

interface Oracle {
  model(P: Params, f: number): V21Model;
  solver(model: V21Model, R: number, G: number): V21Solver;
}

let cached: Oracle | null = null;

function cut(src: string, name: string): string {
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

/** v21's `lensModel` and `lensSolver`, evaluated as written. */
export function v21LensOracle(root: string): Oracle {
  if (!cached) {
    const src = readFileSync(join(root, 'assets/reference/rosse-source/app23.js'), 'utf8');
    const body = `var P;
      ${['mulberry32', 'clamp', 'lensModel', 'lensSolver'].map((n) => cut(src, n)).join('\n')}
      return {
        model: function (p, f) { P = p; return lensModel(f); },
        solver: function (m, R, G) { return lensSolver(m, R, G); }
      };`;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    cached = (new Function(body) as () => Oracle)();
  }
  return cached;
}

export interface V21LensPlan {
  picks: LensPicks;
  /** how many random draws the stream made, for the test of the replay */
  n: number;
}

const GALAXY_OPTS = (r: () => number) => ({
  arms: 2 + Math.floor(r() * 2),
  incl: 20 + 30 * r(),
  pa: r() * 180,
});

/**
 * The choices `lensSprites10` makes from `mulberry32(seed · 613 + 5)` (L685) and `lensModel` from
 * `mulberry32(seed · 431 + 9)` (L594–598), as the engine's `LensPicks`. The quasar's star draws
 * (lensStar) come after these and are continuous; its drawing pick waits for the stars of M7.
 *
 * `wholeTypes` is the `whole` sheet's `type` column: the drawing and member picks index into it.
 */
export function v21LensPlan(P: Params, root: string, wholeTypes: readonly string[]): V21LensPlan {
  const oracle = v21LensOracle(root);
  const model = oracle.model(P, 1);
  const r = mulberry32(P.seed * 613 + 5);
  const picks: LensPicks = { sources: [] };
  const sources = picks.sources as LensPickSource[];
  const members = model.halos.filter((h) => h.member);
  if (P.lensCluster) picks.halos = members.map((h) => ({ ...h }));
  let n = 0;
  const draw = () => {
    n++;
    return r();
  };
  if (P.lensSource === 'quasar') {
    // lensStar's draws come first and are continuous; the host's options are fixed (L691)
    sources.push({ opts: {} });
  } else if (P.lensSource === 'drawing') {
    const pool: number[] = [];
    wholeTypes.forEach((t, i) => {
      if (t.startsWith('galaxy')) pool.push(i);
    });
    picks.drawing = pool[Math.floor(draw() * pool.length)] ?? 0;
  } else if (P.lensCluster) {
    const nS = 6 + Math.floor(draw() * 4);
    const thE = P.lensR;
    for (let i = 0; i < nS; i++) {
      const a = draw() * 6.2832;
      const d = thE * (0.08 + 1.5 * Math.pow(draw(), 0.8));
      const sz = thE * (0.14 + 0.2 * draw());
      sources.push({
        a,
        d,
        sz,
        opts: {
          arms: 1 + Math.floor(draw() * 3),
          bulge: 0.1 + 0.3 * draw(),
          flocc: draw() < 0.3 ? 0.5 : 0,
          incl: draw() * 60,
          pa: draw() * 180,
        },
      });
    }
    const smooth: number[] = [];
    wholeTypes.forEach((t, i) => {
      if (t.startsWith('smooth')) smooth.push(i);
    });
    picks.members = members.map(() => smooth[Math.floor(draw() * smooth.length)] ?? 0);
  } else {
    const o = GALAXY_OPTS(draw);
    sources.push({ opts: o });
  }
  if (P.lensDouble) sources.push({ opts: {} });
  return { picks, n };
}
