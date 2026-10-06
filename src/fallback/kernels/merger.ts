/**
 * Merger test stars on the CPU engine (ADR 0009, 0011): the twin of
 * src/shaders/compute/merger.wgsl, function for function. Initial conditions from the counter RNG
 * (stream `mergerInit`, one index per star), then v21's kick-drift-kick leapfrog (app23.js:L340–376)
 * in f32 (`Math.fround` at every operation, in the order the WGSL writes them), snapshots as f16
 * positions relative to the nearer core, and `snapAt`'s blend (app23.js:L390–397).
 *
 * The cores are the f64 track of src/sim/merger.ts rounded to f32, the same entries the GPU reads.
 */
import { cosF, randGaussF, sinF } from '../../core/f32math';
import { packHalf2, unpackHalf2 } from '../../core/f16';
import { randF32 } from '../../core/rng';
import { Stream } from '../../core/streams';
import type { StructLayout } from '../../marks/instance';
import type { MergerDesc, SnapSelect } from '../../sim/merger';
import { MERGER_DT } from '../../sim/merger';

const f = Math.fround;

const layout = (name: string, fields: [string, 'u32' | 'f32' | 'vec4<f32>'][]): StructLayout => {
  let off = 0;
  const out = fields.map(([n, type]) => {
    const size = type === 'vec4<f32>' ? 16 : 4;
    const e = { name: n, type, offset: off, size };
    off += size;
    return e;
  });
  return {
    name,
    size: off,
    align: fields.some(([, t]) => t === 'vec4<f32>') ? 16 : 4,
    fields: out,
  };
};

/** The `MSim` uniform: what is fixed for the whole simulation. */
export const MSIM_LAYOUT = layout('MSim', [
  ['seed', 'u32'],
  ['n', 'u32'],
  ['n0', 'u32'],
  ['dt', 'f32'],
  ['m0', 'f32'],
  ['m1', 'f32'],
  ['a0sq', 'f32'],
  ['a1sq', 'f32'],
]);

/** The `MGal` uniform, one per galaxy. */
export const MGAL_LAYOUT = layout('MGal', [
  ['n', 'vec4<f32>'],
  ['e1', 'vec4<f32>'],
  ['e2', 'vec4<f32>'],
  ['c', 'vec4<f32>'],
  ['v', 'vec4<f32>'],
  ['p', 'vec4<f32>'],
]);

/** The `MJob` uniform: one dispatch's steps. */
export const MJOB_LAYOUT = layout('MJob', [
  ['st0', 'u32'],
  ['st1', 'u32'],
  ['steps', 'u32'],
  ['every', 'u32'],
  ['flags', 'u32'],
  ['core_off', 'u32'],
  ['pad0', 'u32'],
  ['pad1', 'u32'],
]);

/** The `MSel` uniform: the state to blend. */
export const MSEL_LAYOUT = layout('MSel', [
  ['kind0', 'u32'],
  ['idx0', 'u32'],
  ['kind1', 'u32'],
  ['idx1', 'u32'],
  ['a', 'f32'],
  ['snapc1', 'u32'],
  ['snapc2', 'u32'],
  ['n_stars', 'u32'],
]);

/** Where a snapshot's state comes from (`KIND_*` in merger.wgsl). */
export const SnapKind = { snap1: 0, chosen: 1, snap2: 2, horizon: 3 } as const;

/** Steps per dispatch (ADR 0009: "chunks of about 200 steps"). */
export const CHUNK_STEPS = 200;

const GALAXY_TYPE = { spiral: 0, lenticular: 1, elliptical: 2 } as const;

/** The `MSim` values of a description. */
export function simUniform(d: MergerDesc): Record<string, number> {
  return {
    seed: d.key,
    n: d.total,
    n0: d.n[0],
    dt: f(MERGER_DT),
    m0: f(d.track.M[0]),
    m1: f(d.track.M[1]),
    a0sq: f(f(d.track.A[0]) * f(d.track.A[0])),
    a1sq: f(f(d.track.A[1]) * f(d.track.A[1])),
  };
}

