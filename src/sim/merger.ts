/**
 * Mergers: two galaxies on a parabolic orbit with test stars (restricted N-body), ADR 0009.
 * Reference: `simulateMerger`, `mergerGalaxyParams`, `snapAt`, `frameOf`, `unionFrame`
 * (app23.js:L304–397, L466–480).
 *
 * This file is the CPU half, shared by the WebGPU engine and the CPU engine:
 *
 * - the **core track** in double precision: the two cores' orbit (parabolic, or eccentric through
 *   `mEcc`), in a tilted plane, with dynamical friction, integrated with v21's kick-drift-kick
 *   sequence, dt 0.012, half kicks at the ends, at most 1,400 steps to the chosen moment and then
 *   on to the horizon. It uses only `+ − × ÷ sqrt exp` after the set-up, so it is the same on every
 *   machine, and it equals v21's `simulateMerger` core track to the last bit (tests/unit/merger-core.test.ts
 *   against tests/vectors/merger.json, which v21's own function made);
 * - the **step and snapshot plan**: which steps keep a snapshot, how many snapshots the timeline
 *   holds, and the memory they take (ADR 0009's budget);
 * - the **initial conditions' frames**: each galaxy's spin axis, scale lengths and type, as the
 *   uniform the test-star kernel reads (the stars' own draws are the kernel's, on the counter RNG);
 * - the timeline: `mTime` to a pair of snapshots and a blend (`snapAt`), and the framing (`frameOf`,
 *   `unionFrame`), eased as `mergerSprites` does.
 *
 * Test stars: src/shaders/compute/merger.wgsl and its twin src/fallback/kernels/merger.ts.
 */
import type { Params } from '../core/params';
import { Stream } from '../core/streams';
import { randF32 } from '../core/rng';

/** The leapfrog step (`dt`, app23.js:L360). */
export const MERGER_DT = 0.012;
/** The most steps up to the chosen moment (app23.js:L360). */
export const MERGER_MAX_STEPS = 1400;
/** The core softening squared (app23.js:L346, `+ 0.02`). */
export const CORE_SOFT2 = 0.02;
/** The true anomaly the cores start from (app23.js:L307). */
export const MERGER_F0 = -2.2;

export type MergerType = 'spiral' | 'lenticular' | 'elliptical';

/** The parameters that fix the simulation (v21's cache key, app23.js:L305, without the camera). */
export interface MergerParams {
  seed: number;
  mRatio: number;
  mPeri: number;
  mStage: number;
  mSpin1: number;
  mSpin2: number;
  mFriction: number;
  mStars: number;
  mBulge: number;
  mType1: string;
  mType2: string;
  mArms1: number;
  mArms2: number;
  mSize1: number;
  mSize2: number;
  mBar1: number;
  mBar2: number;
  mTilt: number;
  mEcc: number;
  mHorizon: number;
}

export function mergerParamsOf(P: Params | MergerParams): MergerParams {
  return {
    seed: P.seed,
    mRatio: P.mRatio,
    mPeri: P.mPeri,
    mStage: P.mStage,
    mSpin1: P.mSpin1,
    mSpin2: P.mSpin2,
    mFriction: P.mFriction,
    mStars: P.mStars,
    mBulge: P.mBulge,
    mType1: P.mType1,
    mType2: P.mType2,
    mArms1: P.mArms1,
    mArms2: P.mArms2,
    mSize1: P.mSize1,
    mSize2: P.mSize2,
    mBar1: P.mBar1,
    mBar2: P.mBar2,
    mTilt: P.mTilt,
    mEcc: P.mEcc,
    mHorizon: P.mHorizon,
  };
}

/** The key of the model tier's merger cache: every parameter that changes the simulation. */
export function mergerKey(p: MergerParams): string {
  return JSON.stringify(mergerParamsOf(p));
}

/** A core's state: position (3) then velocity (3). */
export type CoreState = [number, number, number, number, number, number];

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** `P.mType1 || 'spiral'`. */
export function typeOf(t: string | undefined): MergerType {
  return t === 'elliptical' || t === 'lenticular' ? t : 'spiral';
}

/** Star counts: `n0 = round(mStars (1 − 0.6 mBulge) / (1 + √q))`, the small galaxy `max(800, n0 √q)`. */
export function starCounts(p: MergerParams): { n: [number, number]; total: number } {
  const q = p.mRatio;
  const n0 = Math.round((p.mStars * (1 - 0.6 * p.mBulge)) / (1 + Math.sqrt(q)));
  const n: [number, number] = [n0, Math.max(800, Math.round(n0 * Math.sqrt(q)))];
  return { n, total: n[0] + n[1] };
}

