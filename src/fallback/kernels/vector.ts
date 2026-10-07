/**
 * Vector drawings to capsules and sprites, and the streams' marks: the CPU twin of
 * src/shaders/compute/vector-expand.wgsl (ADR 0011, 0014), entry point for entry point, in f32
 * through `Math.fround`.
 *
 * 1. `expandCap`: one capsule slot. Unwarped, one segment of the drawing; warped, one piece of a
 *    segment densified to ≤ 0.012 tile units (expandVector, app23.js:L1202). Both ends through
 *    `tf` (the warp, the matrix, the wobble), half width `PEN.line/2·ps` plate px (ADR 0006). A
 *    warped segment longer than 22 px is dropped (L1207); under the `post` hook, one stretched
 *    more than 1.8× too (L1208).
 * 2. `expandDot`: a vector dot as a `dots` sprite, its drawing from the hand by the coordinate
 *    hash, sized `dotSprite(t, clamp(2r·sc·0.42/2.6, 0.8, 1.6)·max(0.55, ps))` (L1215).
 * 3. `expandBlob`: a blob as a `knots` sprite with the matrix `M·R(θ)·S(…)` (L1217).
 * 4. `streamMark`: one slot of a stream's segment: kept with probability `0.55 + 0.45·streams`, a
 *    dot (`dotSprite(t, 0.95)`) or one time in 25 a knot, along the segment plus a gaussian of
 *    1.4 px, through the wobble (L1076–1080). Its random numbers are on the `partMarks` stream.
 * 5. The compaction (`runVectors`): kept capsules and marks in slot order, as the GPU's scan.
 *
 * v21 parity: every vertex, dot and blob has alpha 1 (reference notes 20.10).
 */
import { cosF, randGaussF, sinF } from '../../core/f32math';
import { randF32 } from '../../core/rng';
import { Stream } from '../../core/streams';
import type { NoiseField } from '../../core/noise';
import { DRAWING_WORDS, type PackedVectors } from '../../marks/vector';
import { KNOT_POOL } from '../../model/galaxy';
import { CAPSULE_WORDS } from '../../model/ribbons';
import { INACTIVE } from '../../model/dynvec';
import { STREAM_SEG_WORDS, VINST_WORDS, WarpKind, type VectorView } from '../../model/vectors';
import { smWarp } from '../../view/warp';
import { INSTANCE_WORDS } from './project';
import type { TideData } from './tide';

const f = Math.fround;
const sqrt = (x: number) => f(Math.sqrt(x));
const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);

/** The `Vec` uniform's numbers (src/model/vectors.ts `vectorView`). */
export type VecUniform = Record<string, number>;

/** What the kernels read: the library, this view's instances and streams, the galaxy's pools. */
export interface VectorInputs {
  lib: PackedVectors;
  instF: Float32Array;
  instU: Uint32Array;
  ssegF: Float32Array;
  ssegU: Uint32Array;
  vu: VecUniform;
  pool: Uint32Array;
  dotBase: Float32Array;
  noise: NoiseField;
  /** a merging galaxy's tidal map (M8), for the tide warps */
  tide?: TideData;
}

export function vectorInputs(
  lib: PackedVectors,
  view: VectorView,
  pool: Uint32Array,
  dotBase: Float32Array,
  noise: NoiseField,
  tide?: TideData,
): VectorInputs {
  return {
    lib,
    instF: new Float32Array(view.inst),
    instU: new Uint32Array(view.inst),
    ssegF: new Float32Array(view.streamSegs),
    ssegU: new Uint32Array(view.streamSegs),
    vu: view.uniform,
    pool,
    dotBase,
    noise,
    ...(tide ? { tide } : {}),
  };
}