/** The `MGal` values of galaxy `g`. */
export function galUniform(d: MergerDesc, g: 0 | 1): Record<string, number[]> {
  const G = d.gals[g];
  const v = (a: readonly number[], w: number) => [...a.map(f), f(w)];
  return {
    n: v(G.n, GALAXY_TYPE[G.type]),
    e1: v(G.e1, G.rd),
    e2: v(G.e2, G.rmax),
    c: v(G.core.slice(0, 3), G.mass),
    v: v(G.core.slice(3, 6), G.soft),
    p: [f(G.arms), f(G.pitch), G.bar ? 1 : 0, 0],
  };
}

/** The pair of `MGal`, packed (the uniform is `array<MGal, 2>`). */
export function packGals(d: MergerDesc): ArrayBuffer {
  const buf = new ArrayBuffer(MGAL_LAYOUT.size * 2);
  const fl = new Float32Array(buf);
  for (const g of [0, 1] as const) {
    const u = galUniform(d, g);
    for (const fd of MGAL_LAYOUT.fields)
      fl.set(u[fd.name] as number[], (g * MGAL_LAYOUT.size + fd.offset) / 4);
  }
  return buf;
}

/** What a snapshot selection reads: the `MSel` values. */
export function selUniform(d: MergerDesc, s: SnapSelect): Record<string, number> {
  const kindOf = (i: number): { kind: number; idx: number } => {
    const closing = i === s.n - 1;
    if (s.phase === 'timeline')
      return closing ? { kind: SnapKind.chosen, idx: 0 } : { kind: SnapKind.snap1, idx: i };
    return closing ? { kind: SnapKind.horizon, idx: 0 } : { kind: SnapKind.snap2, idx: i };
  };
  const a = kindOf(s.i0);
  const b = kindOf(s.i1);
  return {
    kind0: a.kind,
    idx0: a.idx,
    kind1: b.kind,
    idx1: b.idx,
    a: f(s.a),
    snapc1: d.off.snapc1,
    snapc2: d.off.snapc2,
    n_stars: d.total,
  };
}

/** The test stars' state and snapshots on the CPU. */
export class CpuMergerStars {
  readonly n: number;
  /** position and velocity, 4 words per star (w unused), as the GPU's `xs` and `vs` */
  readonly xs: Float32Array;
  readonly vs: Float32Array;
  /** per star: (DX, DY, R0, 0), the initial disc coordinates the tidal map uses */
  readonly ic: Float32Array;
  /** f16 snapshots, 2 words per star per row: the timeline's, then the future's */
  readonly snap1: Uint32Array;
  readonly snap2: Uint32Array;
  /** the closing snapshots in f32 (the chosen moment, the horizon's end) */
  readonly chosen: Float32Array;
  readonly horizon: Float32Array;
  private readonly s: Record<string, number>;
  /** the last `accel` */
  private ax = 0;
  private ay = 0;
  private az = 0;

  constructor(readonly d: MergerDesc) {
    this.s = simUniform(d);
    this.n = d.total;
    this.xs = new Float32Array(this.n * 4);
    this.vs = new Float32Array(this.n * 4);
    this.ic = new Float32Array(this.n * 4);
    this.snap1 = new Uint32Array(Math.max(1, d.rows[0] * this.n * 2));
    this.snap2 = new Uint32Array(Math.max(1, d.rows[1] * this.n * 2));
    this.chosen = new Float32Array(this.n * 4);
    this.horizon = new Float32Array(this.n * 4);
  }

  /** `init_stars` for every star. */
  init(): void {
    for (let i = 0; i < this.n; i++) this.initStar(i);
  }

