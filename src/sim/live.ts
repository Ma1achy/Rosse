/**
 * The live part of a merger (ADR 0099): each galaxy's massive component as an N-body, in f64.
 *
 * v21's cores are two point masses on a Kepler orbit with a made-up friction. With `nbody` each
 * galaxy is instead a softened core (a Plummer sphere) plus `n` massive tracer particles, a disc
 * of `LIVE_DISC` of its mass, all pulling on one another by direct summation: the discs' self-gravity,
 * their tides on each other and the friction the wakes cause are then what bends the cores' orbit.
 * The visible test stars still follow the cores (src/fallback/kernels/merger.ts), so the engines
 * need nothing new: the track this makes is the same `CoreTrack` they already read.
 *
 * Units are v21's: G = 1, the first galaxy's mass 1. Pure functions of the parameters and the
 * counter RNG, so a view is reproducible.
 */
import { randGaussF } from '../core/f32math';
import { randF32 } from '../core/rng';
import { Stream } from '../core/streams';

/** The share of a galaxy's mass in its disc tracers (the rest is the core). */
export const LIVE_DISC = 0.35;
/** The pair interactions the whole run may cost (a symmetric pair counts once). */
export const LIVE_PAIR_BUDGET = 1.2e8;
export const LIVE_MIN = 60;
export const LIVE_MAX = 400;
function add(a: Float64Array, i: number, v: number): void {
  a[i] = (a[i] as number) + v;
}

/** The tracers' softening squared, in units of the galaxy's size squared. */
export const LIVE_SOFT2 = 0.012;

export interface LiveGalaxy {
  /** mass of the galaxy (core and tracers), the core's Plummer softening and the disc scale */
  mass: number;
  soft: number;
  rd: number;
  rmax: number;
  /** a spheroid (no disc): its tracers are a hot ball */
  elliptical: boolean;
  /** the dark halo's squared circular speed per unit mass, and the shared core radius squared */
  halo: number;
  /** the disc's frame */
  n: readonly number[];
  e1: readonly number[];
  e2: readonly number[];
  /** the core's start state: position then velocity */
  core: readonly number[];
}

export interface LiveOpts {
  seed: number;
  haloRc2: number;
  coreSoft2: number;
  /** the friction's strength (`mFriction` · 0.35) acting on the cores' relative velocity */
  friction: number;
  /** the cores' mass total, for the friction's weights */
  steps: number;
}

/** Tracers per galaxy so the whole run stays within the pair budget. */
export function liveCount(steps: number): number {
  const total = Math.sqrt((2 * LIVE_PAIR_BUDGET) / Math.max(steps, 1));
  return Math.max(LIVE_MIN, Math.min(LIVE_MAX, Math.floor(total / 2)));
}

/** The index space of the tracers on the init stream (stars use theirs, galaxies 0x80000000 +). */
const TRACER_INDEX = 0xa0000000;

/** The system: cores first (one per galaxy), then the tracers of galaxy 0, then of galaxy 1. */
export class LiveSystem {
  readonly n: number;
  readonly ng: number;
  /** positions, velocities, accelerations: 3 per particle */
  readonly x: Float64Array;
  readonly v: Float64Array;
  readonly a: Float64Array;
  readonly m: Float64Array;
  /** the galaxy of every particle */
  readonly gal: Uint8Array;
  /** where each galaxy's tracers start, and how many */
  readonly first: number[] = [];
  readonly count: number[] = [];
  private readonly h: number[];
  private readonly mc: number[];
  private readonly A2: number[];
  private readonly T2: number[];

  constructor(
    readonly gals: readonly LiveGalaxy[],
    readonly nl: number,
    readonly o: LiveOpts,
  ) {
    this.ng = gals.length;
    this.n = this.ng + this.ng * nl;
    this.x = new Float64Array(3 * this.n);
    this.v = new Float64Array(3 * this.n);
    this.a = new Float64Array(3 * this.n);
    this.m = new Float64Array(this.n);
    this.gal = new Uint8Array(this.n);
    this.h = gals.map((G) => G.halo * G.mass);
    this.mc = gals.map((G) => G.mass * (1 - LIVE_DISC));
    this.A2 = gals.map((G) => G.soft * G.soft);
    this.T2 = gals.map((G) => LIVE_SOFT2 * (G.rd / 0.32) * (G.rd / 0.32));
    gals.forEach((G, g) => {
      this.gal[g] = g;
      this.m[g] = this.mc[g] as number;
      for (let d = 0; d < 3; d++) {
        this.x[3 * g + d] = G.core[d] as number;
        this.v[3 * g + d] = G.core[3 + d] as number;
      }
      this.first[g] = this.ng + g * nl;
      this.count[g] = nl;
      for (let i = 0; i < nl; i++) {
        this.gal[this.first[g] + i] = g;
        this.m[this.first[g] + i] = (LIVE_DISC * G.mass) / nl;
      }
    });
    this.place();
  }