/** The two cores' masses (1 and q) and softening lengths (0.22, 0.22 √q). */
export function coreMasses(p: MergerParams): { M: [number, number]; A: [number, number] } {
  const q = p.mRatio;
  return { M: [1, q], A: [0.22, 0.22 * Math.sqrt(q)] };
}

/** One leapfrog phase's cores: their positions at every kick, and the state at every snapshot. */
export interface CorePhase {
  /** steps in this phase (the loop runs this many drifts; ≤ 0 for none) */
  steps: number;
  /** a snapshot every this many steps */
  every: number;
  /**
   * The cores' positions at each kick: entry k (k = 0 … max(steps, 0)) is the position after k
   * drifts, 6 numbers (core 0 then core 1). Kick k = 0 is the opening half kick; k = steps the
   * closing half kick.
   */
  pos: Float64Array;
  /** the cores' full state at each snapshot (12 numbers each: both cores' position and velocity) */
  snaps: Float64Array;
  /** snapshot count, the closing one included */
  nSnaps: number;
}

/** The whole core track (ADR 0009). */
export interface CoreTrack {
  M: [number, number];
  A: [number, number];
  /** the time from the start to pericentre (Barker's equation, app23.js:L311) */
  t0: number;
  /** to the chosen moment */
  chosen: CorePhase;
  /** from the chosen moment to the horizon */
  future: CorePhase;
  /** the cores' state at the chosen moment (`S0.C`) */
  C: [CoreState, CoreState];
  /** and at the end of the horizon */
  Cend: [CoreState, CoreState];
  /** the horizon `HZ` = clamp(mHorizon, 2, 30) */
  horizon: number;
  dt: number;
  /**
   * The union frame, from the reference's own snapshots (a track thinned by the snapshot budget
   * keeps the reference's framing).
   */
  union?: MergerFrame;
}

/**
 * v21's two-core integration (app23.js:L306–314 for the start, L340–376 for the steps), in f64,
 * operation for operation. The test stars take no part: they are test particles.
 */
