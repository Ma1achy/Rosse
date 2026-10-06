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
import type { RingKnotPick } from '../../../src/model/clumps';
import type { DustPicks } from '../../../src/model/lanes';
import type { Variation } from '../../../src/model/variation';

interface V21Curve {
  pts: number[][];
  w: number;
  k: number;
}

/** v21's dust lanes (dustLanes, app23.js:L944–985): hatches [x, y, angle, length] and lane points. */
export interface V21Lanes {
  strokes: number[][];
  pts: number[][];
}

type V21Eval = (
  P: Params,
  VAR: Variation,
  AT: unknown,
  scale: number,
) => {
  curves: V21Curve[];
  lanes: () => V21Lanes;
  /** dustLanes() again, recording every number its stream gave (uniforms and Gaussians) */
  recordLanes: () => number[];
  mulberry32: (a: number) => () => number;
  gauss: (r: () => number) => number;
};

let cached: V21Eval | null = null;

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
  'ci',
  'paR',
  'azR',
  'project',
  'dustLanes',
  'hash2',
  'vnoise',
  'clamp',
  'armPhase',
  'incE',
  'strokeIndex',
  'curves',
];

/** v21's own curves() and dustLanes(), evaluated as written (tests also read them). */
export function v21Lines(
  root: string,
  P: Params,
  V: Variation,
  strokesKind: readonly string[],
  zoom = 1,
): ReturnType<V21Eval> {
  if (!cached) {
    const src = readFileSync(join(root, 'assets/reference/rosse-source/app23.js'), 'utf8');
    const body = `var P, AT, VAR, VIEW = { W: 800, cx: 400, cy: 400, scale: 84 };
      var LANES = { key: null, v: { strokes: [], pts: [] } };
      ${NAMES.map((n) => cut(src, n)).join('\n')}
      // recording: every number a stream gives, a Gaussian as gauss() returns it (not its two
      // uniforms); dustLanes has one stream, so this is its sequence in the order it is used
      var REC = null, IN_GAUSS = false, mulberry32_ = mulberry32, gauss_ = gauss;
      mulberry32 = function (a) { var f = mulberry32_(a); return function () { var x = f(); if (REC && !IN_GAUSS) REC.push(x); return x; }; };
      gauss = function (r) { IN_GAUSS = true; var x = gauss_(r); IN_GAUSS = false; if (REC) REC.push(x); return x; };
      return function (p, v, at, scale) {
        P = p; VAR = v; AT = at; VIEW.scale = scale; LANES = { key: null, v: { strokes: [], pts: [] } };
        return {
          curves: curves(),
          lanes: function () { return dustLanes(); },
          recordLanes: function () { LANES = { key: null, v: { strokes: [], pts: [] } }; REC = []; try { dustLanes(); return REC; } finally { REC = null; } },
          mulberry32: mulberry32_,
          gauss: gauss_,
        };
      };`;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    cached = (new Function(body) as () => V21Eval)();
  }
  return cached(P, V, { strokes: { kind: strokesKind } }, 84 * zoom);
}

/** v21's stroke per curve, in curve order, and which of its spurs it drew. */
export function v21CurvePicks(
  root: string,
  P: Params,
  V: Variation,
  strokesKind: readonly string[],
): CurvePicks {
  const C = v21Lines(root, P, V, strokesKind).curves;
  // a spur's curve starts at radius R0 (app23.js:L782–783)
  const spurs = V.spurs.map((sp) =>
    C.some(
      (c) =>
        c.w === 0.7 && Math.abs(Math.hypot(c.pts[0]?.[0] ?? 0, c.pts[0]?.[1] ?? 0) - sp.R0) < 1e-9,
    ),
  );
  // the outline arcs and the tidal tail are v21's last curves (app23.js:L789–799): their angles
  // are drawn from the same stream as the strokes, so they are v21's choices too
  const angle = (p: number[] | undefined) => Math.atan2(p?.[1] ?? 0, p?.[0] ?? 0);
  const tail = P.tail > 0.05 ? C[C.length - 1] : undefined;
  const nOut = P.outline > 0.05 ? 2 : 0;
  const outEnd = C.length - (tail ? 1 : 0);
  const outline = C.slice(outEnd - nOut, outEnd).map((c) => {
    const st = angle(c.pts[0]);
    const end = angle(c.pts[c.pts.length - 1]);
    const len = (((end - st) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    return { st, len };
  });
  return {
    strokes: C.map((c) => c.k),
    spurs,
    ...(nOut ? { outline } : {}),
    ...(tail ? { tail: angle(tail.pts[0]) } : {}),
  };
}

/**
 * v21's dust choices (ADR 0018): the numbers of dustLanes' stream in the order it used them
 * (app23.js:L951), each hatch's pen line from `rrL` (L1047–1048) and each carving line's from `rd`
 * (L201–203). The hatches' screen positions are not used: the engine lays them out from the same
 * numbers in the galaxy frame.
 */
export function v21DustPicks(
  root: string,
  P: Params,
  V: Variation,
  strokesKind: readonly string[],
  nPen: number,
): DustPicks {
  const L = v21Lines(root, P, V, strokesKind);
  const lane = L.recordLanes();
  const hatches = L.lanes().strokes.length;
  const rrL = L.mulberry32(P.seed * 919 + 3);
  const rd = L.mulberry32(P.seed * 431 + 9);
  return {
    lane,
    tiles: Array.from({ length: hatches }, () => Math.floor(rrL() * nPen)),
    lines: Array.from({ length: 3 }, () => Math.floor(rd() * nPen)),
  };
}

/**
 * v21's ring-knot clusters: the ring-knot block of v21's `generate()` (app23.js:L282–288, "star-forming
 * knots strung along the ring"), cut out of app23.js and evaluated as written with v21's own
 * `mulberry32` and `gauss`, its marks recorded by stubs of `inst` and `rstar`. Nothing is ported: the
 * cluster's centre is where the block calls `rstar` (the star at the centre, `project` being the
 * identity here), and its marks are the `inst` calls before that.
 */
export function v21RingKnots(root: string, P: Params, V: Variation): RingKnotPick[] {
  if (!(P.ring > 0.1 && !P.merger)) return [];
  const src = readFileSync(join(root, 'assets/reference/rosse-source/app23.js'), 'utf8');
  const from = src.indexOf('star-forming knots strung along the ring */');
  if (from < 0) throw new Error('the ring-knot block was not found in app23.js');
  const start = src.lastIndexOf('\n', from) + 1;
  const end = src.indexOf('\n  // star-forming clumps', from);
  if (end < 0) throw new Error('the end of the ring-knot block was not found in app23.js');
  const block = src.slice(start, end);
  const body = `${cut(src, 'mulberry32')}\n${cut(src, 'gauss')}\n
    var out = { knots: [], young: [] }, PEN = { dot: 1 };
    var clusters = [], marks = 0;
    function project(p) { return [p[0], p[1]]; }
    function simple() { return 0; }
    function dotSprite() { return 0; }
    function inst() { marks++; }
    function rstar(x, y) { clusters.push({ x: x, y: y, marks: marks }); marks = 0; }
    ${block}
    return clusters;`;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function('P', 'VAR', body) as (
    p: Params,
    v: { knotPool: number[]; dotPool: number[] },
  ) => { x: number; y: number; marks: number }[];
  return run(P, V).map((c) => ({
    t: Math.atan2(c.y, c.x),
    R: Math.hypot(c.x, c.y),
    count: c.marks,
  }));
}
