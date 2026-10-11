/**
 * The hand wobble (`distort`): the reference's screen map `SM` (app23.js:L162–168), the twin of
 * `sm_warp` in src/shaders/common/warp.wgsl. Every mark goes through it: a bitmap mark's centre
 * (inst, app23.js:L171), a ribbon's vertices (buildCurves, L831) and a vector drawing's points
 * (expandVector, L1194). It moves a point by up to ±13 plate px per unit of `distort`, along a
 * smooth noise field in plate coordinates (so a galaxy slides through it when orbited or zoomed,
 * as in v21, reference notes 20.15).
 *
 * The field is the lattice noise of src/core/noise.ts (deliberate divergence 5) at v21's scale and
 * offsets, with a fixed lattice key: like v21's, it is the same field for every seed. f32 through
 * `Math.fround`, so both engines move a point by the same amount.
 *
 * v21's log-polar `unwrap` branch is dead code (reference notes 20.5) and is not reproduced.
 */
import { NoiseSalt, vnoise, type NoiseField } from '../core/noise';

const f = Math.fround;

/** v21's wobble scale (`s0`) and amplitude per unit of `distort` (`d0 = distort · 26`). */
export const WOBBLE_SCALE = 0.011;
export const WOBBLE_AMPLITUDE = 26;

/** The lattice key of the wobble field: the same for every seed, as v21's. */
export const WOBBLE_KEY = 0;

/**
 * How much of v21's wobble is drawn. v21's strength read as too much (the whole picture ripples as
 * it is orbited or zoomed), so the page draws 40% of it: the presets and the slider keep v21's
 * numbers, and the gain is applied here, where both engines and the shaders take their amplitude.
 * 1 is v21's.
 */
export const WOBBLE_GAIN = 0.4;

/** The wobble's amplitude for a `distort` value, f32 (0 when off). */
export function wobbleAmplitude(distort: number): number {
  return distort > 0 ? f(distort * WOBBLE_AMPLITUDE * WOBBLE_GAIN) : 0;
}

/** SM(x, y) in plate units, for a wobble amplitude `d0` (wobbleAmplitude). */
export function smWarp(
  x: number,
  y: number,
  d0: number,
  field?: NoiseField | null,
): [number, number] {
  if (!(d0 > 0)) return [x, y];
  const s0 = f(WOBBLE_SCALE);
  const xs = f(x * s0);
  const ys = f(y * s0);
  const nx = f(
    vnoise(f(xs + f(3.1)), f(ys + f(7.7)), WOBBLE_KEY, NoiseSalt.wobbleX, field) - f(0.5),
  );
  const ny = f(
    vnoise(f(xs + f(11.3)), f(ys - f(2.9)), WOBBLE_KEY, NoiseSalt.wobbleY, field) - f(0.5),
  );
  return [f(x + f(d0 * nx)), f(y + f(d0 * ny))];
}
