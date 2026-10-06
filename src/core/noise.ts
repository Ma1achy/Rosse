/**
 * Value noise on an integer lattice (ADR 0004, architecture "deliberate divergences" item 5),
 * the CPU twin of `vnoise` in src/shaders/common/math.wgsl.
 *
 * The reference's `vnoise` (app23.js:L74) interpolates `hash2` corners, a `sin` hash that is not
 * the same on every machine (reference notes 20.4). Here a lattice corner (ix, iy) takes its value
 * from pcg4d(ix, iy, seed, noise stream | salt << 8), so it is the same everywhere; the smoothstep
 * interpolation is the reference's. The reference offsets its coordinates by the seed to vary the
 * pattern per galaxy (`vnoise(x + P.seed, …)`); here the seed keys the lattice instead, and `salt`
 * separates the uses (flocculence, patchiness, irregularity, the clumpy ring).
 *
 * A noise field (`NoiseField`) may replace the hashed corners of some salts with a table over a
 * window of the lattice (wrapping outside it). The golden runner gives the engine v21's own corner
 * values this way (tests/golden/compare/v21-noise.ts), so a comparison draws v21's flocculence and
 * wobble pattern, as it draws v21's variation; the engine itself never uses one. The WGSL twin is
 * `vnoise_t` in src/shaders/common/noise-table.wgsl.
 */
import { pcg4d, u32ToUnit } from './rng';
import { Stream } from './streams';

const f = Math.fround;

/** Salts: which use of the noise (the low byte of the stream word is the noise stream). */
export const NoiseSalt = {
  flocc: 1,
  patchy: 2,
  irr: 3,
  ring: 4,
  /** where a flocculent arm's ribbon breaks (curves, app23.js:L780) */
  floccArm: 5,
  /** the dust lanes' patchiness: edge-on midplane, ring, arms (dustLanes, app23.js:L952–969) */
  laneEdge: 6,
  laneRing: 7,
  laneArm: 8,
  /** the hand wobble, x and y (SM, app23.js:L163) */
  wobbleX: 9,
  wobbleY: 10,
} as const;

/** Salts a noise field can hold, and the words of its header per salt. */
export const NOISE_SALTS = 16;
export const NOISE_HEADER_WORDS = 8;

/**
 * A packed noise field: per salt [x0, y0 (i32), w, h (0: no table), offset of the values, 0, 0, 0],
 * then the values (f32 bits) of each table, row by row: the corner (ix, iy) of a salt with a
 * table is values[offset + wrap(iy − y0, h) · w + wrap(ix − x0, w)].
 */
export interface NoiseField {
  u: Uint32Array<ArrayBuffer>;
  f: Float32Array<ArrayBuffer>;
}

/** One salt's table. */
export interface NoiseTable {
  salt: number;
  x0: number;
  y0: number;
  w: number;
  h: number;
  values: ArrayLike<number>;
}

/** Packs tables into a field (no tables: the header only, every salt hashed). */
export function packNoise(tables: readonly NoiseTable[] = []): NoiseField {
  const n = tables.reduce((a, t) => a + t.w * t.h, 0);
  const buf = new ArrayBuffer((NOISE_SALTS * NOISE_HEADER_WORDS + n) * 4);
  const u = new Uint32Array(buf);
  const fl = new Float32Array(buf);
  const i32 = new Int32Array(buf);
  let off = NOISE_SALTS * NOISE_HEADER_WORDS;
  for (const t of tables) {
    const h = t.salt * NOISE_HEADER_WORDS;
    i32[h] = t.x0;
    i32[h + 1] = t.y0;
    u[h + 2] = t.w;
    u[h + 3] = t.h;
    u[h + 4] = off;
    for (let k = 0; k < t.w * t.h; k++) fl[off + k] = t.values[k] ?? 0;
    off += t.w * t.h;
  }
  return { u, f: fl };
}

const wrapI = (i: number, n: number) => ((i % n) + n) % n;

function corner(
  ix: number,
  iy: number,
  seed: number,
  salt: number,
  field?: NoiseField | null,
): number {
  if (field) {
    const h = salt * NOISE_HEADER_WORDS;
    const w = field.u[h + 2] ?? 0;
    if (w > 0) {
      const x0 = (field.u[h] ?? 0) | 0;
      const y0 = (field.u[h + 1] ?? 0) | 0;
      const th = field.u[h + 3] ?? 1;
      const o = field.u[h + 4] ?? 0;
      return field.f[o + wrapI(iy - y0, th) * w + wrapI(ix - x0, w)] ?? 0;
    }
  }
  return u32ToUnit(pcg4d(ix >>> 0, iy >>> 0, seed >>> 0, (Stream.noise | (salt << 8)) >>> 0)[0]);
}

/** Smooth value noise in [0, 1), f32; `field` may replace the corners of some salts. */
export function vnoise(
  x: number,
  y: number,
  seed: number,
  salt: number,
  field?: NoiseField | null,
): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = f(x - xi);
  const yf = f(y - yi);
  const u = f(f(xf * xf) * f(3 - f(2 * xf)));
  const v = f(f(yf * yf) * f(3 - f(2 * yf)));
  const ix = xi | 0;
  const iy = yi | 0;
  const a = corner(ix, iy, seed, salt, field);
  const b = corner(ix + 1, iy, seed, salt, field);
  const c = corner(ix, iy + 1, seed, salt, field);
  const d = corner(ix + 1, iy + 1, seed, salt, field);
  // a + (b - a) u + (c - a) v + (a - b - c + d) u v, evaluated left to right as the WGSL twin
  const t1 = f(f(b - a) * u);
  const t2 = f(f(c - a) * v);
  const t3 = f(f(f(f(f(a - b) - c) + d) * u) * v);
  return f(f(f(a + t1) + t2) + t3);
}
