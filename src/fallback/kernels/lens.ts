/**
 * The lens kernels on the CPU: twins of src/shaders/compute/lens-grid.wgsl, lens-bin.wgsl and
 * lens-query.wgsl (ADR 0008, 0011, 0014), function for function, in f32 through `Math.fround`.
 *
 * Lens tier (per solver; rebuilt when the lens changes, not when the camera moves):
 * 1. `gridKernel`: the deflection at every vertex of the (G + 1)² image-plane grid, giving each its
 *    source-plane position β = x − α(x), and the grid's extent in β (v21's `lensSolver`, L609–612).
 * 2. `binKernels`: each triangle's source-plane bounding box in integer bins, the > 400-bin skip, a
 *    count, a deterministic prefix sum and a scatter into bins, then the triangle ids of every bin
 *    sorted ascending, so a bin's contents never depend on scheduling (ADR 0004, 0008).
 *
 * View tier (per camera):
 * 3. `findImages`: every image of a source point: a barycentric test over the triangles of its bin
 *    in id order, image position, Jacobian J and magnification μ = det J (parity = its sign),
 *    de-duplicated within 0.6 cells in that canonical order, at most MAX_IMAGES (L614–627).
 * 4. `queryMark`, `countSlot`, `emitSlot`: one mark's images; how many marks each image emits
 *    (the stipple's ⌊κ·min(30, |μ|) + u⌋, knots and stars kept at 0.55 and scaled by μ^¼) from the
 *    counter RNG; and the marks themselves (lensMarks, L646–671). κ comes from a fixed-point sum
 *    of the magnification, so it is the same on every adapter.
 * 5. `trackCurve`, `gatherBranches`: v21's greedy matcher over a resampled curve, one curve at a
 *    time, and the surviving branches laid out as the ribbons' curves.
 * 6. `lensVectorInst`, `quasarImages`, `quasarSlot`: the warped drawings' per-image instances, and
 *    the quasar's images with their time delays and flares, each image's star (lensStar, L672).
 */
import { cosF, randGaussF, sinF } from '../../core/f32math';
import { randF32 } from '../../core/rng';
import { Stream } from '../../core/streams';
import { smWarp } from '../../view/warp';
import type { NoiseField } from '../../core/noise';
import { EMIT_INDEX, HALO_WORDS, MAX_BINS, MAX_IMAGES, type SolverDesc } from '../../sim/lens';

const f = Math.fround;
const sqrt = (x: number) => f(Math.sqrt(x));
const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);

/** Words per image of a query: x, y, μ, triangle id (u32), J (4). */
export const IMG_WORDS = 8;
/** Words per source mark: b (2), tile (u32), alpha, m (4), class (u32), source (u32), pad (2). */
export const LMARK_WORDS = 12;
/** Mark classes: the stipple's (src/model/classes.ts) and the drawn core. */
export const LensCls = { old: 0, disc: 1, young: 2, knot: 3, star: 4, rstar: 5, core: 6 } as const;
export const LENS_CLASSES = 7;
/** Fixed point of the magnification sum: 2^8, so 70k marks of 8 images at 30 stay within a u32. */
export const KAPPA_FIXED = 256;
/** The stream of emission draws (src/core/streams.ts: `lens`). */
export const STREAM_LENS = Stream.lens;
/** The class of a mark that is not made: a stipple sample the source's own culls removed. */
export const MARK_NONE = 255;
/** A mark's slots: one per image. */
export const SLOTS = MAX_IMAGES;

// ---------------------------------------------------------------------------------------------
// 1. The grid

/** Floats per grid vertex: x, y (image plane), βx, βy (source plane). */
export const VERT_WORDS = 4;

/** The deflection at (x, y) (`alpha`, L599–605), in f32 as lens-grid.wgsl `deflect`. */
export function deflectF(d: SolverDesc, x: number, y: number): [number, number] {
  let ax = 0;
  let ay = 0;
  const H = d.halos;
  for (let k = 0; k < d.nHalo; k++) {
    const o = k * HALO_WORDS;
    const hx = H[o] ?? 0;
    const hy = H[o + 1] ?? 0;
    const ca = H[o + 2] ?? 1;
    const sa = H[o + 3] ?? 0;
    const q = H[o + 4] ?? 1;
    const s = H[o + 5] ?? 0;
    const e = H[o + 6] ?? 0;
    const kk = H[o + 7] ?? 0;
    const dx = f(x - hx);
    const dy = f(y - hy);
    const u = f(f(dx * ca) + f(dy * sa));
    const v = f(f(f(-dx) * sa) + f(dy * ca));
    const q2 = f(q * q);
    const ps = sqrt(f(f(q2 * f(f(s * s) + f(u * u))) + f(v * v)));
    const au = f(kk * f(Math.atan(f(f(e * u) / f(ps + s)))));
    const t = clamp(f(f(e * v) / f(ps + f(q2 * s))), f(-0.999999), f(0.999999));
    const av = f(kk * f(f(0.5) * f(Math.log(f(f(f(1) + t) / f(f(1) - t))))));
    ax = f(ax + f(f(au * ca) - f(av * sa)));
    ay = f(ay + f(f(au * sa) + f(av * ca)));
  }
  const [g, c2, s2] = d.shear;
  ax = f(ax + f(g * f(f(c2 * x) + f(s2 * y))));
  ay = f(ay + f(g * f(f(s2 * x) - f(c2 * y))));
  return [f(ax * d.f), f(ay * d.f)];
}