export function coreTrack(p: MergerParams, stride: readonly [number, number] = [1, 1]): CoreTrack {
  const q = p.mRatio;
  const M: [number, number] = [1, q];
  const Mt = 1 + q;
  const rp = p.mPeri;
  const A: [number, number] = [0.22, 0.22 * Math.sqrt(q)];
  const f0 = MERGER_F0;
  const rr0 = (2 * rp) / (1 + Math.cos(f0));
  const h = Math.sqrt(Mt * 2 * rp);
  const ox = rr0 * Math.cos(f0);
  const oy = rr0 * Math.sin(f0);
  const vr = (Mt / h) * Math.sin(f0);
  const vt = (Mt / h) * (1 + Math.cos(f0));
  const ovx = vr * Math.cos(f0) - vt * Math.sin(f0);
  const ovy = vr * Math.sin(f0) + vt * Math.cos(f0);
  const Dh = Math.tan(f0 / 2);
  const t0 = Math.sqrt((2 * rp * rp * rp) / Mt) * (Dh + (Dh * Dh * Dh) / 3);
  const ek = p.mEcc || 1;
  const C: [CoreState, CoreState] = [
    [(-q / Mt) * ox, (-q / Mt) * oy, 0, (-q / Mt) * ovx * ek, (-q / Mt) * ovy * ek, 0],
    [ox / Mt, oy / Mt, 0, (ovx / Mt) * ek, (ovy / Mt) * ek, 0],
  ];
  // the orbit's plane, tilted about x
  const tl = ((p.mTilt || 0) * Math.PI) / 180;
  const ctl = Math.cos(tl);
  const stl = Math.sin(tl);
  for (const c of C)
    for (const o of [0, 3] as const) {
      const y = c[o + 1] as number;
      const z = c[o + 2] as number;
      c[o + 1] = y * ctl - z * stl;
      c[o + 2] = y * stl + z * ctl;
    }

  const dt = MERGER_DT;
  const T = p.mStage - t0;
  const steps = Math.min(MERGER_MAX_STEPS, Math.ceil(T / dt));
  const fr = p.mFriction * 0.35;

  /** accCores (app23.js:L343–350): the cores' accelerations, with the friction on the relative velocity */
  const acc = (): [[number, number, number], [number, number, number]] => {
    const c0 = C[0];
    const c1 = C[1];
    const dx = c1[0] - c0[0];
    const dy = c1[1] - c0[1];
    const dz = c1[2] - c0[2];
    const d2 = dx * dx + dy * dy + dz * dz + CORE_SOFT2;
    const inv = 1 / (d2 * Math.sqrt(d2));
    const out: [[number, number, number], [number, number, number]] = [
      [dx * inv * M[1], dy * inv * M[1], dz * inv * M[1]],
      [-dx * inv * M[0], -dy * inv * M[0], -dz * inv * M[0]],
    ];
    if (fr > 0) {
      const dvx = c1[3] - c0[3];
      const dvy = c1[4] - c0[4];
      const dvz = c1[5] - c0[5];
      const w = fr * Math.exp(-Math.sqrt(d2) / 1.5);
      out[0][0] += (w * dvx * M[1]) / Mt;
      out[0][1] += (w * dvy * M[1]) / Mt;
      out[0][2] += (w * dvz * M[1]) / Mt;
      out[1][0] -= (w * dvx * M[0]) / Mt;
      out[1][1] -= (w * dvy * M[0]) / Mt;
      out[1][2] -= (w * dvz * M[0]) / Mt;
    }
    return out;
  };
  const kick = (h2: number) => {
    const a = acc();
    for (let g = 0; g < 2; g++)
      for (let d = 0; d < 3; d++) {
        const c = C[g] as number[];
        c[d + 3] = (c[d + 3] as number) + ((a[g] as number[])[d] as number) * h2;
      }
  };
  const drift = () => {
    for (let g = 0; g < 2; g++)
      for (let d = 0; d < 3; d++) {
        const c = C[g] as number[];
        c[d] = (c[d] as number) + (c[d + 3] as number) * dt;
      }
  };
  const positions = (out: Float64Array, k: number) => {
    for (let g = 0; g < 2; g++)
      for (let d = 0; d < 3; d++) out[k * 6 + g * 3 + d] = (C[g] as number[])[d] as number;
  };
  const state = (out: number[]) => {
    for (const c of C) out.push(...c);
  };
  const copy = (): [CoreState, CoreState] => [C[0].slice() as CoreState, C[1].slice() as CoreState];

  /**
   * One phase: the opening half kick, then `n` drifts each followed by a kick (the last a half kick),
   * keeping a snapshot of the cores before drift `st` for every `st > 0` that is a multiple of `every`,
   * and (the chosen phase only) one at the very start. The closing snapshot is taken by the caller.
   */
  const phase = (n: number, every: number, withStart: boolean): CorePhase => {
    const pos = new Float64Array(Math.max(n, 0) * 6 + 6 || 6);
    const snaps: number[] = [];
    let count = 0;
    if (withStart) {
      state(snaps);
      count++;
    }
    positions(pos, 0);
    kick(dt / 2);
    for (let st = 0; st < n; st++) {
      if (st > 0 && st % every === 0) {
        state(snaps);
        count++;
      }
      drift();
      positions(pos, st + 1);
      kick(st === n - 1 ? dt / 2 : dt);
    }
    state(snaps);
    count++;
    return { steps: n, every, pos, snaps: Float64Array.from(snaps), nSnaps: count };
  };

  // the snapshot at the start is taken before the opening kick (app23.js:L358)
  const every = Math.max(1, Math.floor(steps / 90)) * stride[0];
  const chosen = phase(steps, every, true);
  const Cc = copy();
  const HZ = Math.max(2, Math.min(30, p.mHorizon || 2));
  const FUT = 5.0 * (HZ - 1);
  const steps2 = Math.ceil(FUT / dt);
  const every2 = Math.max(1, Math.ceil(steps2 / Math.min(420, 90 * (HZ - 1)))) * stride[1];
  const future = phase(steps2, every2, false);
  const track: CoreTrack = {
    M,
    A,
    t0,
    chosen,
    future,
    C: Cc,
    Cend: copy(),
    horizon: HZ,
    dt,
  };
  // a thinned track keeps the reference's union frame
  track.union = unionFrame(stride[0] === 1 && stride[1] === 1 ? track : coreTrack(p));
  return track;
}

/** The cores' positions at snapshot `s` of a phase (6 numbers: core 0 then core 1). */
export function snapshotCores(ph: CorePhase, s: number): number[] {
  const o = s * 12;
  const a = ph.snaps;
  return [
    a[o] as number,
    a[o + 1] as number,
    a[o + 2] as number,
    a[o + 6] as number,
    a[o + 7] as number,
    a[o + 8] as number,
  ];
}

/** The step (kick index) at which snapshot `s` of the chosen phase is taken (`s · every`). */
export function chosenSnapshotStep(ph: CorePhase, s: number): number {
  return s * ph.every;
}

/** The step of snapshot `s` of the future phase: `(s + 1) · every` (v21 keeps none at its start). */
export function futureSnapshotStep(ph: CorePhase, s: number): number {
  return (s + 1) * ph.every;
}

/**
 * Snapshot budget (ADR 0009): the number of f16 timeline snapshots the stars keep, and what they cost.
 * The reference keeps about 90 for the way in and up to 420 for the horizon; here a cap on the
 * bytes (default 64 MiB for both tables together) coarsens the spacing of the future's snapshots
 * first, then the timeline's, when 30,000 stars would not fit. At the defaults (11,000 stars, a
 * horizon of 2) the reference's own spacing is kept.
 */
