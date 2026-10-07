/**
 * v21's own merger, for the tests and the golden comparison (ADR 0015, Q13, ADR 0040).
 *
 * `simulateMerger` and `mergerGalaxyParams` (app23.js:L304–389) are cut out of app23.js by name
 * and evaluated as written, with v21's globals around them (the same method as ./v21-parts.ts and
 * tools/camera-vectors.mjs). Three uses:
 *
 * - `v21MergerPicks`: the discrete choices the new engine makes by its own draws, replayed from v21's
 *   stream so the goldens draw the same galaxies: each galaxy's spin azimuth and log-spiral pitch
 *   (found by running v21's initial conditions and reading them back), and `mergerGalaxyParams`'
 *   three draws (the arms' pitch, the Sérsic index, the flattening). The stars themselves are
 *   continuous draws and are compared by distribution (tests/unit/merger-distribution.test.ts);
 * - `v21MergerIC`: v21's initial conditions as arrays, for those distribution tests;
 * - `v21MergerRun`: v21's integration, optionally from the engine's own initial conditions, so that
 *   the engine's f32 stars can be measured against v21's f64 integrator on identical starts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Params } from '../../../src/core/params';
import type { GalaxyPicks, MergerPicks } from '../../../src/sim/merger';

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

/** v21's result of `simulateMerger()` (the fields these tests read). */
export interface V21Merger {
  X: Float32Array;
  G: Uint8Array;
  R0: Float32Array;
  DX: Float32Array;
  DY: Float32Array;
  C: number[][];
  N: number;
  M: [number, number];
  A: [number, number];
  frames: Float32Array[];
  cframes: number[][][];
  fut: Float32Array[];
  cfut: number[][][];
  horizon: number;
  RMAX: [number, number];
  TY: string[];
  SZ: number[];
}

/** v21's initial conditions, before the integration. */
export interface V21MergerIC {
  X: Float32Array;
  V: Float32Array;
  G: Uint8Array;
  R0: Float32Array;
  DX: Float32Array;
  DY: Float32Array;
  C: number[][];
  N: number[];
  t0: number;
  az: [number, number];
  pitch: [number, number];
}

/** What v21's `mergerSprites()` makes at a view (before render()'s thinning). */
export interface V21MergerView {
  /** `MS.sc`, plate px per galaxy unit, and `MS.scale` */
  sc: number;
  scale: number;
  /** the lists of marks: [x, y, tile, alpha, m0…m3] */
  disc: number[][];
  young: number[][];
  knots: number[][];
  stars: number[][];
  rstars: number[][];
  /** the screen positions of the stars (2 per star) */
  scr: Float32Array;
  /** the 49 × 49 grid of galaxy g (`tidal(g, false)` at every vertex, render() L1242–1245) */
  grid(g: number): Float64Array;
  /** `tidal(g, flip)(x, y)` */
  tidal(g: number, flip: boolean, x: number, y: number): [number, number];
}

interface Oracle {
  setP(P: Record<string, unknown>): void;
  sim(ext?: MergerStart): V21Merger;
  ic(): V21MergerIC;
  galaxyParams(g: number): Record<string, unknown>;
  view(p: Record<string, unknown>, ext: MergerStart | null, zoom: number): V21MergerView;
}

let cached: Oracle | null = null;