export interface GridOut {
  /** (G + 1)² vertices of VERT_WORDS */
  verts: Float32Array;
  bx0: number;
  bx1: number;
  by0: number;
  by1: number;
}

export function gridKernel(d: SolverDesc): GridOut {
  const n = d.G + 1;
  const verts = new Float32Array(n * n * VERT_WORDS);
  let bx0 = Infinity;
  let bx1 = -Infinity;
  let by0 = Infinity;
  let by1 = -Infinity;
  const R = d.R;
  const G = d.G;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = f(-R + f(f(f(2 * R) * i) / G));
      const y = f(-R + f(f(f(2 * R) * j) / G));
      const [ax, ay] = deflectF(d, x, y);
      const bx = f(x - ax);
      const by = f(y - ay);
      const o = (j * n + i) * VERT_WORDS;
      verts[o] = x;
      verts[o + 1] = y;
      verts[o + 2] = bx;
      verts[o + 3] = by;
      if (bx < bx0) bx0 = bx;
      if (bx > bx1) bx1 = bx;
      if (by < by0) by0 = by;
      if (by > by1) by1 = by;
    }
  return { verts, bx0, bx1, by0, by1 };
}

// ---------------------------------------------------------------------------------------------
// 2. The bins

/** The solver as the query kernels see it. */
export interface SolverTier {
  d: SolverDesc;
  /** vertices per side */
  n: number;
  /** bins per side (v21's H = G) */
  H: number;
  verts: Float32Array;
  bx0: number;
  by0: number;
  cw: number;
  ch: number;
  /** bin b holds ids[offsets[b] .. offsets[b + 1]) */
  offsets: Uint32Array;
  ids: Uint32Array;
  /** triangles skipped for covering more than MAX_BINS bins */
  skipped: number;
  /** the id table's total, against the capacity the GPU allocates */
  idTotal: number;
}

/** The ids' capacity per triangle on the GPU (src/render/lens.ts); a total past it is reported. */
export const ID_CAP_PER_TRIANGLE = 24;

/** A triangle's vertex indices: the cell's two halves, `[a0, a1, a3]` then `[a0, a3, a2]` (L616–617). */
export function triangleVerts(t: number, G: number): [number, number, number] {
  const n = G + 1;
  const cell = t >>> 1;
  const i2 = cell % G;
  const j2 = Math.floor(cell / G);
  const a0 = j2 * n + i2;
  const a1 = a0 + 1;
  const a2 = a0 + n;
  const a3 = a2 + 1;
  return t & 1 ? [a0, a3, a2] : [a0, a1, a3];
}

/** A triangle's bins: [ix0, ix1, iy0, iy1], or null when it straddles a caustic (L619–621). */
export function triangleBins(
  verts: Float32Array,
  t: number,
  G: number,
  bx0: number,
  by0: number,
  cw: number,
  ch: number,
): [number, number, number, number] | null {
  const [v0, v1, v2] = triangleVerts(t, G);
  const x0 = verts[v0 * VERT_WORDS + 2] ?? 0;
  const x1 = verts[v1 * VERT_WORDS + 2] ?? 0;
  const x2 = verts[v2 * VERT_WORDS + 2] ?? 0;
  const y0 = verts[v0 * VERT_WORDS + 3] ?? 0;
  const y1 = verts[v1 * VERT_WORDS + 3] ?? 0;
  const y2 = verts[v2 * VERT_WORDS + 3] ?? 0;
  const hi = G - 1;
  const bin = (v: number, lo: number, w: number) => clamp(Math.floor(f(f(v - lo) / w)), 0, hi);
  const ix0 = bin(Math.min(x0, x1, x2), bx0, cw);
  const ix1 = bin(Math.max(x0, x1, x2), bx0, cw);
  const iy0 = bin(Math.min(y0, y1, y2), by0, ch);
  const iy1 = bin(Math.max(y0, y1, y2), by0, ch);
  if ((ix1 - ix0 + 1) * (iy1 - iy0 + 1) > MAX_BINS) return null;
  return [ix0, ix1, iy0, iy1];
}

/**
 * Count, prefix sum, scatter and per-bin sort, as lens-bin.wgsl (`bin_count`, `scan_*`,
 * `bin_scatter`, `bin_sort`). The scatter order on the GPU is whatever the atomics give; the sort
 * makes it canonical, so this twin scatters in triangle order and the result is the same.
 */
export function binKernels(d: SolverDesc, g: GridOut): SolverTier {
  const G = d.G;
  const H = G;
  const nTri = 2 * G * G;
  const cw0 = f(f(g.bx1 - g.bx0) / H);
  const ch0 = f(f(g.by1 - g.by0) / H);
  const cw = cw0 || 1;
  const ch = ch0 || 1;
  const counts = new Uint32Array(H * H);
  let skipped = 0;
  for (let t = 0; t < nTri; t++) {
    const b = triangleBins(g.verts, t, G, g.bx0, g.by0, cw, ch);
    if (!b) {
      skipped++;
      continue;
    }
    for (let y = b[2]; y <= b[3]; y++)
      for (let x = b[0]; x <= b[1]; x++) counts[y * H + x] = (counts[y * H + x] ?? 0) + 1;
  }
  const offsets = new Uint32Array(H * H + 1);
  for (let i = 0; i < H * H; i++) offsets[i + 1] = (offsets[i] ?? 0) + (counts[i] ?? 0);
  const total = offsets[H * H] ?? 0;
  const ids = new Uint32Array(Math.max(1, total));
  const cursor = new Uint32Array(H * H);
  for (let t = 0; t < nTri; t++) {
    const b = triangleBins(g.verts, t, G, g.bx0, g.by0, cw, ch);
    if (!b) continue;
    for (let y = b[2]; y <= b[3]; y++)
      for (let x = b[0]; x <= b[1]; x++) {
        const bin = y * H + x;
        ids[(offsets[bin] ?? 0) + (cursor[bin] ?? 0)] = t;
        cursor[bin] = (cursor[bin] ?? 0) + 1;
      }
  }
  // triangles were visited in id order, so every bin is already ascending: the GPU sorts
  return {
    d,
    n: G + 1,
    H,
    verts: g.verts,
    bx0: g.bx0,
    by0: g.by0,
    cw: f(cw),
    ch: f(ch),
    offsets,
    ids,
    skipped,
    idTotal: total,
  };
}

