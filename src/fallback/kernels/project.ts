/**
 * Projection and view culls, CPU twin of src/shaders/compute/project.wgsl (the view tier,
 * ADR 0010): one call per sample. It reads the model tier's sample, applies the dust optical-depth
 * cull as a pure filter on the stored uniform `u_tau` (ADR 0004), projects the position with the
 * reference's `project` (app23.js:L153; Sérsic samples are turned by `pa` only, v21 parity,
 * app23.js:L228), applies the dust culls of M4 and the hand wobble, and writes the instance
 * `[x, y, tile, 1, simple(size, rot)]` (app23.js:L171–173) and its class, or class NONE when culled.
 *
 * The dust culls (app23.js:L264–265), on the projected position before the wobble, as v21:
 * - carving lines (`nearDust`): a disc, bar or ring sample within `4 + 5·dustLines` plate px of a
 *   carving line is culled when its uniform is below 0.9·dustLines;
 * - lanes (`inLane`): a disc sample within `(3.5 + 3·dustScribble)·zoom` plate px of a lane point
 *   is culled when its uniform is below 0.7.
 * Both uniforms are pure functions of the sample (the `stippleCull` stream, draws 0 and 1, keyed
 * by the placement key), so orbiting never shifts anyone's random numbers (ADR 0004). Distances are
 * compared squared, so the test is exact in f32 on both engines. v21 looks lane points up in a
 * 16-px grid and its 3 × 3 neighbourhood; every point is tested here, which gives the same answer
 * while the radius is under 16 px (zoom ≤ 2.4 at the default `dustScribble`).
 */
import { cosF, sinF } from '../../core/f32math';
import { randF32 } from '../../core/rng';
import { Stream } from '../../core/streams';
import type { StructLayout } from '../../marks/instance';
import type { ViewDesc } from '../../view/camera';
import { smWarp } from '../../view/warp';
import type { NoiseField } from '../../core/noise';
import { Cls, SAMPLE_WORDS, SampleFlag } from './stipple';

const f = Math.fround;

export const INSTANCE_WORDS = 8;

/** The `Culls` uniform of project.wgsl: the dust culls and the wobble of one view. */
export const CULLS_LAYOUT: StructLayout = {
  name: 'Culls',
  size: 48,
  align: 4,
  fields: [
    ['key', 'u32'],
    ['n_lane', 'u32'],
    ['lane_first', 'u32'],
    ['n_carve', 'u32'],
    ['lane_r2', 'f32'],
    ['lane_p', 'f32'],
    ['carve_w2', 'f32'],
    ['carve_p', 'f32'],
    ['wobble', 'f32'],
    ['pen_dot', 'f32'],
    ['tau_floor', 'f32'],
    ['pad2', 'f32'],
  ].map(([name, type], i) => ({
    name: name as string,
    type: type as 'u32' | 'f32',
    offset: i * 4,
    size: 4,
  })),
};

/** The view's dust culls: the uniform and the projected points they test against. */
export interface CullsDesc {
  c: Record<string, number>;
  /** projected scene points, plate units, 2 per point (compute/ribbons.wgsl `project_points`) */
  points: Float32Array;
  /** per carving segment: the index of its first point (the second follows it) */
  carve: Uint32Array;
  /** the scene's noise field (the wobble's) */
  noise?: NoiseField | null;
}

/** No culls, no wobble. */
export function noCulls(key = 0): CullsDesc {
  return {
    c: {
      key,
      n_lane: 0,
      lane_first: 0,
      n_carve: 0,
      lane_r2: 0,
      lane_p: 0,
      carve_w2: 0,
      carve_p: 0,
      wobble: 0,
      pen_dot: 1,
      tau_floor: 0,
      pad2: 0,
    },
    points: new Float32Array(2),
    carve: new Uint32Array(1),
  };
}

