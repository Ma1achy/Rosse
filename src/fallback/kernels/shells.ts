/**
 * Shell galaxies on the CPU engine (ADR 0011): the twin of src/shaders/compute/shells.wgsl, function
 * for function. Reference: `shellSprites` (app23.js:L711–748). A cold satellite released far out
 * falls almost straight into a logarithmic potential; its stars' semi-implicit Euler steps are f32
 * here, as on the GPU. The detection of the shells is `detectArcsCpu` (src/sim/shells.ts).
 */
import { cosF, randGaussF, sinF } from '../../core/f32math';
import { randF32 } from '../../core/rng';
import { Stream } from '../../core/streams';
import type { StructLayout } from '../../marks/instance';
import {
  SHELL_DT,
  SHELL_RC2,
  detectArcsCpu,
  shellSteps,
  type ShellArc,
  type ShellParams,
} from '../../sim/shells';
import { INSTANCE_WORDS } from './project';

const f = Math.fround;

/** The `SSim` uniform of shells.wgsl. */
export const SSIM_LAYOUT: StructLayout = {
  name: 'SSim',
  size: 64,
  align: 4,
  fields: [
    ['seed', 'u32'],
    ['n', 'u32'],
    ['st0', 'u32'],
    ['st1', 'u32'],
    ['dt', 'f32'],
    ['rc2', 'f32'],
    ['ca', 'f32'],
    ['sn', 'f32'],
    ['cx', 'f32'],
    ['cy', 'f32'],
    ['scale', 'f32'],
    ['n_dot_pool', 'u32'],
    ['pad0', 'u32'],
    ['pad1', 'u32'],
    ['pad2', 'u32'],
    ['pad3', 'u32'],
  ].map(([name, type], i) => ({
    name: name as string,
    type: type as 'u32' | 'f32',
    offset: i * 4,
    size: 4,
  })),
};

/** The values of the `SSim` uniform for steps `st0 … st1` and a view (`scale`, plate px per unit). */
export function ssimUniform(
  p: ShellParams,
  key: number,
  st0: number,
  st1: number,
  scale: number,
  nDotPool: number,
): Record<string, number> {
  const ax = (p.shellAxis * Math.PI) / 180;
  return {
    seed: key >>> 0,
    n: p.shellStars,
    st0,
    st1,
    dt: f(SHELL_DT),
    rc2: f(SHELL_RC2),
    ca: f(Math.cos(ax)),
    sn: f(Math.sin(ax)),
    cx: 400,
    cy: 400,
    scale: f(scale),
    n_dot_pool: nDotPool,
    pad0: 0,
    pad1: 0,
    pad2: 0,
    pad3: 0,
  };
}

/** The satellite's stars on the CPU. */
export class CpuShells {
  readonly n: number;
  readonly xs: Float32Array;
  readonly vs: Float32Array;
  arcs: ShellArc[] = [];

  constructor(
    readonly p: ShellParams,
    /** the counter RNG's key: the seed, or another when the goldens re-key */
    readonly key = p.seed >>> 0,
  ) {
    this.n = p.shellStars;
    this.xs = new Float32Array(this.n * 4);
    this.vs = new Float32Array(this.n * 4);
  }

  /** `init_shell` for every star (app23.js:L716–719). */
  init(): void {
    const g = (i: number, d: number) => randGaussF(this.key, Stream.shells, i, d);
    for (let i = 0; i < this.n; i++) {
      const o = i * 4;
      this.xs[o] = f(3 + f(g(i, 0) * f(0.5)));
      this.xs[o + 1] = f(g(i, 2) * f(0.02));
      this.xs[o + 2] = f(g(i, 4) * f(0.02));
      this.vs[o] = f(f(-0.1) + f(g(i, 6) * f(0.05)));
      this.vs[o + 1] = f(g(i, 8) * f(0.012));
      this.vs[o + 2] = f(g(i, 10) * f(0.012));
    }
  }

  /** `integrate`: steps `st0 … st1 − 1`. */
  integrate(st0: number, st1: number): void {
    const dt = f(SHELL_DT);
    const rc2 = f(SHELL_RC2);
    for (let i = 0; i < this.n; i++) {
      const o = i * 4;
      let x = this.xs[o] as number;
      let y = this.xs[o + 1] as number;
      let z = this.xs[o + 2] as number;
      let vx = this.vs[o] as number;
      let vy = this.vs[o + 1] as number;
      let vz = this.vs[o + 2] as number;
      for (let st = st0; st < st1; st++) {
        const fo = f(-1 / f(f(f(f(x * x) + f(y * y)) + f(z * z)) + rc2));
        vx = f(vx + f(f(fo * x) * dt));
        vy = f(vy + f(f(fo * y) * dt));
        vz = f(vz + f(f(fo * z) * dt));
        x = f(x + f(vx * dt));
        y = f(y + f(vy * dt));
        z = f(z + f(vz * dt));
      }
      this.xs[o] = x;
      this.xs[o + 1] = y;
      this.xs[o + 2] = z;
      this.vs[o] = vx;
      this.vs[o + 1] = vy;
      this.vs[o + 2] = vz;
    }
  }

  /** The whole simulation, then the detection. */
  run(): void {
    this.init();
    const steps = shellSteps(this.p);
    this.integrate(0, steps);
    this.arcs = detectArcsCpu(this.xs, this.n);
  }

  /**
   * `dots`: every star as a dots instance (8 words), from x and y only, turned by the infall axis
   * and placed with `scale` plate px per unit (app23.js:L741–747).
   */
  dots(pool: ArrayLike<number>, dotBase: ArrayLike<number>, scale: number): Float32Array {
    const out = new Float32Array(this.n * INSTANCE_WORDS);
    const u = new Uint32Array(out.buffer);
    const ax = (this.p.shellAxis * Math.PI) / 180;
    const ca = f(Math.cos(ax));
    const sn = f(Math.sin(ax));
    const nPool = pool.length - 24;
    for (let i = 0; i < this.n; i++) {
      const x = this.xs[i * 4] as number;
      const y = this.xs[i * 4 + 1] as number;
      const t = pool[24 + Math.floor(f(randF32(this.key, Stream.shells, i, 20) * nPool))] as number;
      const size = f((dotBase[t] as number) * f(0.85));
      const rot = f(randF32(this.key, Stream.shells, i, 21) * f(6.28));
      const c = cosF(rot);
      const s = sinF(rot);
      const o = i * INSTANCE_WORDS;
      out[o] = f(400 + f(f(f(x * ca) - f(y * sn)) * f(scale)));
      out[o + 1] = f(400 + f(f(f(x * sn) + f(y * ca)) * f(scale)));
      u[o + 2] = t;
      out[o + 3] = 1;
      out[o + 4] = f(c * size);
      out[o + 5] = f(s * size);
      out[o + 6] = f(-f(s * size));
      out[o + 7] = f(c * size);
    }
    return out;
  }
}