export function buildSolver(d: SolverDesc): SolverTier {
  return binKernels(d, gridKernel(d));
}

// ---------------------------------------------------------------------------------------------
// 3. Images

/** The images of one source point: up to MAX_IMAGES, canonical order. */
export interface ImageSet {
  n: number;
  /** x, y per image */
  p: Float32Array;
  /** J (4) per image: ∂x/∂β, row-major */
  J: Float32Array;
  mu: Float32Array;
  tri: Uint32Array;
}

export const newImageSet = (): ImageSet => ({
  n: 0,
  p: new Float32Array(2 * MAX_IMAGES),
  J: new Float32Array(4 * MAX_IMAGES),
  mu: new Float32Array(MAX_IMAGES),
  tri: new Uint32Array(MAX_IMAGES),
});

/** `images(px, py)` of v21's solver (L623–633), in f32. */
export function findImages(T: SolverTier, px: number, py: number, out: ImageSet): void {
  out.n = 0;
  const H = T.H;
  const fx = Math.floor(f(f(px - T.bx0) / T.cw));
  const fy = Math.floor(f(f(py - T.by0) / T.ch));
  if (!(fx >= 0 && fy >= 0 && fx < H && fy < H)) return;
  const bin = fy * H + fx;
  const lo = T.offsets[bin] ?? 0;
  const hi = T.offsets[bin + 1] ?? 0;
  const V = T.verts;
  const cell = T.d.cell;
  const dup = f(cell * f(0.6));
  for (let k = lo; k < hi && out.n < MAX_IMAGES; k++) {
    const t = T.ids[k] ?? 0;
    const [v0, v1, v2] = triangleVerts(t, T.d.G);
    const o0 = v0 * VERT_WORDS;
    const o1 = v1 * VERT_WORDS;
    const o2 = v2 * VERT_WORDS;
    const x0 = V[o0 + 2] ?? 0;
    const y0 = V[o0 + 3] ?? 0;
    const e1x = f((V[o1 + 2] ?? 0) - x0);
    const e1y = f((V[o1 + 3] ?? 0) - y0);
    const e2x = f((V[o2 + 2] ?? 0) - x0);
    const e2y = f((V[o2 + 3] ?? 0) - y0);
    const det = f(f(e1x * e2y) - f(e2x * e1y));
    if (Math.abs(det) < f(1e-12)) continue;
    const dx = f(px - x0);
    const dy = f(py - y0);
    const l1 = f(f(f(dx * e2y) - f(e2x * dy)) / det);
    const l2 = f(f(f(e1x * dy) - f(dx * e1y)) / det);
    if (l1 < f(-1e-6) || l2 < f(-1e-6) || f(l1 + l2) > f(1 + 1e-6)) continue;
    const tx0 = V[o0] ?? 0;
    const ty0 = V[o0 + 1] ?? 0;
    const f1x = f((V[o1] ?? 0) - tx0);
    const f1y = f((V[o1 + 1] ?? 0) - ty0);
    const f2x = f((V[o2] ?? 0) - tx0);
    const f2y = f((V[o2 + 1] ?? 0) - ty0);
    const ix = f(f(tx0 + f(l1 * f1x)) + f(l2 * f2x));
    const iy = f(f(ty0 + f(l1 * f1y)) + f(l2 * f2y));
    let isDup = false;
    for (let m = 0; m < out.n; m++)
      if (
        Math.abs(f((out.p[2 * m] ?? 0) - ix)) < dup &&
        Math.abs(f((out.p[2 * m + 1] ?? 0) - iy)) < dup
      ) {
        isDup = true;
        break;
      }
    if (isDup) continue;
    const j0 = f(f(f(f1x * e2y) - f(f2x * e1y)) / det);
    const j1 = f(f(f(f2x * e1x) - f(f1x * e2x)) / det);
    const j2 = f(f(f(f1y * e2y) - f(f2y * e1y)) / det);
    const j3 = f(f(f(f2y * e1x) - f(f1y * e2x)) / det);
    const n = out.n++;
    out.p[2 * n] = ix;
    out.p[2 * n + 1] = iy;
    out.J.set([j0, j1, j2, j3], 4 * n);
    out.mu[n] = f(f(j0 * j3) - f(j1 * j2));
    out.tri[n] = t;
  }
}

// ---------------------------------------------------------------------------------------------
// 4. Marks

/** The model tier's source marks (one per stipple sample that survived its culls, plus the cores). */
export interface LensMarks {
  n: number;
  f: Float32Array;
  u: Uint32Array;
}

