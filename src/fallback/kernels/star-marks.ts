/**
 * The marks of a star or an artefact (`starSprites`, app23.js:L398–439), one per slot: the CPU twin
 * of src/shaders/compute/star-marks.wgsl (ADR 0011, 0014), function for function, in f32 through
 * `Math.fround`. The jobs (src/model/stars.ts `starJobs`) say what each run of slots is; here
 * each slot finds its job by binary search on the jobs' first slots, and makes its mark from its own
 * counter of the `stars` stream (index = the job's stream index + the slot's place in the job).
 * A mark the reference would have rejected (a glare dot past its limit, a ring's dot where the noise
 * is low, a trail's dot beyond its flicker, a ghost's dot where the noise is low) is class NONE.
 *
 * Every mark is a bitmap sprite (a dot or a knot) of alpha 1 through the hand wobble (`inst`,
 * app23.js:L171), except the drawn star at the core, a vector drawing (class `rstar`) whose
 * wobble acts on each of its points. Classes are the stipple's (old, disc, young, knot, rstar), so
 * the marks are compacted with the stipple's and drawn in the same layers, as v21 concatenates
 * them (`merge`, L456).
 */
import { cosF, sinF } from '../../core/f32math';
import { randF32 } from '../../core/rng';
import { NoiseSalt, vnoise, type NoiseField } from '../../core/noise';
import { Stream } from '../../core/streams';
import { Cls } from '../../model/classes';
import { KNOT_POOL } from '../../model/galaxy';
import { STAR_JOB_WORDS, StarKind } from '../../model/stars';
import { smWarp } from '../../view/warp';
import { INSTANCE_WORDS } from './project';

const f = Math.fround;
const TAU = f(2 * Math.PI);
const pow = (x: number, y: number) => f(Math.pow(x, y));
const sqrt = (x: number) => f(Math.sqrt(x));

/** The `StarU` uniform's numbers. */
export type StarUniform = Record<string, number>;

export interface StarInputs {
  jobsF: Float32Array;
  jobsU: Uint32Array;
  u: StarUniform;
  /** the galaxy's pools (knots, then dots) and dot sizes */
  pool: Uint32Array;
  dotBase: Float32Array;
  noise: NoiseField;
}