export interface SnapshotBudget {
  /** snapshots in the timeline table (f16), not counting the closing f32 one */
  n1: number;
  /** snapshots in the future table (f16), not counting the closing f32 one */
  n2: number;
  /** bytes of both f16 tables */
  bytes: number;
  /** the f32 buffers: the chosen moment and the horizon's end */
  bytesF32: number;
  /** the step stride between kept snapshots, for the timeline and the future (1 = every reference snapshot) */
  stride: [number, number];
}

export const SNAPSHOT_BYTES_PER_STAR = 8;
export const SNAPSHOT_CAP_BYTES = 64 * 1024 * 1024;

/** The snapshot counts without the cap: v21's, closing snapshots included (`frames`, `fut`). */
export function referenceSnapshots(t: CoreTrack): [number, number] {
  return [t.chosen.nSnaps, t.future.nSnaps];
}

export function snapshotBudget(
  total: number,
  t: CoreTrack,
  cap = SNAPSHOT_CAP_BYTES,
): SnapshotBudget {
  const per = total * SNAPSHOT_BYTES_PER_STAR;
  const [r1, r2] = referenceSnapshots(t);
  // the closing snapshot of each phase is an f32 buffer, not a table row
  let n1 = Math.max(1, r1 - 1);
  let n2 = Math.max(0, r2 - 1);
  const stride: [number, number] = [1, 1];
  while ((n1 + n2) * per > cap && n2 > 1) {
    stride[1]++;
    n2 = Math.ceil((r2 - 1) / stride[1]);
  }
  while ((n1 + n2) * per > cap && n1 > 2) {
    stride[0]++;
    n1 = Math.ceil((r1 - 1) / stride[0]);
  }
  return { n1, n2, bytes: (n1 + n2) * per, bytesF32: 2 * total * 16, stride };
}

// ---------------------------------------------------------------------------------------------
// Initial conditions: each galaxy's frame

/** Galaxy-level draws that replace v21's sequential `az` and `pitch` (counter RNG, ADR 0004). */
export interface MergerPicks {
  /** spin azimuth per galaxy (v21: `r() · 6.28`) */
  az?: [number, number];
  /** log-spiral pitch per galaxy (v21: `0.3 + 0.4 r()`) */
  pitch?: [number, number];
  /**
   * `mergerGalaxyParams`' draws per galaxy: the arms' pitch in degrees of a spiral
   * (`round(14 + 18 u)`), the Sérsic index of an elliptical (`3 + u`) and its flattening
   * (`0.7 + 0.3 u`), from `mulberry32(seed · 97 + g · 131)`.
   */
  galaxy?: [GalaxyPicks, GalaxyPicks];
}

export interface GalaxyPicks {
  pitchDeg: number;
  sersicN: number;
  bulgeFlat: number;
}

/** The galaxy-level counter-RNG index space (stars use their own index). */
const GALAXY_INDEX = 0x80000000;

/** The engine's own galaxy-level draws: azimuth and log-spiral pitch (v21: `r() · 6.28`, `0.3 + 0.4 r()`). */
export function icPicks(
  seed: number,
  g: number,
  picks?: MergerPicks,
): { az: number; pitch: number } {
  const az =
    picks?.az?.[g] ?? Math.fround(randF32(seed, Stream.mergerInit, GALAXY_INDEX + g, 0) * 6.28);
  const pitch =
    picks?.pitch?.[g] ??
    Math.fround(0.3 + 0.4 * randF32(seed, Stream.mergerInit, GALAXY_INDEX + g, 1));
  return { az, pitch };
}

/** The engine's own `mergerGalaxyParams` draws, or the replayed ones. */
export function galaxyPicks(seed: number, g: number, picks?: MergerPicks): GalaxyPicks {
  const p = picks?.galaxy?.[g];
  if (p) return p;
  const u = (k: number) => randF32(seed, Stream.mergerInit, GALAXY_INDEX + 16 + g, k);
  return {
    pitchDeg: Math.round(14 + 18 * u(0)),
    sersicN: 3 + u(1),
    bulgeFlat: 0.7 + 0.3 * u(2),
  };
}