/** `nearDust` (app23.js:L214–220): within the carving width of any carving segment. */
export function nearCarve(qx: number, qy: number, C: CullsDesc): boolean {
  const P = C.points;
  const w2 = C.c.carve_w2 ?? 0;
  for (let s = 0; s < (C.c.n_carve ?? 0); s++) {
    const a = (C.carve[s] ?? 0) * 2;
    const p0x = P[a] ?? 0;
    const p0y = P[a + 1] ?? 0;
    const vx = f((P[a + 2] ?? 0) - p0x);
    const vy = f((P[a + 3] ?? 0) - p0y);
    let l2 = f(f(vx * vx) + f(vy * vy));
    if (l2 === 0) l2 = 1;
    const t = Math.min(Math.max(f(f(f(f(qx - p0x) * vx) + f(f(qy - p0y) * vy)) / l2), 0), 1);
    const ex = f(f(p0x + f(t * vx)) - qx);
    const ey = f(f(p0y + f(t * vy)) - qy);
    if (f(f(ex * ex) + f(ey * ey)) < w2) return true;
  }
  return false;
}

/** `inLane` (app23.js:L196–198): within the lane radius of any lane point. */
export function inLane(qx: number, qy: number, C: CullsDesc): boolean {
  const P = C.points;
  const r2 = C.c.lane_r2 ?? 0;
  const first = C.c.lane_first ?? 0;
  for (let k = 0; k < (C.c.n_lane ?? 0); k++) {
    const a = (first + k) * 2;
    const dx = f(qx - (P[a] ?? 0));
    const dy = f(qy - (P[a + 1] ?? 0));
    if (f(f(dx * dx) + f(dy * dy)) < r2) return true;
  }
  return false;
}

/**
 * The reference's `dustTau(p, c)` (app23.js:L145–152): the path length through the slab |z| < 0.06
 * along the line of sight, capped at 6, times 9 · dust · exp(−R / 1.6), zero beyond R 3.2.
 */
export function dustTau(x: number, y: number, z: number, cosI: number, dust: number): number {
  if (dust <= 0) return 0;
  const zd = f(0.06);
  const R = f(Math.sqrt(f(f(x * x) + f(y * y))));
  if (R > f(3.2)) return 0;
  let t1: number;
  let t2: number;
  if (Math.abs(cosI) < f(1e-3)) {
    if (Math.abs(z) > zd) return 0;
    t1 = 0;
    t2 = 6;
  } else {
    t1 = f(f(-zd - z) / cosI);
    t2 = f(f(zd - z) / cosI);
    if (t1 > t2) [t1, t2] = [t2, t1];
  }
  t1 = Math.max(t1, 0);
  t2 = Math.min(t2, 6);
  return f(f(f(dust * 9) * Math.max(0, f(t2 - t1))) * f(Math.exp(f(-R / f(1.6)))));
}