  /** The initial conditions of star `i` (app23.js:L320–338), on the counter RNG. */
  initStar(i: number): void {
    const d = this.d;
    const seed = d.key;
    const g = i >= d.n[0] ? 1 : 0;
    const G = d.gals[g];
    const u01 = (k: number) => randF32(seed, Stream.mergerInit, i, k);
    const gauss = (k: number) => randGaussF(seed, Stream.mergerInit, i, k);
    const rd = f(G.rd);
    const rmax = f(G.rmax);
    const mass = f(G.mass);
    const soft = f(G.soft);
    const c0 = G.core.slice(0, 3).map(f);
    const v0 = G.core.slice(3, 6).map(f);
    const circular = (r: number) => {
      const q = f(f(f(r * r) + f(soft * soft)));
      return f(Math.sqrt(f(f(f(mass * r) * r) / f(q * f(Math.sqrt(q))))));
    };
    const o = i * 4;
    if (G.type === 'elliptical') {
      const u0 = f(Math.sqrt(Math.min(u01(200), f(0.97))));
      const Re = Math.min(f(rmax * f(0.8)), f(f(f(f(f(0.45) * rd) * u0) / f(1 - u0)) + f(0.02)));
      const z = f(f(2 * u01(201)) - 1);
      const t = f(u01(202) * f(6.28318));
      const q = f(Math.sqrt(f(1 - f(z * z))));
      const dv = [f(q * cosF(t)), f(q * sinF(t)), z];
      const vcE = circular(Re);
      const vv = [gauss(203), gauss(205), gauss(207)];
      for (let a = 0; a < 3; a++) {
        this.xs[o + a] = f((c0[a] as number) + f(Re * (dv[a] as number)));
        this.vs[o + a] = f((v0[a] as number) + f(f((vv[a] as number) * vcE) * f(0.55)));
      }
      this.ic.set(
        [f(f(Re * (dv[0] as number)) / rmax), f(f(Re * (dv[1] as number)) / rmax), f(Re / rmax), 0],
        o,
      );
      return;
    }
    let R = 0;
    for (let t = 0; t < 40; t++) {
      R = f(-rd * f(Math.log(f(f(u01(2 * t) * u01(2 * t + 1)) + f(1e-9)))));
      if (R <= rmax && R >= f(0.04)) break;
    }
    R = Math.min(Math.max(R, f(0.04)), rmax);
    let th = f(u01(100) * f(6.28));
    if (G.type === 'spiral' && u01(101) < 0.5) {
      const k = Math.floor(f(u01(102) * f(G.arms)));
      th = f(
        f(f(f(Math.log(f(R / f(0.1)))) / f(G.pitch)) + f(f(f(6.283185307179586) * k) / f(G.arms))) +
          f(gauss(104) * f(0.25)),
      );
    }
    if (G.bar && R < f(rd * f(1.6)) && u01(106) < 0.35) {
      const bx = f(f(f(f(u01(107) * 2) - 1) * rd) * f(1.5));
      R = Math.max(f(0.04), Math.abs(bx));
      th = f((bx < 0 ? f(3.141592653589793) : 0) + f(gauss(108) * f(0.12)));
    }
    const vc = circular(R);
    const c = cosF(th);
    const sn = sinF(th);
    const thick = G.type === 'lenticular' ? f(0.04) : f(0.02);
    const zz = f(gauss(110) * thick);
    for (let a = 0; a < 3; a++) {
      const e1 = f(G.e1[a] as number);
      const e2 = f(G.e2[a] as number);
      const nn = f(G.n[a] as number);
      const rad = f(R * f(f(c * e1) + f(sn * e2)));
      this.xs[o + a] = f(f((c0[a] as number) + rad) + f(zz * nn));
      this.vs[o + a] = f((v0[a] as number) + f(vc * f(f(-sn * e1) + f(c * e2))));
    }
    this.ic.set([f(f(R * c) / rmax), f(f(R * sn) / rmax), f(R / rmax), 0], o);
  }

  /** The cores' positions at kick `k` of the phase starting at `off`. */
  private core(off: number, k: number, g: number): [number, number, number] {
    const o = (off + k * 2 + g) * 4;
    const c = this.d.cores;
    return [c[o] as number, c[o + 1] as number, c[o + 2] as number];
  }