/** The last job whose first slot is at or before `slot`. */
function jobOf(X: StarInputs, slot: number): number {
  let lo = 0;
  let hi = X.u.n_jobs ?? 0;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if ((X.jobsU[mid * STAR_JOB_WORDS + 9] ?? 0) <= slot) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** The draw that decides whether the dust passes a mark: after every draw the marks make (0 to 4). */
const DRAW_KEEP = 5;

/**
 * Slot `slot` (0-based among the star slots): its mark into `outF`/`outU` at instance
 * `out_base + slot`, and its class (Cls.none when it makes none, or when its draw `DRAW_KEEP` is not
 * below the job's keep, exp(−tau) of the dust in front of the star: ADR 0074).
 */
export function starMark(
  X: StarInputs,
  slot: number,
  outF: Float32Array,
  outU: Uint32Array,
): number {
  const cls = starMarkOf(X, slot, outF, outU);
  if (cls === Cls.none) return cls;
  const j = jobOf(X, slot);
  const keep = X.jobsF[j * STAR_JOB_WORDS + 13] ?? 1;
  const idx =
    ((X.jobsU[j * STAR_JOB_WORDS + 11] ?? 0) + slot - (X.jobsU[j * STAR_JOB_WORDS + 9] ?? 0)) >>> 0;
  return randF32((X.u.key ?? 0) >>> 0, Stream.stars, idx, DRAW_KEEP) < keep ? cls : Cls.none;
}

function starMarkOf(X: StarInputs, slot: number, outF: Float32Array, outU: Uint32Array): number {
  const oo = ((X.u.out_base ?? 0) + slot) * INSTANCE_WORDS;
  outF.fill(0, oo, oo + INSTANCE_WORDS);
  const j = jobOf(X, slot);
  const o = j * STAR_JOB_WORDS;
  const F = X.jobsF;
  const U = X.jobsU;
  const cx = F[o] ?? 0;
  const cy = F[o + 1] ?? 0;
  const a = F[o + 2] ?? 0;
  const b = F[o + 3] ?? 0;
  const p0 = F[o + 4] ?? 0;
  const p1 = F[o + 5] ?? 0;
  const kind = U[o + 8] ?? 0;
  const local = slot - (U[o + 9] ?? 0);
  const idx = ((U[o + 11] ?? 0) + local) >>> 0;
  const q = U[o + 12] ?? 0;
  const key = (X.u.key ?? 0) >>> 0;
  const r = (d: number) => randF32(key, Stream.stars, idx, d);
  const penDot = X.u.pen_dot ?? 1;
  const nDot = X.u.n_dot_pool ?? 1;
  const dotTile = (d: number) => X.pool[KNOT_POOL + Math.floor(f(r(d) * nDot))] ?? 0;
  const knotTile = (d: number) => X.pool[Math.floor(f(r(d) * KNOT_POOL))] ?? 0;
  const rot6 = (d: number) => f(r(d) * f(6.28));

  /** a bitmap mark at (x, y) through the hand wobble, a square of `size` turned by `rot` */
  const sprite = (x: number, y: number, tile: number, size: number, rot: number, cls: number) => {
    const [px, py] = smWarp(x, y, X.u.wobble ?? 0, X.noise);
    const c = cosF(rot);
    const s = sinF(rot);
    outF[oo] = px;
    outF[oo + 1] = py;
    outU[oo + 2] = tile;
    outF[oo + 3] = 1;
    outF[oo + 4] = f(c * size);
    outF[oo + 5] = f(s * size);
    outF[oo + 6] = f(-f(s * size));
    outF[oo + 7] = f(c * size);
    return cls;
  };
  const dot = (x: number, y: number, k: number, cls: number, dTile: number, dRot: number) => {
    const t = dotTile(dTile);
    return sprite(x, y, t, f((X.dotBase[t] ?? 0) * k), rot6(dRot), cls);
  };

  switch (kind) {
    case StarKind.heart: {
      // the saturated heart: knots within 0.6 core, thickest at the centre
      const ang = f(r(0) * TAU);
      const d = f(f(pow(r(1), f(1.6)) * a) * f(0.6));
      const size = f(f(f(3) + f(f(4) * r(3))) * penDot);
      return sprite(
        f(cx + f(cosF(ang) * d)),
        f(cy + f(sinF(ang) * d)),
        knotTile(2),
        size,
        rot6(4),
        Cls.knot,
      );
    }
    case StarKind.glare: {
      // a power-law fall-off: d = core (1 − 0.99u)^−0.62, nothing beyond `b`
      const ang = f(r(0) * TAU);
      const d = f(a * pow(f(1 - f(r(1) * f(0.99))), f(-0.62)));
      if (d > b) return Cls.none;
      return dot(
        f(cx + f(cosF(ang) * d)),
        f(cy + f(sinF(ang) * d)),
        d < f(a * 2) ? f(1.1) : f(0.85),
        d < f(a * f(2.2)) ? Cls.old : Cls.disc,
        2,
        3,
      );
    }
    case StarKind.spike: {
      // the spike's `p0` direction: along it from 0.6 core out to `b`, across it by a taper
      const dd = f(f(a * f(0.6)) + f(pow(r(0), f(1.7)) * b));
      const w = f(f(f(1.2) + f(3 * f(1 - f(dd / b)))) * f(r(1) - f(0.5)));
      const ca = cosF(p0);
      const sa = sinF(p0);
      return dot(
        f(f(cx + f(ca * dd)) - f(sa * w)),
        f(f(cy + f(sa * dd)) + f(ca * w)),
        f(f(0.8) + f(f(0.4) * f(1 - f(dd / b)))),
        Cls.disc,
        2,
        3,
      );
    }
    case StarKind.ring: {
      // a faint ring in the glare, broken where the noise is low
      const ang = f(r(0) * TAU);
      const nz = vnoise(
        f(f(cosF(ang) * 2) + q),
        f(sinF(ang) * 2),
        key,
        NoiseSalt.starRing,
        X.noise,
      );
      if (nz < f(0.35)) return Cls.none;
      const d = f(b * f(1 + f(f(r(1) - f(0.5)) * f(0.05))));
      return dot(f(cx + f(cosF(ang) * d)), f(cy + f(sinF(ang) * d)), f(0.8), Cls.young, 2, 3);
    }
    case StarKind.bleed: {
      // the saturation bleed column: a vertical smear, narrower at its ends
      const by = f(f(f(r(0) * 2) - 1) * a);
      const bx = f(f(r(1) - f(0.5)) * f(2 + f(3 * f(1 - f(Math.abs(by) / a)))));
      return dot(f(cx + bx), f(cy + by), f(0.9), Cls.old, 2, 3);
    }
    case StarKind.drawn: {
      // one of the star drawings at the core: a vector mark (class rstar), alpha = its pen scale
      const c = cosF(p0);
      const s = sinF(p0);
      outF[oo] = cx;
      outF[oo + 1] = cy;
      outU[oo + 2] = q;
      outF[oo + 3] = p1;
      outF[oo + 4] = f(c * a);
      outF[oo + 5] = f(s * a);
      outF[oo + 6] = f(-f(s * a));
      outF[oo + 7] = f(c * a);
      return Cls.rstar;
    }
    case StarKind.trail: {
      // a satellite's line: `a` its half length, `b` the gap of this line, `q` its index
      const tt = f(f(f(r(0) * 2) - 1) * a);
      const flick = f(
        f(0.6) +
          f(f(0.4) * vnoise(f(f(tt * f(0.04)) + f(q * 9)), 0, key, NoiseSalt.starTrail, X.noise)),
      );
      const w = f(f(r(1) - f(0.5)) * f(f(2.2) + f(f(1.5) * flick)));
      if (r(2) > flick) return Cls.none;
      const ca = cosF(p0);
      const sa = sinF(p0);
      const wb = f(w + b);
      return dot(
        f(f(cx + f(ca * tt)) - f(sa * wb)),
        f(f(cy + f(sa * tt)) + f(ca * wb)),
        f(f(0.9) + f(f(0.3) * flick)),
        q ? Cls.disc : Cls.old,
        3,
        4,
      );
    }
    case StarKind.ghostDisc: {
      // the reflection: a ragged annulus between R0 (`a`) and R1 (`b`), two in three disc, the rest young
      const ang = f(r(0) * TAU);
      const gd = f(a + f(f(b - a) * sqrt(r(1))));
      const nz = vnoise(
        f(f(cosF(ang) * f(1.5)) + 3),
        f(sinF(ang) * f(1.5)),
        key,
        NoiseSalt.starGhost,
        X.noise,
      );
      if (r(2) > f(f(0.55) + f(f(0.45) * nz))) return Cls.none;
      return dot(
        f(cx + f(cosF(ang) * gd)),
        f(cy + f(sinF(ang) * gd)),
        f(0.75),
        local % 3 ? Cls.disc : Cls.young,
        3,
        4,
      );
    }
    case StarKind.ghostRing: {
      // the reflection's bright edge at R1
      const ang = f(r(0) * TAU);
      const gd = f(b * f(1 + f(f(r(1) - f(0.5)) * f(0.04))));
      return dot(f(cx + f(cosF(ang) * gd)), f(cy + f(sinF(ang) * gd)), f(0.9), Cls.old, 2, 3);
    }
    case StarKind.cosmic: {
      if (local < q) {
        // a sharp little hit: dots along a segment of length `a`, through its centre
        const hd = f(f(f(local / b) - f(0.5)) * a);
        return dot(f(cx + f(cosF(p0) * hd)), f(cy + f(sinF(p0) * hd)), f(1.05), Cls.old, 0, 1);
      }
      if (p1 === 0) return Cls.none;
      return sprite(cx, cy, knotTile(1), f(f(f(3) + f(f(2) * r(0))) * penDot), rot6(2), Cls.knot);
    }
    default:
      return Cls.none;
  }
}

/** Runs every slot: classes into `classes[base + slot]`, instances into `instF/instU`. */
export function runStarMarks(
  X: StarInputs,
  classes: Uint32Array,
  instF: Float32Array,
  instU: Uint32Array,
): void {
  const n = X.u.n_slots ?? 0;
  const base = X.u.out_base ?? 0;
  for (let i = 0; i < n; i++) classes[base + i] = starMark(X, i, instF, instU);
}