/** The unit vector of the spin, and the two vectors of the disc plane (app23.js:L317–319). */
export function discFrame(spinDeg: number, az: number) {
  const s = (spinDeg * Math.PI) / 180;
  const n = [Math.sin(s) * Math.cos(az), Math.sin(s) * Math.sin(az), Math.cos(s)] as const;
  let e1 = Math.abs(n[2]) < 0.9 ? [n[1], -n[0], 0] : [0, n[2], -n[1]];
  const l1 = Math.hypot(e1[0] as number, e1[1] as number, e1[2] as number);
  e1 = e1.map((x) => x / l1);
  const e2 = [
    n[1] * (e1[2] as number) - n[2] * (e1[1] as number),
    n[2] * (e1[0] as number) - n[0] * (e1[2] as number),
    n[0] * (e1[1] as number) - n[1] * (e1[0] as number),
  ];
  return {
    n: [...n] as [number, number, number],
    e1: e1 as [number, number, number],
    e2: e2 as [number, number, number],
  };
}

/** One galaxy's initial conditions as the test-star kernel reads them (f64 here, rounded when packed). */
export interface GalaxyIC {
  type: MergerType;
  /** first star and count */
  first: number;
  count: number;
  /** mass, Plummer softening */
  mass: number;
  soft: number;
  /** scale length `rd = 0.32 √M size` and truncation radius `rmax = 1.7 √M size` */
  rd: number;
  rmax: number;
  arms: number;
  /** log-spiral pitch (the tangent of the winding angle) */
  pitch: number;
  bar: boolean;
  n: [number, number, number];
  e1: [number, number, number];
  e2: [number, number, number];
  /** the core's start state: position then velocity */
  core: CoreState;
}

export function galaxyICs(
  p: MergerParams,
  track: CoreTrack,
  picks?: MergerPicks,
): [GalaxyIC, GalaxyIC] {
  const { n } = starCounts(p);
  const TY = [typeOf(p.mType1), typeOf(p.mType2)] as const;
  const ARM = [p.mArms1 || 2, p.mArms2 || 2];
  const SZ = [p.mSize1 || 1, p.mSize2 || 1];
  const BAR = [p.mBar1 || 0, p.mBar2 || 0];
  const SP = [p.mSpin1, p.mSpin2];
  const out = [0, 1].map((g): GalaxyIC => {
    const { az, pitch } = icPicks(p.seed, g, picks);
    const fr = discFrame(SP[g] as number, az);
    const M = track.M[g] as number;
    return {
      type: TY[g] as MergerType,
      first: g === 0 ? 0 : n[0],
      count: n[g] as number,
      mass: M,
      soft: track.A[g] as number,
      rd: 0.32 * Math.sqrt(M) * (SZ[g] as number),
      rmax: 1.7 * Math.sqrt(M) * (SZ[g] as number),
      arms: ARM[g] as number,
      pitch,
      bar: !!BAR[g],
      n: fr.n,
      e1: fr.e1,
      e2: fr.e2,
      core: initialCore(p, g),
    };
  });
  return [out[0] as GalaxyIC, out[1] as GalaxyIC];
}

/** The core's state at the start, tilted (what `coreTrack` starts from). */
export function initialCore(p: MergerParams, g: number): CoreState {
  const q = p.mRatio;
  const Mt = 1 + q;
  const rp = p.mPeri;
  const f0 = MERGER_F0;
  const rr0 = (2 * rp) / (1 + Math.cos(f0));
  const h = Math.sqrt(Mt * 2 * rp);
  const ox = rr0 * Math.cos(f0);
  const oy = rr0 * Math.sin(f0);
  const vr = (Mt / h) * Math.sin(f0);
  const vt = (Mt / h) * (1 + Math.cos(f0));
  const ovx = vr * Math.cos(f0) - vt * Math.sin(f0);
  const ovy = vr * Math.sin(f0) + vt * Math.cos(f0);
  const ek = p.mEcc || 1;
  const c =
    g === 0
      ? [(-q / Mt) * ox, (-q / Mt) * oy, 0, (-q / Mt) * ovx * ek, (-q / Mt) * ovy * ek, 0]
      : [ox / Mt, oy / Mt, 0, (ovx / Mt) * ek, (ovy / Mt) * ek, 0];
  const tl = ((p.mTilt || 0) * Math.PI) / 180;
  const ctl = Math.cos(tl);
  const stl = Math.sin(tl);
  for (const o of [0, 3]) {
    const y = c[o + 1] as number;
    const z = c[o + 2] as number;
    c[o + 1] = y * ctl - z * stl;
    c[o + 2] = y * stl + z * ctl;
  }
  return c as CoreState;
}

// ---------------------------------------------------------------------------------------------
// The timeline: mTime to snapshots, and the framing

/** Where the state at `mTime` comes from. */
export type SnapSource = 'timeline' | 'chosen' | 'future' | 'horizon';

/**
 * A fractional snapshot index of one table, and the blend between its two neighbours: the state at
 * `mTime` is `(1 − a) · snap(i0) + a · snap(i1)` (`snapAt`, app23.js:L390–397). `closing0` and
 * `closing1` say a neighbour is the phase's closing f32 snapshot (the chosen moment, or the
 * horizon's end) and not a row of the f16 table.
 */
