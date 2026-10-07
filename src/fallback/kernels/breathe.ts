/**
 * The breathing room round bright drawn stars (app23.js:L275–281): a pure view filter, the CPU twin
 * of compute/breathe.wgsl (ADR 0004, 0010, 0014).
 *
 * v21 pushes every bright drawn star of the proposal loop into `RSP` as (x, y, 0.4 · size), then,
 * before the ring knots and clumps are made, removes every old, disc and young dot of the loop that
 * lies within a star's radius (a 24-px cell grid is only a search structure: the 3 × 3 cells hold
 * every star whose radius is below 24 px). So the filter is a function of the projected samples and
 * nothing else: no random numbers, and the extras (ring knots, clumps, which v21 makes after the
 * clearing) are not touched.
 *
 * `brightKeys` marks the kept bright stars of the proposals for the compaction (scan.wgsl, class
 * 0); `clearRoom` then drops each proposal dot that lies within any listed star's radius.
 * Distances are compared squared, so the test is exact in f32 on both engines.
 */
import { Cls, SampleFlag } from '../../model/classes';
import { INSTANCE_WORDS } from './project';
import { SAMPLE_WORDS } from './stipple';

const f = Math.fround;

/** Per sample of the proposals: 0 when it is a bright drawn star that survived the culls. */
export function brightKeys(
  nMain: number,
  classes: Uint32Array,
  samplesU: Uint32Array,
): Uint32Array {
  const keys = new Uint32Array(Math.max(1, nMain)).fill(0xff);
  for (let i = 0; i < nMain; i++)
    if (
      classes[i] === Cls.rstar &&
      ((samplesU[i * SAMPLE_WORDS + 3] ?? 0) & SampleFlag.bright) !== 0
    )
      keys[i] = 0;
  return keys;
}

/** A bright star's room: its centre and squared radius, 0.4 of its size. */
export interface Room {
  x: number;
  y: number;
  r2: number;
}

/** The rooms of the bright stars, in sample order. */
export function rooms(keys: Uint32Array, nMain: number, instF: Float32Array): Room[] {
  const out: Room[] = [];
  for (let i = 0; i < nMain; i++) {
    if (keys[i] !== 0) continue;
    const o = i * INSTANCE_WORDS;
    const m0 = instF[o + 4] ?? 0;
    const m1 = instF[o + 5] ?? 0;
    const sz = f(Math.sqrt(f(f(m0 * m0) + f(m1 * m1))));
    const r = f(f(0.4) * sz);
    out.push({ x: instF[o] ?? 0, y: instF[o + 1] ?? 0, r2: f(r * r) });
  }
  return out;
}

/**
 * Drops (class NONE) every old, disc and young dot of the proposals within a room. Returns how many.
 */
export function clearRoom(
  classes: Uint32Array,
  nMain: number,
  instF: Float32Array,
  list: readonly Room[],
): number {
  let cleared = 0;
  if (!list.length) return 0;
  for (let i = 0; i < nMain; i++) {
    const c = classes[i];
    if (c !== Cls.old && c !== Cls.disc && c !== Cls.young) continue;
    const o = i * INSTANCE_WORDS;
    const x = instF[o] ?? 0;
    const y = instF[o + 1] ?? 0;
    for (const s of list) {
      const dx = f(x - s.x);
      const dy = f(y - s.y);
      if (f(f(dx * dx) + f(dy * dy)) < s.r2) {
        classes[i] = Cls.none;
        cleared++;
        break;
      }
    }
  }
  return cleared;
}

/** Keys, rooms and clearing in one call (the CPU engine's view tier). */
export function breatheRoom(
  classes: Uint32Array,
  nMain: number,
  instF: Float32Array,
  samplesU: Uint32Array,
): number {
  const keys = brightKeys(nMain, classes, samplesU);
  return clearRoom(classes, nMain, instF, rooms(keys, nMain, instF));
}