function oracle(root: string): Oracle {
  if (cached) return cached;
  const src = readFileSync(join(root, 'assets/reference/rosse-source/app23.js'), 'utf8');
  const sim = cut(src, 'simulateMerger');
  // the initial conditions only, recording the spin azimuths and the log-spiral pitches
  const icMarker = 'var dt = 0.012, T = P.mStage - t0';
  const azMarker = 'az = r() * 6.28';
  const pitchMarker = 'pitch = 0.3 + 0.4 * r()';
  for (const m of [icMarker, azMarker, pitchMarker])
    if (!sim.includes(m)) throw new Error(`simulateMerger no longer contains ${m}`);
  const record = sim
    .replace(azMarker, 'az = (AZ[g] = r() * 6.28)')
    .replace(pitchMarker, 'pitch = (PIT[g] = 0.3 + 0.4 * r())');
  const icFn = record
    .replace('function simulateMerger', 'function simulateIC')
    .replace(
      icMarker,
      `return { X: X.slice(), V: V.slice(), G: G.slice(), R0: R0.slice(), DX: DX.slice(), DY: DY.slice(), C: C.map(function (c) { return c.slice(); }), N: N, t0: t0, az: AZ.slice(), pitch: PIT.slice() }; ${icMarker}`,
    );
  // the integration, from outside initial conditions when given
  const extFn = sim.replace(
    icMarker,
    `if (EXT) { X.set(EXT.X); V.set(EXT.V); if (EXT.R0) { R0.set(EXT.R0); DX.set(EXT.DX); DY.set(EXT.DY); } } ${icMarker}`,
  );
  const body = `var P = {}, MCACHE = { key: null, res: null }, REC = null, EXT = null, AZ = [], PIT = [];
    ${['clamp', 'mulberry32', 'gauss', 'unit3'].map((n) => cut(src, n)).join('\n')}
    ${extFn}
    ${icFn}
    ${cut(src, 'mergerGalaxyParams')}
    ${['Rm', 'Sm', 'mul', 'chain', 'dotSprite', 'simple', 'paR', 'azR', 'ci', 'snapAt', 'frameOf', 'unionFrame', 'mergerSprites'].map((n) => cut(src, n)).join('\n')}
    var VIEW = { W: 800, cx: 400, cy: 400, scale: 84 }, PEN = { line: 2.4, dot: 1 }, VAR = null, AT = null, SSm_dummy = 0;
    function inst(list, atlas, x, y, tile, alpha, M) { list.push([x, y, tile, alpha, M[0], M[1], M[2], M[3]]); }
    return {
      view: function (p, ext, zoom) {
        P = p; EXT = ext; MCACHE = { key: null, res: null };
        VAR = { dotPool: p.__pool, knotPool: p.__knots, spike: p.__spike };
        AT = { dots: { size: p.__size }, stars: { n: p.__starN }, sstars: { kind: ['outline', 'plain', 'plain'] } };
        PEN.line = p.pen; PEN.dot = 0.75 + 0.1 * p.pen; VIEW.scale = 84 * zoom;
        var MS = mergerSprites();
        var GN = 48;
        return {
          sc: MS.sc, scale: MS.scale, disc: MS.S.disc, young: MS.S.young, knots: MS.S.knots, stars: MS.S.stars, rstars: MS.S.rstars,
          scr: null,
          grid: function (g) { var out = new Float64Array((GN + 1) * (GN + 1) * 2), t = MS.tidal(g, false);
            for (var gy = 0; gy <= GN; gy++) for (var gx = 0; gx <= GN; gx++) { var w = t(gx / GN - 0.5, gy / GN - 0.5), o = (gy * (GN + 1) + gx) * 2; out[o] = w[0]; out[o + 1] = w[1]; } return out; },
          tidal: function (g, flip, x, y) { return MS.tidal(g, flip)(x, y); },
        };
      },
      setP: function (o) { P = o; MCACHE = { key: null, res: null }; },
      sim: function (ext) { EXT = ext || null; MCACHE = { key: null, res: null }; return simulateMerger(); },
      ic: function () { AZ = []; PIT = []; return simulateIC(); },
      galaxyParams: function (g) { return mergerGalaxyParams(g, { TY: [P.mType1 || 'spiral', P.mType2 || 'spiral'] }); },
    };`;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  cached = (new Function(body) as () => Oracle)();
  return cached;
}

/**
 * Starts to give v21's integrator in place of its own: positions and velocities, and (for the tidal
 * map and the classes) each star's initial disc coordinates and radius.
 */
export interface MergerStart {
  X: Float32Array;
  V: Float32Array;
  R0?: Float32Array;
  DX?: Float32Array;
  DY?: Float32Array;
}

export interface V21MergerHand {
  dotPool: number[];
  knotPool: number[];
  spike: number;
  dotSizes: number[];
  nStarTiles: number;
}

/** v21's `mergerSprites()` for these parameters, a camera zoom and (optionally) the engine's starts. */
export function v21MergerView(
  root: string,
  P: Params,
  hand: V21MergerHand,
  zoom = 1,
  ext: MergerStart | null = null,
): V21MergerView {
  return oracle(root).view(
    {
      ...P,
      __pool: hand.dotPool,
      __knots: hand.knotPool,
      __spike: hand.spike,
      __size: hand.dotSizes,
      __starN: hand.nStarTiles,
    },
    ext,
    zoom,
  );
}

/** v21's parameters for an oracle call: the full set, with `P.seed` and the merger's. */
function setup(root: string, P: Params): Oracle {
  const o = oracle(root);
  o.setP({ ...P });
  return o;
}

/** v21's initial conditions for these parameters. */
export function v21MergerIC(root: string, P: Params): V21MergerIC {
  return setup(root, P).ic();
}

/** v21's integration; `ext` replaces the initial conditions (same star count) with the engine's. */
export function v21MergerRun(root: string, P: Params, ext?: MergerStart): V21Merger {
  return setup(root, P).sim(ext);
}

/** v21's `mergerGalaxyParams(g)` for these parameters. */
export function v21GalaxyParams(root: string, P: Params, g: 0 | 1): Record<string, unknown> {
  return setup(root, P).galaxyParams(g);
}

/** `mulberry32` as v21 has it. */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `mergerGalaxyParams`' draws: `rg = mulberry32(seed · 97 + g · 131)`, its first two numbers. */
export function v21GalaxyPicks(P: Params, g: 0 | 1): GalaxyPicks {
  const rg = mulberry32(P.seed * 97 + g * 131);
  const u1 = rg();
  const u2 = rg();
  return { pitchDeg: Math.round(14 + 18 * u1), sersicN: 3 + u1, bulgeFlat: 0.7 + 0.3 * u2 };
}

/** The picks the goldens draw with: v21's own, replayed. */
export function v21MergerPicks(root: string, P: Params): MergerPicks {
  const ic = v21MergerIC(root, P);
  return {
    az: ic.az,
    pitch: ic.pitch,
    galaxy: [v21GalaxyPicks(P, 0), v21GalaxyPicks(P, 1)],
  };
}