export const lensMarks = (n: number): LensMarks => {
  const buf = new ArrayBuffer(Math.max(1, n) * LMARK_WORDS * 4);
  return { n, f: new Float32Array(buf), u: new Uint32Array(buf) };
};

/** A source as the view sees it. */
export interface LensSrcView {
  bc: [number, number];
  k: number;
  dens: number;
  solver: number;
}

/** The plate map `scr` (lensMarks, L647): lens units to plate units. */
export interface PlateMap {
  U: number;
  ca: number;
  sa: number;
}

export function scr(P: PlateMap, x: number, y: number): [number, number] {
  return [
    f(400 + f(f(f(x * P.ca) - f(y * P.sa)) * P.U)),
    f(400 + f(f(f(x * P.sa) + f(y * P.ca)) * P.U)),
  ];
}

/** A mark's images, and the fixed-point magnification of the dots among them. */
export interface QueryOut {
  /** per mark: MAX_IMAGES × IMG_WORDS */
  imgF: Float32Array;
  imgU: Uint32Array;
  imgN: Uint32Array;
  /** per source: Σ min(30, |μ|) of dot marks, fixed point (KAPPA_FIXED) */
  tot: Uint32Array;
}

export function newQueryOut(nMarks: number, nSrc: number): QueryOut {
  const buf = new ArrayBuffer(Math.max(1, nMarks) * MAX_IMAGES * IMG_WORDS * 4);
  return {
    imgF: new Float32Array(buf),
    imgU: new Uint32Array(buf),
    imgN: new Uint32Array(Math.max(1, nMarks)),
    tot: new Uint32Array(Math.max(1, nSrc)),
  };
}

const fixedMu = (mu: number) => Math.floor(f(f(Math.min(30, Math.abs(mu)) * KAPPA_FIXED) + f(0.5)));

/** Mark m's images (`query_marks`). */
export function queryMark(
  tiers: readonly SolverTier[],
  srcs: readonly LensSrcView[],
  M: LensMarks,
  m: number,
  Q: QueryOut,
  scratch: ImageSet,
): void {
  const o = m * LMARK_WORDS;
  const si = M.u[o + 9] ?? 0;
  const S = srcs[si] as LensSrcView;
  const T = tiers[S.solver] as SolverTier;
  // a sample its source's culls removed has no images
  if ((M.u[o + 8] ?? 0) === MARK_NONE) {
    Q.imgN[m] = 0;
    return;
  }
  findImages(T, f((M.f[o] ?? 0) + S.bc[0]), f((M.f[o + 1] ?? 0) + S.bc[1]), scratch);
  const base = m * MAX_IMAGES * IMG_WORDS;
  let sum = 0;
  for (let j = 0; j < scratch.n; j++) {
    const w = base + j * IMG_WORDS;
    Q.imgF[w] = scratch.p[2 * j] ?? 0;
    Q.imgF[w + 1] = scratch.p[2 * j + 1] ?? 0;
    Q.imgF[w + 2] = scratch.mu[j] ?? 0;
    Q.imgU[w + 3] = scratch.tri[j] ?? 0;
    for (let c = 0; c < 4; c++) Q.imgF[w + 4 + c] = scratch.J[4 * j + c] ?? 0;
    if ((M.u[o + 8] ?? 0) <= LensCls.young) sum += fixedMu(scratch.mu[j] ?? 0);
  }
  Q.imgN[m] = scratch.n;
  if (sum) Q.tot[si] = ((Q.tot[si] ?? 0) + sum) >>> 0;
}

/** κ of a source (L651–652): min(1.2, 0.5 dens / max(1, Σ)), from the fixed-point sum. */
export function kappaOf(S: LensSrcView, totFixed: number): number {
  const tot = f(totFixed / KAPPA_FIXED);
  return Math.min(f(1.2), f(f(f(0.5) * S.dens) / Math.max(1, tot)));
}

/**
 * How many marks slot `s` (mark `s >> 3`, image `s & 7`) emits: a dot ⌊κ·min(30, |μ|) + u⌋, a knot
 * or star one time in 0.55, a drawn star or core one (L654–666). 0 past the mark's images.
 */
export function countSlot(
  seed: number,
  srcs: readonly LensSrcView[],
  M: LensMarks,
  Q: QueryOut,
  s: number,
): number {
  const m = s >>> 3;
  const j = s & 7;
  if (j >= (Q.imgN[m] ?? 0)) return 0;
  const o = m * LMARK_WORDS;
  const cls = M.u[o + 8] ?? 0;
  // the drawings' anchors and curve points have images but emit no marks of their own
  if (cls > LensCls.core) return 0;
  if (cls === LensCls.rstar || cls === LensCls.core) return 1;
  const u = randF32(seed, STREAM_LENS, (EMIT_INDEX + s) >>> 0, 0);
  if (cls === LensCls.knot || cls === LensCls.star) return u > f(0.55) ? 0 : 1;
  const si = M.u[o + 9] ?? 0;
  const S = srcs[si] as LensSrcView;
  const mu = Math.min(30, Math.abs(Q.imgF[(m * MAX_IMAGES + j) * IMG_WORDS + 2] ?? 0));
  const kap = kappaOf(S, Q.tot[si] ?? 0);
  return Math.floor(f(f(kap * mu) + u));
}

