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
 */
import { pcg4d, u32ToUnit } from './rng';
import { Stream } from './streams';

const f = Math.fround;

/** Salts: which use of the noise (the low byte of the stream word is the noise stream). */
export const NoiseSalt = { flocc: 1, patchy: 2, irr: 3, ring: 4 } as const;

function corner(ix: number, iy: number, seed: number, salt: number): number {
  return u32ToUnit(pcg4d(ix >>> 0, iy >>> 0, seed >>> 0, (Stream.noise | (salt << 8)) >>> 0)[0]);
}

/** Smooth value noise in [0, 1), f32. */
export function vnoise(x: number, y: number, seed: number, salt: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = f(x - xi);
  const yf = f(y - yi);
  const u = f(f(xf * xf) * f(3 - f(2 * xf)));
  const v = f(f(yf * yf) * f(3 - f(2 * yf)));
  const ix = xi | 0;
  const iy = yi | 0;
  const a = corner(ix, iy, seed, salt);
  const b = corner(ix + 1, iy, seed, salt);
  const c = corner(ix, iy + 1, seed, salt);
  const d = corner(ix + 1, iy + 1, seed, salt);
  // a + (b - a) u + (c - a) v + (a - b - c + d) u v, evaluated left to right as the WGSL twin
  const t1 = f(f(b - a) * u);
  const t2 = f(f(c - a) * v);
  const t3 = f(f(f(f(f(a - b) - c) + d) * u) * v);
  return f(f(f(a + t1) + t2) + t3);
}