/** The last index in [0, n) whose key is at or before i (a binary search, as the GPU's). */
function lastAtOrBefore(lo0: number, n: number, i: number, key: (k: number) => number): number {
  let lo = lo0;
  let hi = lo0 + n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (key(mid) <= i) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** An instance's fields. */
interface Inst {
  m: [number, number, number, number];
  tx: number;
  ty: number;
  ps: number;
  sc: number;
  w: [number, number, number, number];
  w2: [number, number, number, number];
  drawing: number;
  warp: number;
  capFirst: number;
  dotFirst: number;
  blobFirst: number;
}

function inst(X: VectorInputs, k: number): Inst {
  const o = k * VINST_WORDS;
  const F = X.instF;
  const U = X.instU;
  const g = (j: number) => F[o + j] ?? 0;
  return {
    m: [g(0), g(1), g(2), g(3)],
    tx: g(4),
    ty: g(5),
    ps: g(6),
    sc: g(7),
    w: [g(8), g(9), g(10), g(11)],
    w2: [g(12), g(13), g(14), g(15)],
    drawing: U[o + 16] ?? 0,
    warp: U[o + 17] ?? 0,
    capFirst: U[o + 18] ?? 0,
    dotFirst: U[o + 19] ?? 0,
    blobFirst: U[o + 20] ?? 0,
  };
}

/** The instance holding slot i (field 18: capsule, 19: dot, 20: blob). */
function instOf(X: VectorInputs, i: number, field: number): Inst {
  const n = X.vu.n_inst ?? 0;
  return inst(
    X,
    lastAtOrBefore(0, n, i, (k) => X.instU[k * VINST_WORDS + field] ?? 0),
  );
}

/** The spiral rewind (rewindFn, app23.js:L844), as `rewind` in vector-expand.wgsl. */
export function rewindF(px: number, py: number, dk: number, flip: boolean): [number, number] {
  const x = flip ? -px : px;
  const y = py;
  const rr = sqrt(f(f(x * x) + f(y * y)));
  if (rr < f(0.015)) return [x, y];
  const phi = f(dk * f(Math.log(f(rr / f(0.08)))));
  const c = cosF(phi);
  const s = sinF(phi);
  return [f(f(x * c) - f(y * s)), f(f(x * s) + f(y * c))];
}

function place(I: Inst, x: number, y: number): [number, number] {
  const m = I.m;
  return [f(f(I.tx + f(m[0] * x)) + f(m[2] * y)), f(f(I.ty + f(m[1] * x)) + f(m[3] * y))];
}

function post(I: Inst, q: [number, number]): [number, number] {
  const dx = f(q[0] - I.w[0]);
  const dy = f(q[1] - I.w[1]);
  const S = I.w2;
  return [f(f(I.w[0] + f(S[0] * dx)) + f(S[2] * dy)), f(f(I.w[1] + f(S[1] * dx)) + f(S[3] * dy))];
}

/** expandVector's tf (app23.js:L1194–1198): the warp, the matrix, the wobble. */
function tf(X: VectorInputs, I: Inst, x: number, y: number): [number, number] {
  const wob = X.vu.wobble ?? 0;
  let q: [number, number];
  if (I.warp === WarpKind.rewind) {
    const r = rewindF(x, y, I.w[0], I.w[1] !== 0);
    q = place(I, r[0], r[1]);
  } else if (I.warp === WarpKind.post) q = post(I, place(I, x, y));
  else if (I.warp === WarpKind.tide) {
    if (!X.tide) throw new Error('a tide warp needs the tidal map');
    const p = place(I, x, y);
    q = X.tide.post(I.w[0], p[0], p[1], I.w[1]);
  } else if (I.warp === WarpKind.tideScreen) {
    if (!X.tide) throw new Error('a tide warp needs the tidal map');
    q = X.tide.nn(I.w[0], I.w[1] !== 0 ? -x : x, y);
  } else q = place(I, x, y);
  return smWarp(q[0], q[1], wob, X.noise);
}

/** 1. Capsule slot `i`: into `out` (CAPSULE_WORDS each); returns its key (0 kept, else dropped). */
export function expandCap(X: VectorInputs, i: number, out: Float32Array): number {
  const I = instOf(X, i, 18);
  const k = i - I.capFirst;
  const T = X.lib.table;
  const o = I.drawing * DRAWING_WORDS;
  if (I.drawing === INACTIVE || (I.warp === WarpKind.none && k >= (T[o + 1] ?? 0))) {
    out.fill(0, i * CAPSULE_WORDS, (i + 1) * CAPSULE_WORDS);
    return 1;
  }
  const S = X.lib.segs;
  let ra: [number, number];
  let rb: [number, number];
  if (I.warp === WarpKind.none) {
    const s = ((T[o] ?? 0) + k) * 4;
    ra = [S[s] ?? 0, S[s + 1] ?? 0];
    rb = [S[s + 2] ?? 0, S[s + 3] ?? 0];
  } else {
    const piece = (T[o + 6] ?? 0) + k;
    const dens = X.lib.dens;
    const s = lastAtOrBefore(T[o] ?? 0, T[o + 1] ?? 0, piece, (q) => dens[q] ?? 0);
    const n = f((dens[s + 1] ?? 0) - (dens[s] ?? 0));
    const m = f(piece - (dens[s] ?? 0));
    const ax = S[s * 4] ?? 0;
    const ay = S[s * 4 + 1] ?? 0;
    const dx = f((S[s * 4 + 2] ?? 0) - ax);
    const dy = f((S[s * 4 + 3] ?? 0) - ay);
    const fa = f(m / n);
    const fb = f(f(m + 1) / n);
    ra = [f(ax + f(dx * fa)), f(ay + f(dy * fa))];
    rb = [f(ax + f(dx * fb)), f(ay + f(dy * fb))];
  }
  const a = tf(X, I, ra[0], ra[1]);
  const b = tf(X, I, rb[0], rb[1]);
  let key = 0;
  if (I.warp !== WarpKind.none) {
    const dx = f(b[0] - a[0]);
    const dy = f(b[1] - a[1]);
    const ml = sqrt(f(f(dx * dx) + f(dy * dy)));
    if (ml > 22) key = 1;
    if (I.warp === WarpKind.post || I.warp === WarpKind.tide) {
      const ex = f(rb[0] - ra[0]);
      const ey = f(rb[1] - ra[1]);
      const ox = f(f(I.m[0] * ex) + f(I.m[2] * ey));
      const oy = f(f(I.m[1] * ex) + f(I.m[3] * ey));
      const ol = f(sqrt(f(f(ox * ox) + f(oy * oy))) + f(0.8));
      if (f(ml / ol) > f(1.8)) key = 1;
    }
  }
  const oo = i * CAPSULE_WORDS;
  out[oo] = a[0];
  out[oo + 1] = a[1];
  out[oo + 2] = b[0];
  out[oo + 3] = b[1];
  out[oo + 4] = f(f((X.vu.pen_line ?? 2.4) / 2) * I.ps);
  out[oo + 5] = 1;
  out[oo + 6] = 0;
  out[oo + 7] = 0;
  return key;
}

/** 2. Dot `i` as a `dots` sprite (INSTANCE_WORDS). */
export function expandDot(X: VectorInputs, i: number, outF: Float32Array, outU: Uint32Array) {
  const I = instOf(X, i, 19);
  if (
    I.drawing === INACTIVE ||
    i - I.dotFirst >= (X.lib.table[I.drawing * DRAWING_WORDS + 3] ?? 0)
  ) {
    outF.fill(0, i * INSTANCE_WORDS, (i + 1) * INSTANCE_WORDS);
    return;
  }
  const d = ((X.lib.table[I.drawing * DRAWING_WORDS + 2] ?? 0) + i - I.dotFirst) * 4;
  const D = X.lib.dots;
  const [px, py] = tf(X, I, D[d] ?? 0, D[d + 1] ?? 0);
  const nPool = Math.max(1, X.vu.n_dot_pool ?? 1);
  const t = X.pool[KNOT_POOL + ((D[d + 3] ?? 0) % nPool)] ?? 0;
  const k0 = clamp(f(f(f(f(f(2) * (D[d + 2] ?? 0)) * I.sc) * f(0.42)) / f(2.6)), f(0.8), f(1.6));
  const k = f(k0 * Math.max(f(0.55), I.ps));
  const size = f((X.dotBase[t] ?? 0) * k);
  const oo = i * INSTANCE_WORDS;
  outF[oo] = px;
  outF[oo + 1] = py;
  outU[oo + 2] = t;
  outF[oo + 3] = 1;
  outF[oo + 4] = size;
  outF[oo + 5] = 0;
  outF[oo + 6] = 0;
  outF[oo + 7] = size;
}

/** 3. Blob `i` as a `knots` sprite. */
export function expandBlob(X: VectorInputs, i: number, outF: Float32Array, outU: Uint32Array) {
  const I = instOf(X, i, 20);
  if (
    I.drawing === INACTIVE ||
    i - I.blobFirst >= (X.lib.table[I.drawing * DRAWING_WORDS + 5] ?? 0)
  ) {
    outF.fill(0, i * INSTANCE_WORDS, (i + 1) * INSTANCE_WORDS);
    return;
  }
  const b = ((X.lib.table[I.drawing * DRAWING_WORDS + 4] ?? 0) + i - I.blobFirst) * 8;
  const B = X.lib.blobs;
  const [px, py] = tf(X, I, B[b] ?? 0, B[b + 1] ?? 0);
  const t = X.pool[(B[b + 6] ?? 0) % KNOT_POOL] ?? 0;
  const lim = f(f(3) / I.sc);
  const sx = Math.max(f(f(f(2) * (B[b + 2] ?? 0)) * f(0.85)), lim);
  const sy = Math.max(f(f(f(2) * (B[b + 3] ?? 0)) * f(0.85)), lim);
  const c = B[b + 4] ?? 1;
  const s = B[b + 5] ?? 0;
  const m = I.m;
  const r0 = f(f(m[0] * c) + f(m[2] * s));
  const r1 = f(f(m[1] * c) + f(m[3] * s));
  const r2 = f(f(m[2] * c) - f(m[0] * s));
  const r3 = f(f(m[3] * c) - f(m[1] * s));
  const oo = i * INSTANCE_WORDS;
  outF[oo] = px;
  outF[oo + 1] = py;
  outU[oo + 2] = t;
  outF[oo + 3] = 1;
  outF[oo + 4] = f(r0 * sx);
  outF[oo + 5] = f(r1 * sx);
  outF[oo + 6] = f(r2 * sy);
  outF[oo + 7] = f(r3 * sy);
}

/** 4. Stream slot `i`: a mark into `outF/outU`; returns its class (0 dot, 1 knot, -1 dropped). */
export function streamMark(
  X: VectorInputs,
  i: number,
  outF: Float32Array,
  outU: Uint32Array,
): number {
  const nSeg = X.vu.n_stream_segs ?? 0;
  const sIdx = lastAtOrBefore(0, nSeg, i, (k) => X.ssegU[k * STREAM_SEG_WORDS + 4] ?? 0);
  const o = sIdx * STREAM_SEG_WORDS;
  const SF = X.ssegF;
  const first = X.ssegU[o + 4] ?? 0;
  const n = X.ssegU[o + 5] ?? 1;
  const m2 = i - first;
  const idx = ((X.ssegU[o + 6] ?? 0) + m2) >>> 0;
  const key = (X.vu.key ?? 0) >>> 0;
  const S = Stream.partMarks;
  const oo = i * INSTANCE_WORDS;
  if (randF32(key, S, idx, 0) > f(X.vu.stream_keep ?? 1)) {
    outF.fill(0, oo, oo + INSTANCE_WORDS);
    return -1;
  }
  const nPool = X.vu.n_dot_pool ?? 1;
  const tt = X.pool[KNOT_POOL + Math.floor(f(randF32(key, S, idx, 1) * nPool))] ?? 0;
  const gx = randGaussF(key, S, idx, 2);
  const gy = randGaussF(key, S, idx, 4);
  const fr = f(m2 / n);
  const p0x = SF[o] ?? 0;
  const p0y = SF[o + 1] ?? 0;
  const x = f(f(p0x + f(f((SF[o + 2] ?? 0) - p0x) * fr)) + f(gx * f(1.4)));
  const y = f(f(p0y + f(f((SF[o + 3] ?? 0) - p0y) * fr)) + f(gy * f(1.4)));
  const [px, py] = smWarp(x, y, X.vu.wobble ?? 0, X.noise);
  let tile = tt;
  let size = f((X.dotBase[tt] ?? 0) * f(0.95));
  let cls = 0;
  let rot: number;
  if (randF32(key, S, idx, 6) < f(0.04)) {
    tile = X.pool[Math.floor(f(randF32(key, S, idx, 7) * KNOT_POOL))] ?? 0;
    size = f(f(f(3) + f(f(3) * randF32(key, S, idx, 8))) * f(X.vu.pen_dot ?? 1));
    rot = f(randF32(key, S, idx, 9) * f(6.28));
    cls = 1;
  } else rot = f(randF32(key, S, idx, 7) * f(6.28));
  const c = cosF(rot);
  const s = sinF(rot);
  outF[oo] = px;
  outF[oo + 1] = py;
  outU[oo + 2] = tile;
  outF[oo + 3] = 1;
  outF[oo + 4] = f(c * size);
  outF[oo + 5] = f(s * size);
  outF[oo + 6] = -f(s * size);
  outF[oo + 7] = f(c * size);
  return cls;
}

/** Everything the vector expansion writes, compacted as the GPU's scan does. */
export interface VectorOut {
  /** kept capsules, in slot order */
  caps: Float32Array;
  nCaps: number;
  dots: Float32Array;
  dotsU: Uint32Array;
  blobs: Float32Array;
  blobsU: Uint32Array;
  /** the streams' dots and knots, kept, in slot order */
  sdots: Float32Array;
  sdotsU: Uint32Array;
  nSdots: number;
  sknots: Float32Array;
  sknotsU: Uint32Array;
  nSknots: number;
  /** before compaction (parity tests) */
  capsRaw: Float32Array;
  capKeys: Uint32Array;
}

/** Runs every entry point, as GpuVectors dispatches them. */
export function runVectors(X: VectorInputs): VectorOut {
  const vu = X.vu;
  const words = (n: number, w: number) => new ArrayBuffer(Math.max(1, n) * w * 4);
  const nCapSlots = vu.n_cap_slots ?? 0;
  const capsRaw = new Float32Array(words(nCapSlots, CAPSULE_WORDS));
  const capKeys = new Uint32Array(Math.max(1, nCapSlots));
  for (let i = 0; i < nCapSlots; i++) capKeys[i] = expandCap(X, i, capsRaw) ? 0xffffffff : 0;
  const caps = new Float32Array(words(nCapSlots, CAPSULE_WORDS));
  let nCaps = 0;
  for (let i = 0; i < nCapSlots; i++)
    if (capKeys[i] === 0) {
      caps.set(capsRaw.subarray(i * CAPSULE_WORDS, (i + 1) * CAPSULE_WORDS), nCaps * CAPSULE_WORDS);
      nCaps++;
    }
  const nDots = vu.n_dots ?? 0;
  const db = words(nDots, INSTANCE_WORDS);
  const dots = new Float32Array(db);
  const dotsU = new Uint32Array(db);
  for (let i = 0; i < nDots; i++) expandDot(X, i, dots, dotsU);
  const nBlobs = vu.n_blobs ?? 0;
  const bb = words(nBlobs, INSTANCE_WORDS);
  const blobs = new Float32Array(bb);
  const blobsU = new Uint32Array(bb);
  for (let i = 0; i < nBlobs; i++) expandBlob(X, i, blobs, blobsU);
  const nSlots = vu.n_stream_slots ?? 0;
  const mb = words(nSlots, INSTANCE_WORDS);
  const raw = new Float32Array(mb);
  const rawU = new Uint32Array(mb);
  const sd = words(nSlots, INSTANCE_WORDS);
  const sk = words(nSlots, INSTANCE_WORDS);
  const sdots = new Float32Array(sd);
  const sknots = new Float32Array(sk);
  let nSdots = 0;
  let nSknots = 0;
  for (let i = 0; i < nSlots; i++) {
    const c = streamMark(X, i, raw, rawU);
    const src = raw.subarray(i * INSTANCE_WORDS, (i + 1) * INSTANCE_WORDS);
    if (c === 0) sdots.set(src, INSTANCE_WORDS * nSdots++);
    else if (c === 1) sknots.set(src, INSTANCE_WORDS * nSknots++);
  }
  return {
    caps,
    nCaps,
    dots,
    dotsU,
    blobs,
    blobsU,
    sdots,
    sdotsU: new Uint32Array(sd),
    nSdots,
    sknots,
    sknotsU: new Uint32Array(sk),
    nSknots,
    capsRaw,
    capKeys,
  };
}
