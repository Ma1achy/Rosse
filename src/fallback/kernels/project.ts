/**
 * Projection and view culls, CPU twin of src/shaders/compute/project.wgsl (the view tier,
 * ADR 0010): one call per sample. It reads the model tier's sample, applies the dust optical-depth
 * cull as a pure filter on the stored uniform `u_tau` (ADR 0004), projects the position with the
 * reference's `project` (app23.js:L153; Sérsic samples are turned by `pa` only, v21 parity,
 * app23.js:L228) and writes the instance `[x, y, tile, 1, simple(size, rot)]` (app23.js:L171–173)
 * and its class, or class NONE when culled.
 */
import { cosF, sinF } from '../../core/f32math';
import type { ViewDesc } from '../../view/camera';
import { Cls, SAMPLE_WORDS, SampleFlag } from './stipple';

const f = Math.fround;

export const INSTANCE_WORDS = 8;

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
    if ((sf[o + 7] ?? 0) > f(Math.exp(-tau))) return Cls.none;
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
  instF[io] = f((V.cx ?? 400) + f(f(f(X * ca) - f(Y * sa)) * sc));
  instF[io + 1] = f((V.cy ?? 400) + f(f(f(X * sa) + f(Y * ca)) * sc));
  instU[io + 2] = su[o + 4] ?? 0;
  instF[io + 3] = 1;
  const size = sf[o + 5] ?? 0;
  const rot = sf[o + 6] ?? 0;
  const c = cosF(rot);
  const s = sinF(rot);
  instF[io + 4] = f(c * size);
  instF[io + 5] = f(s * size);
  instF[io + 6] = f(-f(s * size));
  instF[io + 7] = f(c * size);
  return cls;
}

/** Runs the kernel over every sample. */
export function runProject(
  V: ViewDesc,
  samples: { f32: Float32Array; u32: Uint32Array; n: number },
): { classes: Uint32Array; f32: Float32Array; u32: Uint32Array } {
  const n = samples.n;
  const buf = new ArrayBuffer(Math.max(1, n) * INSTANCE_WORDS * 4);
  const instF = new Float32Array(buf);
  const instU = new Uint32Array(buf);
  const classes = new Uint32Array(Math.max(1, n));
  for (let i = 0; i < n; i++)
    classes[i] = projectSample(i, V, samples.f32, samples.u32, instF, instU);
  return { classes, f32: instF, u32: instU };
}