  /** `accel` (merger.wgsl): the acceleration of a test star in the field of both cores, into ax, ay, az. */
  private accel(x: number, y: number, z: number, k: number, off: number): void {
    const s = this.s;
    const c = this.d.cores;
    const o0 = (off + k * 2) * 4;
    const o1 = o0 + 4;
    const d0x = f((c[o0] as number) - x);
    const d0y = f((c[o0 + 1] as number) - y);
    const d0z = f((c[o0 + 2] as number) - z);
    const q0 = f(f(f(f(d0x * d0x) + f(d0y * d0y)) + f(d0z * d0z)) + (s.a0sq as number));
    const i0 = f((s.m0 as number) / f(q0 * f(Math.sqrt(q0))));
    const d1x = f((c[o1] as number) - x);
    const d1y = f((c[o1 + 1] as number) - y);
    const d1z = f((c[o1 + 2] as number) - z);
    const q1 = f(f(f(f(d1x * d1x) + f(d1y * d1y)) + f(d1z * d1z)) + (s.a1sq as number));
    const i1 = f((s.m1 as number) / f(q1 * f(Math.sqrt(q1))));
    this.ax = f(f(d0x * i0) + f(d1x * i1));
    this.ay = f(f(d0y * i0) + f(d1y * i1));
    this.az = f(f(d0z * i0) + f(d1z * i1));
  }

  private writeSnap(
    table: Uint32Array,
    row: number,
    i: number,
    x: number,
    y: number,
    z: number,
    a: readonly number[],
    b: readonly number[],
  ): void {
    const dax = f(x - (a[0] as number));
    const day = f(y - (a[1] as number));
    const daz = f(z - (a[2] as number));
    const dbx = f(x - (b[0] as number));
    const dby = f(y - (b[1] as number));
    const dbz = f(z - (b[2] as number));
    let which = 0;
    let r = [dax, day, daz];
    if (
      f(f(f(dbx * dbx) + f(dby * dby)) + f(dbz * dbz)) <
      f(f(f(dax * dax) + f(day * day)) + f(daz * daz))
    ) {
      which = 1;
      r = [dbx, dby, dbz];
    }
    const o = (row * this.n + i) * 2;
    table[o] = packHalf2(r[0] as number, r[1] as number);
    table[o + 1] = packHalf2(r[2] as number, which);
  }

  /**
   * `start_phase` for every star: for the way in, the first snapshot; then the opening half kick.
   * `future`: the phase after the chosen moment.
   */
  startPhase(future: boolean): void {
    const d = this.d;
    const off = future ? d.off.pos2 : d.off.pos1;
    const p0 = this.core(off, 0, 0);
    const p1 = this.core(off, 0, 1);
    const half = f(f(MERGER_DT) * f(0.5));
    for (let i = 0; i < this.n; i++) {
      const o = i * 4;
      const x = this.xs[o] as number;
      const y = this.xs[o + 1] as number;
      const z = this.xs[o + 2] as number;
      if (!future) this.writeSnap(this.snap1, 0, i, x, y, z, p0, p1);
      this.accel(x, y, z, 0, off);
      this.vs[o] = f((this.vs[o] as number) + f(this.ax * half));
      this.vs[o + 1] = f((this.vs[o + 1] as number) + f(this.ay * half));
      this.vs[o + 2] = f((this.vs[o + 2] as number) + f(this.az * half));
    }
  }

  /** `integrate` for every star: steps `st0 … st1 − 1` of a phase. */
  integrate(future: boolean, st0: number, st1: number): void {
    const d = this.d;
    const ph = future ? d.track.future : d.track.chosen;
    const off = future ? d.off.pos2 : d.off.pos1;
    const table = future ? this.snap2 : this.snap1;
    const dt = f(MERGER_DT);
    const dth = f(dt * f(0.5));
    const steps = Math.max(ph.steps, 0);
    for (let i = 0; i < this.n; i++) {
      const o = i * 4;
      let x = this.xs[o] as number;
      let y = this.xs[o + 1] as number;
      let z = this.xs[o + 2] as number;
      let vx = this.vs[o] as number;
      let vy = this.vs[o + 1] as number;
      let vz = this.vs[o + 2] as number;
      for (let st = st0; st < st1; st++) {
        if (st > 0 && st % ph.every === 0) {
          const row = Math.floor(st / ph.every) - (future ? 1 : 0);
          this.writeSnap(table, row, i, x, y, z, this.core(off, st, 0), this.core(off, st, 1));
        }
        x = f(x + f(vx * dt));
        y = f(y + f(vy * dt));
        z = f(z + f(vz * dt));
        const h = st + 1 === steps ? dth : dt;
        this.accel(x, y, z, st + 1, off);
        vx = f(vx + f(this.ax * h));
        vy = f(vy + f(this.ay * h));
        vz = f(vz + f(this.az * h));
      }
      this.xs[o] = x;
      this.xs[o + 1] = y;
      this.xs[o + 2] = z;
      this.vs[o] = vx;
      this.vs[o + 1] = vy;
      this.vs[o + 2] = vz;
    }
  }