export interface SnapSelect {
  /** `true`: a state before the chosen moment (the timeline); `false`: after it (the future) */
  phase: 'timeline' | 'future';
  /** state is exactly the chosen moment's (mTime within 0.001 of 1) */
  exact: boolean;
  i0: number;
  i1: number;
  a: number;
  /** the number of snapshots in the table the indices run over (v21's `frames.length`) */
  n: number;
}

/**
 * `mergerSprites`' choice of state (app23.js:L483–492): the chosen moment for `mTime` in
 * [0.999, 1.001], a blend of two timeline snapshots below, a blend of two future snapshots above.
 */
export function snapSelect(track: CoreTrack, mTime: number | null | undefined): SnapSelect {
  const t = mTime ?? 1;
  const n1 = track.chosen.nSnaps;
  const n2 = track.future.nSnaps;
  const pick = (phase: 'timeline' | 'future', n: number, f: number): SnapSelect => {
    const x = clamp(f, 0, n - 1);
    const i0 = Math.floor(x);
    const i1 = Math.min(n - 1, i0 + 1);
    const a = x - i0;
    if (a < 1e-4 || i0 === i1) return { phase, exact: false, i0, i1: i0, a: 0, n };
    return { phase, exact: false, i0, i1, a, n };
  };
  if (t < 0.999 && n1 > 0) return pick('timeline', n1, clamp(t, 0, 1) * (n1 - 1));
  if (t > 1.001 && n2 > 0) {
    const HZ = track.horizon;
    return pick('future', n2, clamp((t - 1) / (HZ - 1), 0, 1) * (n2 - 1));
  }
  return { phase: 'timeline', exact: true, i0: n1 - 1, i1: n1 - 1, a: 0, n: n1 };
}

/** The cores' positions of a selection, blended in f64 (`snapAt`'s `C`). */
export function blendCores(
  track: CoreTrack,
  s: SnapSelect,
): [[number, number, number], [number, number, number]] {
  const ph = s.phase === 'timeline' ? track.chosen : track.future;
  const get = (i: number) => {
    // the closing snapshot of a phase is its last
    const o = i * 12;
    return ph.snaps.subarray(o, o + 12);
  };
  const a0 = get(s.i0);
  const a1 = get(s.i1);
  const b1 = 1 - s.a;
  const mix = (o: number) => {
    const x = a0[o] as number;
    if (s.a === 0) return x;
    return x * b1 + (a1[o] as number) * s.a;
  };
  return [
    [mix(0), mix(1), mix(2)],
    [mix(6), mix(7), mix(8)],
  ];
}

/** A frame holding the pair: its centre and radius (app23.js:L466–480). */
export interface MergerFrame {
  c: [number, number, number];
  r: number;
}

/** The centre between the cores, and the radius that holds both whole (`rWhole`, app23.js:L468–469). */
export function wholeFrame(
  C: readonly [ArrayLike<number>, ArrayLike<number>],
  M: readonly [number, number],
): { c: [number, number, number]; rWhole: number } {
  const c0 = C[0];
  const c1 = C[1];
  const c3: [number, number, number] = [
    ((c0[0] as number) + (c1[0] as number)) / 2,
    ((c0[1] as number) + (c1[1] as number)) / 2,
    ((c0[2] as number) + (c1[2] as number)) / 2,
  ];
  const rWhole = Math.max(
    Math.hypot((c0[0] as number) - c3[0], (c0[1] as number) - c3[1], (c0[2] as number) - c3[2]) +
      1.25 * Math.sqrt(M[0]),
    Math.hypot((c1[0] as number) - c3[0], (c1[1] as number) - c3[1], (c1[2] as number) - c3[2]) +
      1.25 * Math.sqrt(M[1]),
  );
  return { c: c3, rWhole };
}

/** `frameOf` from the distances of every fifth star to the centre (any order). */
export function frameFromRadii(
  C: readonly [ArrayLike<number>, ArrayLike<number>],
  M: readonly [number, number],
  radii: ArrayLike<number>,
): MergerFrame {
  const { c, rWhole } = wholeFrame(C, M);
  const rr = Array.from(radii).sort((x, y) => x - y);
  const q = rr[Math.floor(rr.length * 0.9)] ?? 0;
  return { c, r: Math.max(rWhole, 0.8 * q) };
}

/**
 * `unionFrame` (app23.js:L473–480): a frame that holds both galaxies at every snapshot of the way
 * in, from the cores alone.
 */