/** The instances of slot `s`, `n` of them, into `out` at `at` (INSTANCE_WORDS each). */
export function emitSlot(
  seed: number,
  srcs: readonly LensSrcView[],
  M: LensMarks,
  Q: QueryOut,
  P: PlateMap,
  s: number,
  n: number,
  outF: Float32Array,
  outU: Uint32Array,
  at: number,
  cap: number,
): void {
  const m = s >>> 3;
  const j = s & 7;
  const o = m * LMARK_WORDS;
  const w = (m * MAX_IMAGES + j) * IMG_WORDS;
  const cls = M.u[o + 8] ?? 0;
  const S = srcs[M.u[o + 9] ?? 0] as LensSrcView;
  const qx = Q.imgF[w] ?? 0;
  const qy = Q.imgF[w + 1] ?? 0;
  const mu = Math.min(30, Math.abs(Q.imgF[w + 2] ?? 0));
  const layer = M.u[o + 2] ?? 0;
  const alpha = M.f[o + 3] ?? 1;
  const m0 = M.f[o + 4] ?? 0;
  const m1 = M.f[o + 5] ?? 0;
  const m2 = M.f[o + 6] ?? 0;
  const m3 = M.f[o + 7] ?? 0;
  const put = (c: number, x: number, y: number, k: number) => {
    const at8 = (at + c) * 8;
    if (at + c >= cap) return;
    outF[at8] = x;
    outF[at8 + 1] = y;
    outU[at8 + 2] = layer;
    outF[at8 + 3] = alpha;
    outF[at8 + 4] = f(m0 * k);
    outF[at8 + 5] = f(m1 * k);
    outF[at8 + 6] = f(m2 * k);
    outF[at8 + 7] = f(m3 * k);
  };
  if (cls <= LensCls.young) {
    const sig = f(f(1.3) * S.k);
    const idx = (EMIT_INDEX + s) >>> 0;
    const J0 = Q.imgF[w + 4] ?? 0;
    const J1 = Q.imgF[w + 5] ?? 0;
    const J2 = Q.imgF[w + 6] ?? 0;
    const J3 = Q.imgF[w + 7] ?? 0;
    for (let c = 0; c < n; c++) {
      const d0 = 1 + 4 * c;
      const gx = f(randGaussF(seed, STREAM_LENS, idx, d0) * sig);
      const gy = f(randGaussF(seed, STREAM_LENS, idx, d0 + 2) * sig);
      const tx = f(f(qx + f(J0 * gx)) + f(J1 * gy));
      const ty = f(f(qy + f(J2 * gx)) + f(J3 * gy));
      const [x, y] = scr(P, tx, ty);
      put(c, x, y, 1);
    }
    return;
  }
  const [x, y] = scr(P, qx, qy);
  if (cls === LensCls.knot || cls === LensCls.star) {
    // v21: scaled by μ^¼, clamped to 0.7–1.3 (L663)
    put(0, x, y, clamp(sqrt(sqrt(mu)), f(0.7), f(1.3)));
    return;
  }
  put(0, x, y, 1);
}

// ---------------------------------------------------------------------------------------------
// 5. Curves

/** A branch of a traced curve: its image points (lens units). */
export interface Branch {
  pts: [number, number][];
}

/** The branches kept per curve (the rest are dropped; a curve rarely has more than a dozen). */
export const MAX_BRANCHES = 24;

/**
 * v21's greedy matcher over a curve's resampled points (L656–662), reading the images the marks'
 * query found (`track_curves`): each live branch takes the nearest unused image within four cells,
 * in branch order (first of equals wins); an unmatched branch ends; an unused image starts a
 * branch. Branches are listed in birth order. Returns the branches (every one, kept or not: the
 * gather keeps those of at least three points) and how many births the cap refused.
 */
export function trackCurve(
  Q: QueryOut,
  firstMark: number,
  nPts: number,
  cell4: number,
): { branches: Branch[]; overflow: number } {
  const all: Branch[] = [];
  let live: number[] = [];
  let overflow = 0;
  for (let p = 0; p < nPts; p++) {
    const m = firstMark + p;
    const n = Q.imgN[m] ?? 0;
    const base = m * MAX_IMAGES * IMG_WORDS;
    const used: boolean[] = [];
    const next: number[] = [];
    for (const bi of live) {
      const br = all[bi] as Branch;
      const last = br.pts[br.pts.length - 1] as [number, number];
      let best = -1;
      let bd = cell4;
      for (let qi = 0; qi < n; qi++) {
        if (used[qi]) continue;
        const dx = f((Q.imgF[base + qi * IMG_WORDS] ?? 0) - last[0]);
        const dy = f((Q.imgF[base + qi * IMG_WORDS + 1] ?? 0) - last[1]);
        const d = sqrt(f(f(dx * dx) + f(dy * dy)));
        if (d < bd) {
          bd = d;
          best = qi;
        }
      }
      if (best >= 0) {
        used[best] = true;
        br.pts.push([
          Q.imgF[base + best * IMG_WORDS] ?? 0,
          Q.imgF[base + best * IMG_WORDS + 1] ?? 0,
        ]);
        next.push(bi);
      }
    }
    for (let qi = 0; qi < n; qi++)
      if (!used[qi]) {
        if (all.length >= MAX_BRANCHES) {
          overflow++;
          continue;
        }
        all.push({
          pts: [[Q.imgF[base + qi * IMG_WORDS] ?? 0, Q.imgF[base + qi * IMG_WORDS + 1] ?? 0]],
        });
        next.push(all.length - 1);
      }
    live = next;
  }
  return { branches: all, overflow };
}

// ---------------------------------------------------------------------------------------------
// 6. Vectors and the quasar

