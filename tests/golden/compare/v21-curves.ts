/**
 * v21's own stroke choices, for the golden comparison (ADR 0015 item 5, extended in M4).
 *
 * The golden runner draws with v21's variation (./v21.ts), so both engines draw the same galaxy.
 * The line-work adds one more set of discrete random choices: v21's `curves()` (app23.js:L768–800)
 * picks each curve's stroke (a row of the strokes sheet: plain, beaded, spurred, broken…) and which
 * spurs are drawn from `mulberry32(VAR.strokeSeed)`, where the new engine uses its counter streams
 * (ADR 0004). A beaded arm and a plain one carry different ink and pen weight, so, as with the
 * hand, the comparison draws with v21's choices and only the dots differ.
 *
 * Nothing is ported: `curves()` and what it calls are cut out of app23.js by name and evaluated
 * unchanged, with `P`, `VAR` (the replayed variation) and `AT.strokes.kind`, as
 * tools/camera-vectors.mjs does for the camera. The curves' shapes are not used; only `k` per curve,
 * and which spurs were drawn.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Params } from '../../../src/core/params';
import type { CurvePicks } from '../../../src/model/curves';
import type { Variation } from '../../../src/model/variation';

interface V21Curve {
  pts: number[][];
  w: number;
  k: number;
}

type V21Curves = (P: Params, VAR: Variation, AT: unknown) => V21Curve[];

let cached: V21Curves | null = null;

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
  'hash2',
  'vnoise',
  'clamp',
  'armPhase',
  'incE',
  'strokeIndex',
  'curves',
];

/** v21's stroke per curve, in curve order, and which of its spurs it drew. */
export function v21CurvePicks(
  root: string,
  P: Params,
  V: Variation,
  strokesKind: readonly string[],
): CurvePicks {
  if (!cached) {
    const src = readFileSync(join(root, 'assets/reference/rosse-source/app23.js'), 'utf8');
    const body = `var P, AT, VAR;
      ${NAMES.map((n) => cut(src, n)).join('\n')}
      return function (p, v, at) { P = p; VAR = v; AT = at; return curves(); };`;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    cached = (new Function(body) as () => V21Curves)();
  }
  const C = cached(P, V, { strokes: { kind: strokesKind } });
  // a spur's curve starts at radius R0 (app23.js:L782–783)
  const spurs = V.spurs.map((sp) =>
    C.some(
      (c) =>
        c.w === 0.7 && Math.abs(Math.hypot(c.pts[0]?.[0] ?? 0, c.pts[0]?.[1] ?? 0) - sp.R0) < 1e-9,
    ),
  );
  return { strokes: C.map((c) => c.k), spurs };
}
