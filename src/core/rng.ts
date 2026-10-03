/**
 * Seeded random numbers, CPU side (ADR 0004).
 *
 * A counter-based generator: every draw is a pure function of (seed, stream, index, draw), so any
 * draw can be computed without generating the ones before it, on any thread, in any order. The
 * hash is `pcg4d` (Jarzynski and Olano, "Hash Functions for GPU Rendering", JCGT 9(3), 2020),
 * implemented with 32-bit integer operations only (`Math.imul`, `>>> 0`), so it gives exactly the
 * same bits as its WGSL twin in src/shaders/common/rng.wgsl. Both are checked against the shared
 * vectors in tests/vectors/rng.json, in Node (tests/unit/rng.test.ts) and on the GPU
 * (tests/gpu/rng.ts).
 *
 * - `randU32` is word x of pcg4d(seed, stream, index, draw).
 * - `randF32` is `f32(u >> 8) * 2^-24`: a uniform in [0, 1) with 24 bits, exact in f32.
 * - `randGauss` is Box–Muller on draws `draw` and `draw + 1`, in f32 (every step through
 *   `Math.fround`). It uses `log`, `sqrt` and `cos`, which WGSL does not require to be correctly
 *   rounded, so it matches the GPU within a tolerance, not bit for bit (ADR 0004, L1).
 *
 * Stream ids are named in ./streams.ts.
 */

const f = Math.fround;

/** Four 32-bit words, as unsigned numbers. */
export type U32x4 = [number, number, number, number];

/** The pcg4d hash of four 32-bit words. Inputs are taken modulo 2^32. */
export function pcg4d(a: number, b: number, c: number, d: number): U32x4 {
  // v = v * 1664525u + 1013904223u
  let x = (Math.imul(a, 1664525) + 1013904223) >>> 0;
  let y = (Math.imul(b, 1664525) + 1013904223) >>> 0;
  let z = (Math.imul(c, 1664525) + 1013904223) >>> 0;
  let w = (Math.imul(d, 1664525) + 1013904223) >>> 0;
  x = (x + Math.imul(y, w)) >>> 0;
  y = (y + Math.imul(z, x)) >>> 0;
  z = (z + Math.imul(x, y)) >>> 0;
  w = (w + Math.imul(y, z)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  y = (y ^ (y >>> 16)) >>> 0;
  z = (z ^ (z >>> 16)) >>> 0;
  w = (w ^ (w >>> 16)) >>> 0;
  x = (x + Math.imul(y, w)) >>> 0;
  y = (y + Math.imul(z, x)) >>> 0;
  z = (z + Math.imul(x, y)) >>> 0;
  w = (w + Math.imul(y, z)) >>> 0;
  return [x, y, z, w];
}

/** A random u32 for (seed, stream, index, draw). */
export function randU32(seed: number, stream: number, index: number, draw: number): number {
  return pcg4d(seed, stream, index, draw)[0];
}

/** 2^-24. */
const INV_2_24 = 1 / 16777216;

/** Maps a u32 to a uniform f32 in [0, 1): `f32(u >> 8) * 2^-24` (exact). */
export function u32ToUnit(u: number): number {
  return (u >>> 8) * INV_2_24;
}

/** A uniform f32 in [0, 1) for (seed, stream, index, draw). */
export function randF32(seed: number, stream: number, index: number, draw: number): number {
  return u32ToUnit(randU32(seed, stream, index, draw));
}

/** 2π in f32. */
const TWO_PI = f(2 * Math.PI);
/** π in f32. */
const PI = f(Math.PI);

/**
 * A standard normal f32 from draws `draw` and `draw + 1` (Box–Muller, cosine branch).
 * `1 - u1` lies in (0, 1], so the logarithm is finite. cos(2π u2) is computed as
 * −cos(2π u2 − π), so the argument stays in [−π, π), where WGSL bounds `cos`'s error.
 */
export function randGauss(seed: number, stream: number, index: number, draw: number): number {
  const u1 = randF32(seed, stream, index, draw);
  const u2 = randF32(seed, stream, index, (draw + 1) >>> 0);
  const r = f(Math.sqrt(f(f(-2) * f(Math.log(f(1 - u1))))));
  return f(r * f(-Math.cos(f(f(TWO_PI * u2) - PI))));
}

/**
 * A key fixes (seed, stream, index); `next()` walks the draw counter. A convenience for CPU code
 * that takes several draws per sample; the GPU twin keeps the counter in a local variable.
 */
export class Draws {
  draw = 0;
  constructor(
    readonly seed: number,
    readonly stream: number,
    readonly index: number,
  ) {}

  u32(): number {
    return randU32(this.seed, this.stream, this.index, this.draw++);
  }

  f32(): number {
    return randF32(this.seed, this.stream, this.index, this.draw++);
  }

  gauss(): number {
    const g = randGauss(this.seed, this.stream, this.index, this.draw);
    this.draw += 2;
    return g;
  }
}