/** The affine of a warped drawing's image: `out = c' + S (q − a)` (L668), column-major S. */
export function imageAffine(
  P: PlateMap,
  k: number,
  qx: number,
  qy: number,
  J: readonly [number, number, number, number],
): { c: [number, number]; S: [number, number, number, number] } {
  const c = scr(P, qx, qy);
  const uk = f(P.U * k);
  const S00 = f(uk * f(f(P.ca * J[0]) - f(P.sa * J[2])));
  const S01 = f(uk * f(f(P.ca * J[1]) - f(P.sa * J[3])));
  const S10 = f(uk * f(f(P.sa * J[0]) + f(P.ca * J[2])));
  const S11 = f(uk * f(f(P.sa * J[1]) + f(P.ca * J[3])));
  return { c, S: [S00, S10, S01, S11] };
}

/** v21's limit on a warped drawing's magnification (L667): beyond it the image is dropped. */
export const VECTOR_MU_LIMIT = 40;

/** The quasar's images and what each draws (L679–682). */
export interface QuasarImage {
  x: number;
  y: number;
  /** the brightness B of lensStar */
  B: number;
}

/** Quasar knots per image at the brightest (round(8 + 40 · 1.6)), halo dots (round(120 + 1500 · 1.6)). */
export const QUASAR_KNOTS = 72;
export const QUASAR_HALO = 2520;
/** Slots per quasar image: knots, halo dots, and the drawn star. */
export const QUASAR_SLOTS = QUASAR_KNOTS + QUASAR_HALO + 1;
export const QUASAR_B_MAX = 1.6;

/** The lensing potential ψ (approximate), in f32 as `psi_at` of lens-query.wgsl. */
export function potentialF(d: SolverDesc, x: number, y: number): number {
  let pp = 0;
  const H = d.halos;
  for (let k = 0; k < d.nHalo; k++) {
    const o = k * HALO_WORDS;
    const ca = H[o + 2] ?? 1;
    const sa = H[o + 3] ?? 0;
    const s = H[o + 5] ?? 0;
    const b = H[o + 8] ?? 0;
    const qr = H[o + 9] ?? 1;
    const dx = f(x - (H[o] ?? 0));
    const dy = f(y - (H[o + 1] ?? 0));
    const u = f(f(dx * ca) + f(dy * sa));
    const v = f(f(f(-dx) * sa) + f(dy * ca));
    pp = f(pp + f(b * sqrt(f(f(f(f(qr * u) * u) + f(f(v * v) / qr)) + f(s * s)))));
  }
  const [g, c2, s2] = d.shear;
  const sh = f(f(f(0.5) * g) * f(f(c2 * f(f(x * x) - f(y * y))) + f(f(f(2) * s2) * f(x * y))));
  return f(f(pp + sh) * d.f);
}

/**
 * The quasar's images: |μ| > 0.08, time delay τ = ½|x − β|² − ψ(x), the flare at the moment
 * `now` = (mTime / 2) mod 1, and B = clamp((0.2 + 0.12 ln(1 + |μ|)) · flare, 0.15, 1.6)
 * (L679–683), as `quasar_images` of lens-query.wgsl.
 */
export function quasarImages(
  ims: ImageSet,
  bc: readonly [number, number],
  solver: SolverDesc,
  now: number,
): QuasarImage[] {
  const imgs: { x: number; y: number; mu: number; tau: number }[] = [];
  let t0 = 0;
  let t1 = f(1e-6);
  for (let j = 0; j < ims.n; j++) {
    const mu = ims.mu[j] ?? 0;
    if (!(Math.abs(mu) > f(0.08))) continue;
    const x = ims.p[2 * j] ?? 0;
    const y = ims.p[2 * j + 1] ?? 0;
    const ex = f(x - bc[0]);
    const ey = f(y - bc[1]);
    const tau = f(f(f(0.5) * f(f(ex * ex) + f(ey * ey))) - potentialF(solver, x, y));
    t0 = Math.min(t0, tau);
    t1 = Math.max(t1, tau);
    imgs.push({ x, y, mu, tau });
  }
  return imgs.map((q) => {
    const arrive = f(f(0.18) + f(f(f(0.55) * f(q.tau - t0)) / Math.max(f(1e-6), f(t1 - t0))));
    const dt = Math.min(Math.abs(f(now - arrive)), f(1 - Math.abs(f(now - arrive))));
    const flare = f(1 + f(f(3.2) * f(Math.exp(f(-f(dt * dt) / f(f(2) * f(0.05) * f(0.05)))))));
    const B = clamp(
      f(f(f(0.2) + f(f(0.12) * f(Math.log(f(1 + Math.abs(q.mu)))))) * flare),
      f(0.15),
      f(1.6),
    );
    return { x: q.x, y: q.y, B };
  });
}

/** What the quasar's star kernel reads besides the images. */
export interface QuasarInputs {
  seed: number;
  P: PlateMap;
  penDot: number;
  wobble: number;
  noise: NoiseField;
  pool: Uint32Array;
  dotBase: Float32Array;
  nDotPool: number;
  /** drawn-star drawings (`outline` and `burst` of the stars sheet): the ones lensStar picks from */
  starPool: Uint32Array;
  /** `VAR.spike` of the galaxy */
  spike: number;
  images: readonly QuasarImage[];
}

const KNOT_POOL = 24;