/** Projects sample `i`; writes its instance to `inst` and returns its class (or NONE). */
export function projectSample(
  i: number,
  V: ViewDesc,
  sf: Float32Array,
  su: Uint32Array,
  instF: Float32Array,
  instU: Uint32Array,
  C: CullsDesc = noCulls(),
): number {
  const o = i * SAMPLE_WORDS;
  const io = i * INSTANCE_WORDS;
  const cls = (su[o + 3] ?? 255) & 0xff;
  const flags = (su[o + 3] ?? 0) & ~0xff;
  const x = sf[o] ?? 0;
  const y = sf[o + 1] ?? 0;
  const z = sf[o + 2] ?? 0;
  instF.fill(0, io, io + INSTANCE_WORDS);
  if (cls === Cls.none) return Cls.none;
  const ci = V.cos_i ?? 1;
  if (flags & SampleFlag.tau) {
    const tau = dustTau(x, y, z, ci, V.dust ?? 0);
    if ((sf[o + 7] ?? 0) > Math.max(f(Math.exp(-tau)), C.c.tau_floor ?? 0)) return Cls.none;
  }
  const ca = V.cos_pa ?? 1;
  const sa = V.sin_pa ?? 0;
  const sc = V.scale ?? 84;
  let X: number;
  let Y: number;
  if (flags & SampleFlag.sersic2d) {
    X = x;
    Y = y;
  } else {
    const cz = V.cos_az ?? 1;
    const sz = V.sin_az ?? 0;
    const x0 = f(x * (V.winding ?? 1));
    X = f(f(x0 * cz) - f(y * sz));
    const ya = f(f(x0 * sz) + f(y * cz));
    Y = f(f(ya * ci) - f(z * (V.sin_i ?? 0)));
  }
  const qx = f((V.cx ?? 400) + f(f(f(X * ca) - f(Y * sa)) * sc));
  const qy = f((V.cy ?? 400) + f(f(f(X * sa) + f(Y * ca)) * sc));
  const key = C.c.key ?? 0;
  if (
    flags & SampleFlag.carve &&
    (C.c.n_carve ?? 0) > 0 &&
    randF32(key, Stream.stippleCull, i, 0) < (C.c.carve_p ?? 0) &&
    nearCarve(qx, qy, C)
  )
    return Cls.none;
  if (
    flags & SampleFlag.lane &&
    (C.c.n_lane ?? 0) > 0 &&
    randF32(key, Stream.stippleCull, i, 1) < (C.c.lane_p ?? 0) &&
    inLane(qx, qy, C)
  )
    return Cls.none;
  const size = sf[o + 5] ?? 0;
  const rot = sf[o + 6] ?? 0;
  if (cls === Cls.rstar) {
    // a drawn star (M7): the hand wobble acts on each point of the drawing (vector-expand), not
    // on its centre (a vector mark, app23.js:L171); the size grows with the zoom, `ZL` (L183)
    const pd = C.c.pen_dot ?? 1;
    const zl = f(Math.pow(f(sc / f(84)), f(0.45)));
    const sz = Math.max(f(f(3.2) * pd), Math.min(f(f(f(20) * pd) * zl), f(size * zl)));
    const ps =
      flags & SampleFlag.bright
        ? f(0.58)
        : Math.min(Math.max(f(f(0.3) + f(f(0.03) * sz)), f(0.36)), 0.5);
    const cs = cosF(rot);
    const sn = sinF(rot);
    instF[io] = qx;
    instF[io + 1] = qy;
    instU[io + 2] = su[o + 4] ?? 0;
    instF[io + 3] = ps;
    instF[io + 4] = f(cs * sz);
    instF[io + 5] = f(sn * sz);
    instF[io + 6] = f(-f(sn * sz));
    instF[io + 7] = f(cs * sz);
    return cls;
  }
  const [wx, wy] = smWarp(qx, qy, C.c.wobble ?? 0, C.noise);
  instF[io] = wx;
  instF[io + 1] = wy;
  instU[io + 2] = su[o + 4] ?? 0;
  instF[io + 3] = 1;
  const c = cosF(rot);
  const s = sinF(rot);
  instF[io + 4] = f(c * size);
  instF[io + 5] = f(s * size);
  instF[io + 6] = f(-f(s * size));
  instF[io + 7] = f(c * size);
  return cls;
}

/**
 * Runs the kernel over every sample. `extra` slots follow the samples in the instance and class
 * buffers, for the marks of stars and artefacts (./star-marks.ts); they start as class NONE.
 */
export function runProject(
  V: ViewDesc,
  samples: { f32: Float32Array; u32: Uint32Array; n: number },
  C: CullsDesc = noCulls(),
  extra = 0,
): { classes: Uint32Array; f32: Float32Array; u32: Uint32Array } {
  const n = samples.n;
  const buf = new ArrayBuffer(Math.max(1, n + extra) * INSTANCE_WORDS * 4);
  const instF = new Float32Array(buf);
  const instU = new Uint32Array(buf);
  const classes = new Uint32Array(Math.max(1, n + extra)).fill(Cls.none);
  for (let i = 0; i < n; i++)
    classes[i] = projectSample(i, V, samples.f32, samples.u32, instF, instU, C);
  return { classes, f32: instF, u32: instU };
}
