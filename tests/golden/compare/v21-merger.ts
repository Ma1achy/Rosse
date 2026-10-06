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

interface Oracle {
  setP(P: Record<string, unknown>): void;
  sim(ext?: { X: Float32Array; V: Float32Array }): V21Merger;
  ic(): V21MergerIC;
  galaxyParams(g: number): Record<string, unknown>;
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
  const extFn = sim.replace(icMarker, `if (EXT) { X.set(EXT.X); V.set(EXT.V); } ${icMarker}`);
  const body = `var P = {}, MCACHE = { key: null, res: null }, REC = null, EXT = null, AZ = [], PIT = [];
    ${['clamp', 'mulberry32', 'gauss', 'unit3'].map((n) => cut(src, n)).join('\n')}
    ${extFn}
    ${icFn}
    ${cut(src, 'mergerGalaxyParams')}
    return {
      setP: function (o) { P = o; MCACHE = { key: null, res: null }; },
      sim: function (ext) { EXT = ext || null; MCACHE = { key: null, res: null }; return simulateMerger(); },
      ic: function () { AZ = []; PIT = []; return simulateIC(); },
      galaxyParams: function (g) { return mergerGalaxyParams(g, { TY: [P.mType1 || 'spiral', P.mType2 || 'spiral'] }); },
    };`;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  cached = (new Function(body) as () => Oracle)();
  return cached;
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
export function v21MergerRun(
  root: string,
  P: Params,
  ext?: { X: Float32Array; V: Float32Array },
): V21Merger {
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