export function unionFrame(track: CoreTrack): MergerFrame {
  const ph = track.chosen;
  const mids: [number, number, number][] = [];
  for (let s = 0; s < ph.nSnaps; s++) {
    const o = s * 12;
    const a = ph.snaps;
    mids.push([
      ((a[o] as number) + (a[o + 6] as number)) / 2,
      ((a[o + 1] as number) + (a[o + 7] as number)) / 2,
      ((a[o + 2] as number) + (a[o + 8] as number)) / 2,
    ]);
  }
  const c: [number, number, number] = [0, 0, 0];
  for (let d = 0; d < 3; d++)
    c[d] = mids.reduce((acc, m) => acc + (m[d] as number), 0) / mids.length;
  let r = 0;
  for (let s = 0; s < ph.nSnaps; s++)
    for (let g = 0; g < 2; g++) {
      const o = s * 12 + g * 6;
      const a = ph.snaps;
      r = Math.max(
        r,
        Math.hypot(
          (a[o] as number) - c[0],
          (a[o + 1] as number) - c[1],
          (a[o + 2] as number) - c[2],
        ) +
          1.25 * Math.sqrt(track.M[g] as number),
      );
    }
  return { c, r };
}

/** The smoothstep ease between frames (`w = t² (3 − 2t)`). */
export const ease = (t: number) => t * t * (3 - 2 * t);

/**
 * The framing at `mTime`, eased as mergerSprites does (app23.js:L483–492): from the union frame to
 * the chosen moment's frame for `mTime` below 1, and from it to the horizon's end after.
 * `chosen` and `end` are the star-dependent frames (`frameOf`), from the stars' distances.
 */
export function framingAt(
  track: CoreTrack,
  mTime: number | null | undefined,
  chosen: MergerFrame,
  end: MergerFrame,
): MergerFrame {
  const t = mTime ?? 1;
  const mix = (a: MergerFrame, b: MergerFrame, w: number): MergerFrame => ({
    c: [0, 1, 2].map((d) => (a.c[d] as number) + ((b.c[d] as number) - (a.c[d] as number)) * w) as [
      number,
      number,
      number,
    ],
    r: a.r + (b.r - a.r) * w,
  });
  if (t < 0.999 && track.chosen.nSnaps > 0) {
    const fu = track.union ?? unionFrame(track);
    const tt = clamp(t, 0, 1);
    return mix(fu, chosen, ease(tt));
  }
  if (t > 1.001 && track.future.nSnaps > 0) {
    const t2 = clamp((t - 1) / (track.horizon - 1), 0, 1);
    return mix(chosen, end, ease(t2));
  }
  return chosen;
}

/**
 * `mergerGalaxyParams` (app23.js:L381–389), as overrides of the main parameters: each merging
 * galaxy described as a single galaxy would be, face-on and with no extras.
 *
 * v21 parity (Q13, reference notes 20.20): these are overrides of the main parameters, as v21's
 * `Object.assign({}, mainP, mergerGalaxyParams(...))` has them, so everything not listed here
 * (`dust`, `dustLines`, `streams`, `bubbles`, `patchy`, `thick`, `stroke`...) is the main picture's,
 * whatever the preset.
 */
export function mergerGalaxyParams(P: Params, g: 0 | 1, picks?: MergerPicks): Partial<Params> {
  const ty = typeOf(g === 0 ? P.mType1 : P.mType2);
  const q = P.mRatio;
  const share = g === 0 ? 1 / (1 + q) : q / (1 + q);
  const gp = galaxyPicks(P.seed, g, picks);
  const base: Partial<Params> = {
    merger: 0,
    mWarp: 0,
    seed: P.seed * 7 + g * 101 + 1,
    incl: 0,
    az: 0,
    pa: 0,
    winding: 1,
    field: 0,
    fgstars: 0,
    trails: 0,
    companions: 0,
    arrow: 0,
    jet: 0,
    lensOn: 0,
    shellsOn: 0,
    ring: 0,
    rewind: 0,
    unwrap: 0,
    distort: 0,
    stars: Math.round(P.mStars * 0.42 * share + 700),
    stipple: 1,
    halo: 0.05,
  };
  if (ty === 'elliptical')
    return {
      ...base,
      arms: 0,
      bulge: 1,
      sersicN: gp.sersicN,
      re: 0.75,
      bulgeFlat: gp.bulgeFlat,
      lines: 0,
      knots: 0,
      sparkle: 0,
      dustScribble: 0,
      bubbles: 0,
      starMix: P.starMix * 0.5,
    };
  const bar = g === 0 ? P.mBar1 : P.mBar2;
  if (ty === 'lenticular')
    return {
      ...base,
      arms: 0,
      bulge: 0.55,
      bulgeSize: 1.1,
      lines: 0,
      knots: 0.1,
      dustScribble: 0.2,
      bar: bar ? 0.7 : 0,
    };
  return {
    ...base,
    arms: g === 0 ? P.mArms1 : P.mArms2,
    pitch: gp.pitchDeg,
    bulge: clamp(0.08 + 0.5 * P.mBulge, 0.05, 0.45),
    bar: bar ? 0.75 : 0,
    barLen: 0.8,
    lines: Math.min(P.lines, 0.45),
    flocc: 0,
    dustScribble: Math.min(P.dustScribble, 0.3),
  };
}