  /** `finish_phase`: the closing snapshot in f32. */
  finishPhase(future: boolean): void {
    (future ? this.horizon : this.chosen).set(this.xs);
  }

  /** The whole simulation, in chunks of `CHUNK_STEPS`, calling `onChunk` between them. */
  run(onChunk?: (phase: 'timeline' | 'future', done: number, of: number) => void): void {
    this.init();
    for (const future of [false, true]) {
      const ph = future ? this.d.track.future : this.d.track.chosen;
      const steps = Math.max(ph.steps, 0);
      this.startPhase(future);
      for (let st = 0; st < steps; st += CHUNK_STEPS) {
        this.integrate(future, st, Math.min(steps, st + CHUNK_STEPS));
        onChunk?.(future ? 'future' : 'timeline', Math.min(steps, st + CHUNK_STEPS), steps);
      }
      this.finishPhase(future);
    }
  }

  /** One star at one snapshot of a source: f16 row plus its core, or the f32 closing position. */
  private load(kind: number, idx: number, i: number): [number, number, number] {
    const d = this.d;
    if (kind === SnapKind.chosen || kind === SnapKind.horizon) {
      const src = kind === SnapKind.chosen ? this.chosen : this.horizon;
      return [src[i * 4] as number, src[i * 4 + 1] as number, src[i * 4 + 2] as number];
    }
    const table = kind === SnapKind.snap2 ? this.snap2 : this.snap1;
    const core0 = kind === SnapKind.snap2 ? d.off.snapc2 : d.off.snapc1;
    const o = (idx * this.n + i) * 2;
    const [ax, ay] = unpackHalf2(table[o] as number);
    const [bx, by] = unpackHalf2(table[o + 1] as number);
    const c = this.core(core0, idx, Math.floor(by + 0.5));
    return [f(ax + c[0]), f(ay + c[1]), f(bx + c[2])];
  }

  /** `blend`: every star's position at the selected state (snapAt), 4 words per star. */
  blend(s: SnapSelect, out = new Float32Array(this.n * 4)): Float32Array {
    const u = selUniform(this.d, s);
    const b1 = f(1 - (u.a as number));
    for (let i = 0; i < this.n; i++) {
      const p0 = this.load(u.kind0 as number, u.idx0 as number, i);
      if (u.a === 0) {
        out.set([p0[0], p0[1], p0[2], 0], i * 4);
        continue;
      }
      const p1 = this.load(u.kind1 as number, u.idx1 as number, i);
      for (let k = 0; k < 3; k++)
        out[i * 4 + k] = f(f((p0[k] as number) * b1) + f((p1[k] as number) * (u.a as number)));
    }
    return out;
  }

  /** `radii`: the distances of every fifth star of `cur` to `centre`. */
  static radii(cur: Float32Array, n: number, centre: readonly number[]): Float32Array {
    const out = new Float32Array(Math.ceil(n / 5));
    for (let k = 0; k < out.length; k++) {
      const i = k * 5;
      const dx = f((cur[i * 4] as number) - f(centre[0] as number));
      const dy = f((cur[i * 4 + 1] as number) - f(centre[1] as number));
      const dz = f((cur[i * 4 + 2] as number) - f(centre[2] as number));
      out[k] = f(Math.sqrt(f(f(f(dx * dx) + f(dy * dy)) + f(dz * dz))));
    }
    return out;
  }
}