  /** The tracers' discs: exponential, thin, on the circular speed the system's own pull gives. */
  private place(): void {
    const { seed } = this.o;
    this.gals.forEach((G, g) => {
      const f0 = this.first[g] as number;
      for (let i = 0; i < this.nl; i++) {
        const k = TRACER_INDEX + g * 65536 + i;
        if (G.elliptical) {
          const u0 = Math.sqrt(Math.min(randF32(seed, Stream.mergerInit, k, 200), 0.97));
          const Re = Math.min(G.rmax * 0.8, (0.45 * G.rd * u0) / (1 - u0) + 0.02);
          const zz = 2 * randF32(seed, Stream.mergerInit, k, 201) - 1;
          const t = randF32(seed, Stream.mergerInit, k, 202) * 6.283185307179586;
          const q = Math.sqrt(1 - zz * zz);
          const dv = [q * Math.cos(t), q * Math.sin(t), zz];
          for (let d = 0; d < 3; d++)
            this.x[3 * (f0 + i) + d] = (G.core[d] as number) + Re * (dv[d] as number);
          continue;
        }
        let R = 0;
        for (let t = 0; t < 40; t++) {
          R =
            -G.rd *
            Math.log(
              randF32(seed, Stream.mergerInit, k, 2 * t) *
                randF32(seed, Stream.mergerInit, k, 2 * t + 1) +
                1e-9,
            );
          if (R <= G.rmax && R >= 0.04) break;
        }
        R = Math.min(Math.max(R, 0.04), G.rmax);
        const th = randF32(seed, Stream.mergerInit, k, 100) * 6.283185307179586;
        const z = randGaussF(seed, Stream.mergerInit, k, 110) * 0.03;
        const c = Math.cos(th);
        const s = Math.sin(th);
        for (let d = 0; d < 3; d++)
          this.x[3 * (f0 + i) + d] =
            (G.core[d] as number) +
            R * (c * (G.e1[d] as number) + s * (G.e2[d] as number)) +
            z * (G.n[d] as number);
      }
    });
    // the speeds: each galaxy alone, v² = R · (inward pull in its plane)
    for (let g = 0; g < this.ng; g++) {
      const G = this.gals[g] as LiveGalaxy;
      this.accel(g);
      const f0 = this.first[g] as number;
      for (let i = 0; i < this.nl; i++) {
        const p = f0 + i;
        if (G.elliptical) {
          const k = TRACER_INDEX + g * 65536 + i;
          const r = Math.hypot(
            ...[0, 1, 2].map((d) => (this.x[3 * p + d] as number) - (G.core[d] as number)),
          );
          let inward = 0;
          for (let d = 0; d < 3; d++)
            inward -=
              (this.a[3 * p + d] as number) *
              (((this.x[3 * p + d] as number) - (G.core[d] as number)) / r);
          const vc = Math.sqrt(Math.max(0, r * inward));
          for (let d = 0; d < 3; d++)
            this.v[3 * p + d] =
              (G.core[3 + d] as number) +
              randGaussF(seed, Stream.mergerInit, k, 203 + 2 * d) * vc * 0.55;
          continue;
        }
        const n = G.n as readonly [number, number, number];
        const rx = (this.x[3 * p] as number) - (G.core[0] as number);
        const ry = (this.x[3 * p + 1] as number) - (G.core[1] as number);
        const rz = (this.x[3 * p + 2] as number) - (G.core[2] as number);
        const dn = rx * n[0] + ry * n[1] + rz * n[2];
        const px = rx - dn * n[0];
        const py = ry - dn * n[1];
        const pz = rz - dn * n[2];
        const R = Math.hypot(px, py, pz);
        const ux = px / R;
        const uy = py / R;
        const uz = pz / R;
        const inward = -(
          (this.a[3 * p] as number) * ux +
          (this.a[3 * p + 1] as number) * uy +
          (this.a[3 * p + 2] as number) * uz
        );
        const vc = Math.sqrt(Math.max(0, R * inward));
        // the tangent n × u
        this.v[3 * p] = (G.core[3] as number) + vc * (n[1] * uz - n[2] * uy);
        this.v[3 * p + 1] = (G.core[4] as number) + vc * (n[2] * ux - n[0] * uz);
        this.v[3 * p + 2] = (G.core[5] as number) + vc * (n[0] * uy - n[1] * ux);
      }
    }
    this.a.fill(0);
  }

