/**
 * The reference's own per-galaxy choices, for the golden comparison (ADR 0013, M4 addendum).
 *
 * v21's `makeVariation` (app23.js:L96–119) draws each galaxy's irregularities from
 * `mulberry32(P.seed · 7919 + 13)`: the arms' pitch, amplitude, phase, length and wiggle, the
 * spurs, the clumps, the dust holes, the lopsidedness and the warp. Its `curves()` (L768–800) then
 * picks each curve's stroke, and which spurs are drawn, from `mulberry32(VAR.strokeSeed)`. The new
 * engine draws all of these from its counter-based streams (ADR 0004), so for the same seed the two
 * engines make two different galaxies of the same kind, with arms at other phases, clumps
 * elsewhere and other strokes: discrete random choices, like the hand (tests/golden/README.md), not
 * structure. To compare structure and pen, the golden runner draws with the reference's choices,
 * as it draws with the reference's hand.
 *
 * Nothing is ported: the functions are cut out of app23.js by name and evaluated unchanged, with
 * `P`, `VAR` and the drawings' metadata (`AT.dots`, `AT.knots`, `AT.strokes.kind`) they read, as
 * tools/camera-vectors.mjs does for the camera.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Params } from '../../../src/core/params';
import type { CurvePicks } from '../../../src/model/curves';
import type { Variation } from '../../../src/model/variation';

/** The fields of the variation that shape the galaxy (the pools are the hand's business). */
export type ReferenceShape = Pick<
  Variation,
  'arms' | 'spurs' | 'clumps' | 'dust' | 'lop' | 'lopA' | 'warp' | 'warpA' | 'spike' | 'strokeSeed'
>;

export interface ReferenceChoices {
  variation: ReferenceShape;
  curvePicks: CurvePicks;
}

interface V21Curve {
  pts: number[][];
  w: number;
  k: number;
}

type V21 = (P: Params, AT: unknown) => { V: ReferenceShape; C: V21Curve[] };

let cached: V21 | null = null;

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

const NAMES = [
  'mulberry32',
  'gauss',
  'hash2',
  'vnoise',
  'clamp',
  'armPhase',
  'incE',
  'strokeIndex',
  'curves',
  'makeVariation',
];

/** v21's makeVariation and curves, evaluated as written. */
export function referenceChoices(
  root: string,
  P: Params,
  meta: {
    dotsSrc: readonly string[];
    dotsSize: readonly number[];
    knotsSrc: readonly string[];
    strokesKind: readonly string[];
  },
): ReferenceChoices {
  if (!cached) {
    const src = readFileSync(join(root, 'assets/reference/rosse-source/app23.js'), 'utf8');
    const body = `var P, AT, VAR;
      ${NAMES.map((n) => cut(src, n)).join('\n')}
      return function (p, at) { P = p; AT = at; VAR = makeVariation(); return { V: VAR, C: curves() }; };`;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    cached = (new Function(body) as () => V21)();
  }
  const AT = {
    dots: { src: meta.dotsSrc, size: meta.dotsSize },
    knots: { src: meta.knotsSrc },
    strokes: { kind: meta.strokesKind },
  };
  const { V, C } = cached(P, AT);
  // which spurs v21 drew: a spur's curve starts at radius R0 (L782–783)
  const spurs = V.spurs.map((sp) =>
    C.some(
      (c) =>
        c.w === 0.7 && Math.abs(Math.hypot(c.pts[0]?.[0] ?? 0, c.pts[0]?.[1] ?? 0) - sp.R0) < 1e-9,
    ),
  );
  return {
    variation: {
      arms: V.arms,
      spurs: V.spurs,
      clumps: V.clumps,
      dust: V.dust,
      lop: V.lop,
      lopA: V.lopA,
      warp: V.warp,
      warpA: V.warpA,
      spike: V.spike,
      strokeSeed: V.strokeSeed,
    },
    curvePicks: { strokes: C.map((c) => c.k), spurs },
  };
}