// ---------------------------------------------------------------------------------------------
// The scene description of a merger (shared by both engines)

/** Where each table starts in the `cores` array (in vec4 entries, two per kick or snapshot). */
export interface CoreOffsets {
  /** kick positions of the way in: (steps + 1) kicks */
  pos1: number;
  /** kick positions of the future */
  pos2: number;
  /** the cores at each snapshot of the timeline, and of the future */
  snapc1: number;
  snapc2: number;
  /** entries in all */
  total: number;
}

export interface MergerDesc {
  p: MergerParams;
  /**
   * The key of the test stars' counter RNG (initial conditions, marks): the seed, or another when
   * the goldens re-key the placement and keep every structural choice (ADR 0015).
   */
  key: number;
  /** the reference's track, and the track the stars follow (thinned when the budget says so) */
  ref: CoreTrack;
  track: CoreTrack;
  budget: SnapshotBudget;
  /** stars per galaxy and in all */
  n: [number, number];
  total: number;
  gals: [GalaxyIC, GalaxyIC];
  /** the cores' f32 positions, vec4 entries (x, y, z, 0), at the offsets below */
  cores: Float32Array<ArrayBuffer>;
  off: CoreOffsets;
  /** f16 table rows of the timeline and of the future */
  rows: [number, number];
  /** the picks the description was made with (a replay, or the engine's own) */
  picks: MergerPicks | undefined;
}

/** What the model tier needs to integrate a merger: the track, the stars' frames and the snapshot plan. */
export function describeMerger(
  P: Params | MergerParams,
  picks?: MergerPicks,
  key?: number,
): MergerDesc {
  const p = mergerParamsOf(P);
  const ref = coreTrack(p);
  const { n, total } = starCounts(p);
  const budget = snapshotBudget(total, ref);
  const track =
    budget.stride[0] === 1 && budget.stride[1] === 1 ? ref : coreTrack(p, budget.stride);
  const gals = galaxyICs(p, track, picks);
  const rows: [number, number] = [track.chosen.nSnaps - 1, track.future.nSnaps - 1];
  const k1 = Math.max(track.chosen.steps, 0) + 1;
  const k2 = Math.max(track.future.steps, 0) + 1;
  const off: CoreOffsets = {
    pos1: 0,
    pos2: k1 * 2,
    snapc1: (k1 + k2) * 2,
    snapc2: (k1 + k2 + track.chosen.nSnaps) * 2,
    total: (k1 + k2 + track.chosen.nSnaps + track.future.nSnaps) * 2,
  };
  const cores = new Float32Array(off.total * 4);
  const put = (entry: number, c: ArrayLike<number>, o: number) => {
    cores[entry * 4] = c[o] as number;
    cores[entry * 4 + 1] = c[o + 1] as number;
    cores[entry * 4 + 2] = c[o + 2] as number;
  };
  for (let k = 0; k < k1; k++)
    for (let g = 0; g < 2; g++) put(off.pos1 + k * 2 + g, track.chosen.pos, k * 6 + g * 3);
  for (let k = 0; k < k2; k++)
    for (let g = 0; g < 2; g++) put(off.pos2 + k * 2 + g, track.future.pos, k * 6 + g * 3);
  for (let s = 0; s < track.chosen.nSnaps; s++)
    for (let g = 0; g < 2; g++) put(off.snapc1 + s * 2 + g, track.chosen.snaps, s * 12 + g * 6);
  for (let s = 0; s < track.future.nSnaps; s++)
    for (let g = 0; g < 2; g++) put(off.snapc2 + s * 2 + g, track.future.snaps, s * 12 + g * 6);
  return {
    p,
    key: (key ?? p.seed) >>> 0,
    ref,
    track,
    budget,
    n,
    total,
    gals,
    cores,
    off,
    rows,
    picks,
  };
}

/** The memory the stars take on the GPU, in bytes (ADR 0009's budget). */
export function memoryBudget(d: MergerDesc): Record<string, number> {
  const N = d.total;
  const out = {
    state: N * 16 * 2,
    ic: N * 16,
    timelineF16: d.rows[0] * N * 8,
    futureF16: d.rows[1] * N * 8,
    closingF32: 2 * N * 16,
    cores: d.cores.byteLength,
    current: N * 16,
  };
  return { ...out, total: Object.values(out).reduce((a, b) => a + b, 0) };
}