  /**
   * The accelerations into `a`. `only` ≥ 0 restricts the system to that galaxy's core and tracers
   * (the start's own pull); −1 is the whole system.
   */
  accel(only = -1): void {
    const { x, a, m, gal, ng, n } = this;
    a.fill(0);
    const lo = only >= 0;
    const live = (i: number) => !lo || gal[i] === only;
    // core–core, with v21's softening and (optionally) its friction on the relative velocity
    if (!lo && ng === 2) {
      const dx = (x[3] as number) - (x[0] as number);
      const dy = (x[4] as number) - (x[1] as number);
      const dz = (x[5] as number) - (x[2] as number);
      const d2 = dx * dx + dy * dy + dz * dz + this.o.coreSoft2;
      const inv = 1 / (d2 * Math.sqrt(d2));
      const m0 = this.m[0] as number;
      const m1 = this.m[1] as number;
      add(a, 0, dx * inv * m1);
      add(a, 1, dy * inv * m1);
      add(a, 2, dz * inv * m1);
      add(a, 3, -(dx * inv * m0));
      add(a, 4, -(dy * inv * m0));
      add(a, 5, -(dz * inv * m0));
      const fr = this.o.friction;
      if (fr > 0) {
        const dvx = (this.v[3] as number) - (this.v[0] as number);
        const dvy = (this.v[4] as number) - (this.v[1] as number);
        const dvz = (this.v[5] as number) - (this.v[2] as number);
        const w = fr * Math.exp(-Math.sqrt(d2) / 1.5);
        const mt = m0 + m1;
        add(a, 0, (w * dvx * m1) / mt);
        add(a, 1, (w * dvy * m1) / mt);
        add(a, 2, (w * dvz * m1) / mt);
        add(a, 3, -((w * dvx * m0) / mt));
        add(a, 4, -((w * dvy * m0) / mt));
        add(a, 5, -((w * dvz * m0) / mt));
      }
    }
    // tracer–tracer: every pair once, softened by the pair's mean
    for (let i = ng; i < n; i++) {
      if (!live(i)) continue;
      const ti = this.T2[gal[i] as number] as number;
      for (let j = i + 1; j < n; j++) {
        if (!live(j)) continue;
        const dx = (x[3 * j] as number) - (x[3 * i] as number);
        const dy = (x[3 * j + 1] as number) - (x[3 * i + 1] as number);
        const dz = (x[3 * j + 2] as number) - (x[3 * i + 2] as number);
        const d2 = dx * dx + dy * dy + dz * dz + 0.5 * (ti + (this.T2[gal[j] as number] as number));
        const inv = 1 / (d2 * Math.sqrt(d2));
        const fi = (m[j] as number) * inv;
        const fj = (m[i] as number) * inv;
        add(a, 3 * i, dx * fi);
        add(a, 3 * i + 1, dy * fi);
        add(a, 3 * i + 2, dz * fi);
        add(a, 3 * j, -(dx * fj));
        add(a, 3 * j + 1, -(dy * fj));
        add(a, 3 * j + 2, -(dz * fj));
      }
    }
    // core–tracer, either galaxy's: the core's own softening
    for (let c = 0; c < ng; c++) {
      if (!live(c)) continue;
      for (let j = ng; j < n; j++) {
        if (!live(j)) continue;
        const dx = (x[3 * c] as number) - (x[3 * j] as number);
        const dy = (x[3 * c + 1] as number) - (x[3 * j + 1] as number);
        const dz = (x[3 * c + 2] as number) - (x[3 * j + 2] as number);
        const d2 = dx * dx + dy * dy + dz * dz + (this.A2[c] as number);
        const inv = 1 / (d2 * Math.sqrt(d2));
        const fj = (m[c] as number) * inv;
        const fc = (m[j] as number) * inv;
        add(a, 3 * j, dx * fj);
        add(a, 3 * j + 1, dy * fj);
        add(a, 3 * j + 2, dz * fj);
        add(a, 3 * c, -(dx * fc));
        add(a, 3 * c + 1, -(dy * fc));
        add(a, 3 * c + 2, -(dz * fc));
      }
    }
    // the dark halos: rigid, riding on their cores, pulling the tracers; the cores take the reaction
    for (let c = 0; c < ng; c++) {
      const h = this.h[c] as number;
      if (!(h > 0) || !live(c)) continue;
      const rc2 = this.o.haloRc2;
      for (let j = ng; j < n; j++) {
        if (!live(j)) continue;
        const dx = (x[3 * c] as number) - (x[3 * j] as number);
        const dy = (x[3 * c + 1] as number) - (x[3 * j + 1] as number);
        const dz = (x[3 * c + 2] as number) - (x[3 * j + 2] as number);
        const k = h / (dx * dx + dy * dy + dz * dz + rc2);
        add(a, 3 * j, dx * k);
        add(a, 3 * j + 1, dy * k);
        add(a, 3 * j + 2, dz * k);
        const r = ((m[j] as number) * k) / (this.mc[c] as number);
        add(a, 3 * c, -(dx * r));
        add(a, 3 * c + 1, -(dy * r));
        add(a, 3 * c + 2, -(dz * r));
      }
    }
  }

  kick(h: number): void {
    this.accel();
    for (let i = 0; i < 3 * this.n; i++)
      this.v[i] = (this.v[i] as number) + (this.a[i] as number) * h;
  }

  drift(dt: number): void {
    for (let i = 0; i < 3 * this.n; i++)
      this.x[i] = (this.x[i] as number) + (this.v[i] as number) * dt;
  }
}