/** How many marks a quasar slot makes (0 or 1), and the draws it used are re-made by `quasarEmit`. */
export function quasarCount(X: QuasarInputs, q: number): number {
  const img = Math.floor(q / QUASAR_SLOTS);
  const k = q - img * QUASAR_SLOTS;
  const im = X.images[img];
  if (!im) return 0;
  const B = im.B;
  const nK = Math.floor(f(f(8 + f(40 * B)) + f(0.5)));
  const nH = Math.floor(f(f(120 + f(1500 * B)) + f(0.5)));
  if (k < nK) return 1;
  if (k < QUASAR_KNOTS) return 0;
  if (k < QUASAR_KNOTS + nH) {
    const h = k - QUASAR_KNOTS;
    return quasarHalo(X, img, h, B).keep ? 1 : 0;
  }
  if (k === QUASAR_KNOTS + QUASAR_HALO) return X.starPool.length ? 1 : 0;
  return 0;
}

function quasarHalo(X: QuasarInputs, img: number, h: number, B: number) {
  const idx = (EMIT_INDEX + 0x80000 + img * QUASAR_SLOTS + QUASAR_KNOTS + h) >>> 0;
  const a2 = f(randF32(X.seed, STREAM_LENS, idx, 0) * f(6.2832));
  const u = randF32(X.seed, STREAM_LENS, idx, 1);
  const d2 = f(f(f(f(3 + f(8 * B)) * X.penDot) * f(Math.pow(f(1 - f(u * f(0.985))), -0.62))));
  return { a2, d2, keep: d2 <= f(f(X.P.U * f(0.75)) * B), idx };
}

/** One quasar slot's mark (call only where `quasarCount` is 1): class and instance. */
export function quasarEmit(
  X: QuasarInputs,
  q: number,
  outF: Float32Array,
  outU: Uint32Array,
  at: number,
): number {
  const img = Math.floor(q / QUASAR_SLOTS);
  const k = q - img * QUASAR_SLOTS;
  const im = X.images[img] as QuasarImage;
  const B = im.B;
  const [X0, Y0] = scr(X.P, im.x, im.y);
  const o = at * 8;
  const idx = (EMIT_INDEX + 0x80000 + q) >>> 0;
  const R = (d: number) => randF32(X.seed, STREAM_LENS, idx, d);
  if (k < QUASAR_KNOTS) {
    // a knot: lensStar's first loop (L673)
    const a = f(R(0) * f(6.2832));
    const d = f(f(f(Math.pow(R(1), 1.5)) * f(2 + f(7 * B))) * X.penDot);
    const tile = X.pool[Math.floor(f(R(2) * KNOT_POOL))] ?? 0;
    const size = f(f(f(3 + f(3 * R(3)))) * X.penDot);
    const rot = f(R(4) * f(6.28));
    const [px, py] = smWarp(f(X0 + f(cosF(a) * d)), f(Y0 + f(sinF(a) * d)), X.wobble, X.noise);
    const c = cosF(rot);
    const s = sinF(rot);
    outF[o] = px;
    outF[o + 1] = py;
    outU[o + 2] = tile;
    outF[o + 3] = 1;
    outF[o + 4] = f(c * size);
    outF[o + 5] = f(s * size);
    outF[o + 6] = -f(s * size);
    outF[o + 7] = f(c * size);
    return LensCls.knot;
  }
  if (k < QUASAR_KNOTS + QUASAR_HALO) {
    // a halo dot (L674)
    const hh = quasarHalo(X, img, k - QUASAR_KNOTS, B);
    const tile = X.pool[KNOT_POOL + Math.floor(f(R(2) * X.nDotPool))] ?? 0;
    const size = f((X.dotBase[tile] ?? 0) * f(0.85));
    const rot = f(R(3) * f(6.28));
    const [px, py] = smWarp(
      f(X0 + f(cosF(hh.a2) * hh.d2)),
      f(Y0 + f(sinF(hh.a2) * hh.d2)),
      X.wobble,
      X.noise,
    );
    const c = cosF(rot);
    const s = sinF(rot);
    outF[o] = px;
    outF[o + 1] = py;
    outU[o + 2] = tile;
    outF[o + 3] = 1;
    outF[o + 4] = f(c * size);
    outF[o + 5] = f(s * size);
    outF[o + 6] = -f(s * size);
    outF[o + 7] = f(c * size);
    return LensCls.disc;
  }
  // the drawn star: a vector mark of M7 (src/model/vectors.ts); its row, with the pen scale
  // 0.7 + 0.5 B in the alpha field (the vector marks ignore alpha, reference notes 20.10)
  const tile = X.starPool[Math.floor(f(R(2) * X.starPool.length))] ?? 0;
  const size = f(f(f(16 + f(38 * B)) * X.penDot));
  const c = cosF(X.spike);
  const s = sinF(X.spike);
  outF[o] = X0;
  outF[o + 1] = Y0;
  outU[o + 2] = tile;
  outF[o + 3] = f(0.7 + f(0.5 * B));
  outF[o + 4] = f(c * size);
  outF[o + 5] = f(s * size);
  outF[o + 6] = -f(s * size);
  outF[o + 7] = f(c * size);
  return LensCls.rstar;
}

// ---------------------------------------------------------------------------------------------
// 7. Marks, branches and warped drawings, as the GPU lays them out

/**
 * A stipple sample's mark (compute/lens-marks.wgsl `gather_marks`): its projected instance with
 * its position taken to the source plane, `(X − 400) · k` (`ts`, buildSourceGalaxy L636). A sample
 * its source's culls removed is class 255.
 */
export function sampleMark(
  M: LensMarks,
  at: number,
  projF: Float32Array,
  projU: Uint32Array,
  i: number,
  cls: number,
  k: number,
  src: number,
): void {
  const o = at * LMARK_WORDS;
  const p = i * 8;
  M.f[o] = f(f((projF[p] ?? 0) - 400) * k);
  M.f[o + 1] = f(f((projF[p + 1] ?? 0) - 400) * k);
  M.u[o + 2] = projU[p + 2] ?? 0;
  M.f[o + 3] = projF[p + 3] ?? 0;
  for (let c = 0; c < 4; c++) M.f[o + 4 + c] = projF[p + 4 + c] ?? 0;
  M.u[o + 8] = cls;
  M.u[o + 9] = src;
  M.u[o + 10] = 0;
  M.u[o + 11] = 0;
}

/** Words per entry of the curves' table: CURVE_LAYOUT (src/model/ribbons.ts). */
export const CURVE_TABLE_WORDS = 12;

/**
 * The surviving branches (at least three points) laid out as the ribbons' curves, in curve and
 * birth order, up to `maxBranches` in all (`gather_branches`): points in plate units, the curve's
 * stroke, width and alpha from its source curve. The slots past the last are empty (n = 0).
 */
export function gatherBranches(
  curveIn: Uint32Array,
  curveInF: Float32Array,
  branches: readonly (readonly Branch[])[],
  P: PlateMap,
  maxPts: number,
  maxBranches: number,
  outU: Uint32Array,
  outF: Float32Array,
  ptsOut: Float32Array,
): number {
  let count = 0;
  for (let c = 0; c < branches.length; c++) {
    const o = c * 12;
    for (const br of branches[c] ?? []) {
      const len = br.pts.length;
      if (len < 3 || count >= maxBranches) continue;
      const n = Math.min(len, maxPts);
      for (let i = 0; i < n; i++) {
        const q = br.pts[i] as [number, number];
        const [x, y] = scr(P, q[0], q[1]);
        ptsOut[(count * maxPts + i) * 2] = x;
        ptsOut[(count * maxPts + i) * 2 + 1] = y;
      }
      const t = count * CURVE_TABLE_WORDS;
      outU[t] = count * maxPts;
      outU[t + 1] = n;
      outU[t + 2] = curveIn[o + 4] ?? 0;
      outU[t + 3] = curveIn[o + 5] ?? 0;
      outF[t + 4] = curveInF[o + 6] ?? 1;
      outF[t + 5] = curveInF[o + 7] ?? 1;
      outF[t + 6] = curveInF[o + 8] ?? 1;
      outU[t + 7] = count * (maxPts - 1);
      outU[t + 8] = curveIn[o + 9] ?? 0;
      outU[t + 9] = curveIn[o + 10] ?? 0;
      outU[t + 10] = curveIn[o + 11] ?? 0;
      outU[t + 11] = 0;
      count++;
    }
  }
  for (let k = count; k < maxBranches; k++) {
    const t = k * CURVE_TABLE_WORDS;
    outU[t] = k * maxPts;
    outU[t + 1] = 0;
    outU[t + 2] = 0;
    outU[t + 3] = 0;
    outF[t + 4] = 1;
    outF[t + 5] = 1;
    outF[t + 6] = 1;
    outU[t + 7] = k * (maxPts - 1);
    outU[t + 8] = 0;
    outU[t + 9] = 0;
    outU[t + 10] = 0;
    outU[t + 11] = 0;
  }
  return count;
}

/**
 * The warped drawings' instances (`vec_inst`): for drawing v and image j, the affine
 * `out = c' + S (q − a)` of lensMarks (L667) in the instance's `w` (a, c' − a) and `w2` (S,
 * column-major); an image past the list, or with |μ| > 40, is switched off (`pad0` = 1).
 */
export function lensVecInst(
  instF: Float32Array,
  instU: Uint32Array,
  lvecs: Uint32Array,
  lvecsF: Float32Array,
  nVec: number,
  Q: QueryOut,
  P: PlateMap,
): void {
  for (let i = 0; i < nVec * MAX_IMAGES; i++) {
    const v = i >>> 3;
    const j = i & 7;
    const m = lvecs[v * 2] ?? 0;
    const k = lvecsF[v * 2 + 1] ?? 1;
    const o = i * 24;
    instU[o + 21] = 1;
    instF.fill(0, o + 12, o + 16);
    if (j >= (Q.imgN[m] ?? 0)) continue;
    const w = (m * MAX_IMAGES + j) * IMG_WORDS;
    if (!(Math.abs(Q.imgF[w + 2] ?? 0) <= VECTOR_MU_LIMIT)) continue;
    const J: [number, number, number, number] = [
      Q.imgF[w + 4] ?? 0,
      Q.imgF[w + 5] ?? 0,
      Q.imgF[w + 6] ?? 0,
      Q.imgF[w + 7] ?? 0,
    ];
    const { c, S } = imageAffine(P, k, Q.imgF[w] ?? 0, Q.imgF[w + 1] ?? 0, J);
    const tx = instF[o + 4] ?? 0;
    const ty = instF[o + 5] ?? 0;
    instF[o + 8] = tx;
    instF[o + 9] = ty;
    instF[o + 10] = f(c[0] - tx);
    instF[o + 11] = f(c[1] - ty);
    instF.set(S, o + 12);
    instU[o + 21] = 0;
  }
}
