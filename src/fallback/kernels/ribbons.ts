/**
 * Curves to ribbons, pieces and hatches: the CPU twin of src/shaders/compute/ribbons.wgsl (ADR
 * 0011, 0014), entry point for entry point, in f32 through `Math.fround`. The view tier of the
 * line-work (src/model/ribbons.ts describes the model tier's buffers):
 *
 * 1. `projectPoint`: every scene point to the plate (`project`, app23.js:L153).
 * 2. `measureCurves` (one invocation, sequential, so deterministic): per curve, the cumulative arc
 *    length L (a prefix sum), the total, the ribbon width `cw = clamp(PEN.line·w·h/thick, 6, 90)`,
 *    `kpx = cw/h`, the repeats `reps = max(1, round(tot / (1.4·512·kpx)))` (1 when stretched), and
 *    for re-spaced curves the first slot of their pieces, a running sum; it writes the pieces'
 *    indirect count (buildCurves, app23.js:L803–810).
 * 3. `expandSegment`: one textured segment (two triangles) of a ribbon: normals from the
 *    neighbouring points, half width `cw·taper/2`, `u = (L/tot)·reps`, the stroke's row as the
 *    layer, every vertex through the wobble (app23.js:L822–838).
 * 4. `placePiece`: one re-spaced piece: its curve by binary search on the slots, its repeat and
 *    piece, its arc position `(rep·512 + x)·tot/(reps·512)`, the segment holding it by binary
 *    search on L (v21's linear search finds the same one), offset across the curve by
 *    `(y − 32)·kpx·taper`, sized `size·kpx·taper`, turned to the tangent (app23.js:L811–821).
 * 5. `hatchCapsule`, `hatchDot`, `hatchBlob`: the dust hatching, one `penlines` drawing per hatch
 *    flattened to 0.28 at pen scale 0.38 (app23.js:L1047–1050), expanded as `expandVector` does
 *    (app23.js:L1190–1219): lines as capsule segments of half width `PEN.line/2·0.38` plate px
 *    (ADR 0006), dots as `dots` sprites and blobs as `knots` sprites.
 *
 * Angles are never formed: a direction is a unit vector, turned by a stored (cos, sin), so both
 * engines need no `atan2` and give the same bits.
 */
import type { RibUniform } from '../../model/ribbons';
import { KNOT_POOL } from '../../model/galaxy';
import {
  CAPSULE_WORDS,
  CURVE_STATE_WORDS,
  CURVE_WORDS,
  CurveFlag,
  HATCH_WORDS,
  RIBBON_SEG_WORDS,
  type RibbonDesc,
} from '../../model/ribbons';
import { HATCH_FLAT, HATCH_PEN } from '../../model/lanes';
import type { ViewDesc } from '../../view/camera';
import { smWarp } from '../../view/warp';
import type { NoiseField } from '../../core/noise';
import { INSTANCE_WORDS } from './project';

const f = Math.fround;
const sqrt = (x: number) => f(Math.sqrt(x));
const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);

/** The view's numbers of the `Rib` uniform (src/model/ribbons.ts `ribUniform`). */
export type { RibUniform };

/** Typed views of the model tier's buffers. */
export interface RibbonModel {
  R: RibbonDesc;
  cu: Uint32Array;
  cf: Float32Array;
  hu: Uint32Array;
  hf: Float32Array;
  /** the galaxy's pools (24 knot tiles, then the dot pool) and dot sizes */
  pool: Uint32Array;
  dotBase: Float32Array;
}

export function ribbonModel(R: RibbonDesc, pool: Uint32Array, dotBase: Float32Array): RibbonModel {
  return {
    R,
    cu: new Uint32Array(R.curveBuf),
    cf: new Float32Array(R.curveBuf),
    hu: new Uint32Array(R.hatchBuf),
    hf: new Float32Array(R.hatchBuf),
    pool,
    dotBase,
  };
}

/** 1. A scene point to the plate (project, app23.js:L153; the same arithmetic as project.wgsl). */
export function projectPoint(i: number, V: ViewDesc, p3: Float32Array, out: Float32Array): void {
  const x = p3[i * 4] ?? 0;
  const y = p3[i * 4 + 1] ?? 0;
  const z = p3[i * 4 + 2] ?? 0;
  const cz = V.cos_az ?? 1;
  const sz = V.sin_az ?? 0;
  const x0 = f(x * (V.winding ?? 1));
  const X = f(f(x0 * cz) - f(y * sz));
  const ya = f(f(x0 * sz) + f(y * cz));
  const Y = f(f(ya * (V.cos_i ?? 1)) - f(z * (V.sin_i ?? 0)));
  const ca = V.cos_pa ?? 1;
  const sa = V.sin_pa ?? 0;
  const sc = V.scale ?? 84;
  out[i * 2] = f((V.cx ?? 400) + f(f(f(X * ca) - f(Y * sa)) * sc));
  out[i * 2 + 1] = f((V.cy ?? 400) + f(f(f(X * sa) + f(Y * ca)) * sc));
}

/** 2. Arc lengths and per-curve state; returns the number of pieces (the indirect count). */
export function measureCurves(
  M: RibbonModel,
  rib: RibUniform,
  q: Float32Array,
  arc: Float32Array,
  stF: Float32Array,
  stU: Uint32Array,
): number {
  const { cu, cf } = M;
  const W = rib.sheet_w;
  const H = rib.sheet_h;
  let total = 0;
  for (let c = 0; c < rib.n_curves; c++) {
    const o = c * CURVE_WORDS;
    const first = cu[o] ?? 0;
    const n = cu[o + 1] ?? 0;
    const flags = cu[o + 3] ?? 0;
    arc[first] = 0;
    for (let j = 1; j < n; j++) {
      const a = (first + j - 1) * 2;
      const b = (first + j) * 2;
      const dx = f((q[b] ?? 0) - (q[a] ?? 0));
      const dy = f((q[b + 1] ?? 0) - (q[a + 1] ?? 0));
      arc[first + j] = f((arc[first + j - 1] ?? 0) + sqrt(f(f(dx * dx) + f(dy * dy))));
    }
    let tot = n > 0 ? (arc[first + n - 1] ?? 0) : 0;
    if (tot === 0) tot = 1;
    const cw = clamp(f(f(f(rib.pen_line * (cf[o + 4] ?? 1)) * H) / (cf[o + 6] ?? 10)), 6, 90);
    const kpx = f(cw / H);
    const pat = f(W * kpx);
    let reps =
      flags & CurveFlag.stretch ? 1 : Math.max(1, Math.floor(f(f(tot / f(pat * f(1.4))) + 0.5)));
    const so = c * CURVE_STATE_WORDS;
    stU[so + 4] = total;
    if (flags & CurveFlag.pieces) {
      reps = n < 2 ? 0 : Math.min(reps, cu[o + 10] ?? 0);
      total += reps * (cu[o + 9] ?? 0);
    }
    stF[so] = tot;
    stF[so + 1] = cw;
    stF[so + 2] = kpx;
    stU[so + 3] = reps;
    stF[so + 5] = flags & CurveFlag.edgeAlpha ? rib.edge_alpha : (cf[o + 5] ?? 1);
    stU[so + 6] = 0;
    stU[so + 7] = 0;
  }
  return total;
}

/** The last entry k in [0, n) whose key(k) ≤ i (entries with no items share the next one's key). */
function lastAtOrBefore(n: number, i: number, key: (k: number) => number): number {
  let lo = 0;
  let hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (key(mid) <= i) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** 3. Textured segment `i` into `out` (RIBBON_SEG_WORDS per segment). */
export function expandSegment(
  i: number,
  M: RibbonModel,
  rib: RibUniform,
  q: Float32Array,
  arc: Float32Array,
  stF: Float32Array,
  stU: Uint32Array,
  outF: Float32Array,
  outU: Uint32Array,
): void {
  const { cu } = M;
  const c = lastAtOrBefore(rib.n_curves, i, (k) => cu[k * CURVE_WORDS + 7] ?? 0);
  const o = c * CURVE_WORDS;
  const first = cu[o] ?? 0;
  const n = cu[o + 1] ?? 0;
  const taper = ((cu[o + 3] ?? 0) & CurveFlag.taper) !== 0;
  const so = c * CURVE_STATE_WORDS;
  const tot = stF[so] ?? 1;
  const cw = stF[so + 1] ?? 6;
  const reps = stU[so + 3] ?? 1;
  const j = i - (cu[o + 7] ?? 0);
  const wob = rib.wobble;
  const ends: number[] = [];
  const us: number[] = [];
  for (const e of [j, j + 1]) {
    const a = (first + Math.max(0, e - 1)) * 2;
    const b = (first + Math.min(n - 1, e + 1)) * 2;
    const tx = f((q[b] ?? 0) - (q[a] ?? 0));
    const ty = f((q[b + 1] ?? 0) - (q[a + 1] ?? 0));
    let tl = sqrt(f(f(tx * tx) + f(ty * ty)));
    if (tl === 0) tl = 1;
    const nx = f(-ty / tl);
    const ny = f(tx / tl);
    const fr = f((arc[first + e] ?? 0) / tot);
    const tap = taper ? f(f(1.1) - f(f(0.45) * fr)) : 1;
    const w = f(f(cw * tap) / 2);
    const px = q[(first + e) * 2] ?? 0;
    const py = q[(first + e) * 2 + 1] ?? 0;
    const p0 = smWarp(f(px + f(nx * w)), f(py + f(ny * w)), wob, M.R.noise);
    const p1 = smWarp(f(px - f(nx * w)), f(py - f(ny * w)), wob, M.R.noise);
    ends.push(...p0, ...p1);
    us.push(f(fr * reps));
  }
  const oo = i * RIBBON_SEG_WORDS;
  for (let k = 0; k < 8; k++) outF[oo + k] = ends[k] ?? 0;
  outF[oo + 8] = us[0] ?? 0;
  outF[oo + 9] = us[1] ?? 0;
  outU[oo + 10] = cu[o + 2] ?? 0;
  outF[oo + 11] = stF[so + 5] ?? 1;
}

/** 4. Piece slot `i` as a sprite instance (INSTANCE_WORDS); false past the indirect count. */
export function placePiece(
  i: number,
  total: number,
  M: RibbonModel,
  rib: RibUniform,
  q: Float32Array,
  arc: Float32Array,
  stF: Float32Array,
  stU: Uint32Array,
  outF: Float32Array,
  outU: Uint32Array,
): boolean {
  if (i >= total) return false;
  const { cu, R } = M;
  const nc = rib.n_curves;
  const c = lastAtOrBefore(nc, i, (k) => stU[k * CURVE_STATE_WORDS + 4] ?? 0);
  const o = c * CURVE_WORDS;
  const so = c * CURVE_STATE_WORDS;
  const first = cu[o] ?? 0;
  const n = cu[o + 1] ?? 0;
  const np = cu[o + 9] ?? 1;
  const taper = ((cu[o + 3] ?? 0) & CurveFlag.taper) !== 0;
  const W = rib.sheet_w;
  const H = rib.sheet_h;
  const tot = stF[so] ?? 1;
  const kpx = stF[so + 2] ?? 0;
  const reps = stU[so + 3] ?? 1;
  const local = i - (stU[so + 4] ?? 0);
  const rep = Math.floor(local / np);
  const pj = local - rep * np;
  const pb = ((cu[o + 8] ?? 0) + pj) * 4;
  const pcx = R.pieces[pb] ?? 0;
  const pcy = R.pieces[pb + 1] ?? 0;
  const pcs = R.pieces[pb + 2] ?? 0;
  const pct = R.pieces[pb + 3] ?? 0;
  const along = f(tot / f(reps * W));
  const sPos = f(f(f(rep * W) + pcx) * along);
  // the first segment end at or past sPos (v21's linear search, as a binary search)
  let lo = 1;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((arc[first + mid] ?? 0) < sPos) lo = mid + 1;
    else hi = mid;
  }
  const j = lo;
  const l0 = arc[first + j - 1] ?? 0;
  let dl = f((arc[first + j] ?? 0) - l0);
  if (dl === 0) dl = 1;
  const fr = f(f(sPos - l0) / dl);
  const a = (first + j - 1) * 2;
  const b = (first + j) * 2;
  const ax = q[a] ?? 0;
  const ay = q[a + 1] ?? 0;
  const tx = f((q[b] ?? 0) - ax);
  const ty = f((q[b + 1] ?? 0) - ay);
  const x = f(ax + f(tx * fr));
  const y = f(ay + f(ty * fr));
  const tl0 = sqrt(f(f(tx * tx) + f(ty * ty)));
  const tl = tl0 === 0 ? 1 : tl0;
  const nx = f(-ty / tl);
  const ny = f(tx / tl);
  const tap = taper ? f(f(1.1) - f(f(f(0.45) * sPos) / tot)) : 1;
  const off = f(f(f(pcy - f(H / 2)) * kpx) * tap);
  const [px, py] = smWarp(f(x + f(nx * off)), f(y + f(ny * off)), rib.wobble, M.R.noise);
  const size = f(f(pcs * kpx) * tap);
  const cs = tl0 === 0 ? 1 : f(tx / tl);
  const sn = tl0 === 0 ? 0 : f(ty / tl);
  const oo = i * INSTANCE_WORDS;
  outF[oo] = px;
  outF[oo + 1] = py;
  outU[oo + 2] = pct;
  outF[oo + 3] = stF[so + 5] ?? 1;
  outF[oo + 4] = f(cs * size);
  outF[oo + 5] = f(sn * size);
  outF[oo + 6] = f(-f(sn * size));
  outF[oo + 7] = f(cs * size);
  return true;
}

/** A hatch laid out for the view: its centre, matrix (tile → plate) and scale. */
export interface HatchFrame {
  cx: number;
  cy: number;
  m: [number, number, number, number];
  sc: number;
  tile: number;
}

/** The hatch `h` for this view (app23.js:L964–971, L1048). */
export function hatchFrame(
  h: number,
  M: RibbonModel,
  rib: RibUniform,
  q: Float32Array,
): HatchFrame {
  const { hu, hf } = M;
  const o = h * HATCH_WORDS;
  const a = (hu[o] ?? 0) * 2;
  const b = (hu[o + 1] ?? 0) * 2;
  const qax = q[a] ?? 0;
  const qay = q[a + 1] ?? 0;
  const dx = f((q[b] ?? 0) - qax);
  const dy = f((q[b + 1] ?? 0) - qay);
  const dl = sqrt(f(f(dx * dx) + f(dy * dy)));
  const d0x = dl === 0 ? 1 : f(dx / dl);
  const d0y = dl === 0 ? 0 : f(dy / dl);
  const cd = hf[o + 10] ?? 1;
  const sd = hf[o + 11] ?? 0;
  const ux = f(f(d0x * cd) - f(d0y * sd));
  const uy = f(f(d0x * sd) + f(d0y * cd));
  const z = rib.zoom;
  const on = f((hf[o + 6] ?? 0) * z);
  const oy = f((hf[o + 7] ?? 0) * z);
  const of = f((hf[o + 8] ?? 0) * z);
  const cx = f(f(qax + f(f(-d0y) * on)) + f(ux * of));
  const cy = f(f(f(qay + f(d0x * on)) + oy) + f(uy * of));
  const L = f((hf[o + 9] ?? 0) * z);
  const Lf = f(L * f(HATCH_FLAT));
  const m: [number, number, number, number] = [f(ux * L), f(uy * L), f(-f(uy * Lf)), f(ux * Lf)];
  const det = f(f(m[0] * m[3]) - f(m[1] * m[2]));
  return { cx, cy, m, sc: sqrt(Math.abs(det)), tile: hu[o + 2] ?? 0 };
}

/** A tile point through a hatch's frame and the wobble. */
function tf(
  H: HatchFrame,
  x: number,
  y: number,
  wob: number,
  field?: NoiseField | null,
): [number, number] {
  const m = H.m;
  return smWarp(
    f(f(H.cx + f(m[0] * x)) + f(m[2] * y)),
    f(f(H.cy + f(m[1] * x)) + f(m[3] * y)),
    wob,
    field,
  );
}

/** 5a. Hatch capsule `i` (CAPSULE_WORDS). */
export function hatchCapsule(
  i: number,
  M: RibbonModel,
  rib: RibUniform,
  q: Float32Array,
  outF: Float32Array,
): void {
  const { hu, R } = M;
  const h = lastAtOrBefore(rib.n_hatch, i, (k) => hu[k * HATCH_WORDS + 3] ?? 0);
  const H = hatchFrame(h, M, rib, q);
  const s = (R.pen.table[H.tile * 8] ?? 0) + i - (hu[h * HATCH_WORDS + 3] ?? 0);
  const wob = rib.wobble;
  const g = R.pen.segs;
  const a = tf(H, g[s * 4] ?? 0, g[s * 4 + 1] ?? 0, wob, M.R.noise);
  const b = tf(H, g[s * 4 + 2] ?? 0, g[s * 4 + 3] ?? 0, wob, M.R.noise);
  const oo = i * CAPSULE_WORDS;
  outF[oo] = a[0];
  outF[oo + 1] = a[1];
  outF[oo + 2] = b[0];
  outF[oo + 3] = b[1];
  outF[oo + 4] = f(f(rib.pen_line / 2) * f(HATCH_PEN));
  outF[oo + 5] = 1;
  outF[oo + 6] = 0;
  outF[oo + 7] = 0;
}

/** 5b. Hatch dot `i`: a `dots` sprite (expandVector, app23.js:L1215). */
export function hatchDot(
  i: number,
  M: RibbonModel,
  rib: RibUniform,
  q: Float32Array,
  outF: Float32Array,
  outU: Uint32Array,
): void {
  const { hu, R } = M;
  const h = lastAtOrBefore(rib.n_hatch, i, (k) => hu[k * HATCH_WORDS + 4] ?? 0);
  const H = hatchFrame(h, M, rib, q);
  const d = ((R.pen.table[H.tile * 8 + 2] ?? 0) + i - (hu[h * HATCH_WORDS + 4] ?? 0)) * 4;
  const D = R.pen.dots;
  const [px, py] = tf(H, D[d] ?? 0, D[d + 1] ?? 0, rib.wobble, M.R.noise);
  const nPool = Math.max(1, rib.n_dot_pool);
  const t = M.pool[KNOT_POOL + ((D[d + 3] ?? 0) % nPool)] ?? 0;
  const k0 = clamp(f(f(f(f(f(2) * (D[d + 2] ?? 0)) * H.sc) * f(0.42)) / f(2.6)), f(0.8), f(1.6));
  const k = f(k0 * f(Math.max(0.55, HATCH_PEN)));
  const size = f((M.dotBase[t] ?? 0) * k);
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

/** 5c. Hatch blob `i`: a `knots` sprite (expandVector, app23.js:L1217). */
export function hatchBlob(
  i: number,
  M: RibbonModel,
  rib: RibUniform,
  q: Float32Array,
  outF: Float32Array,
  outU: Uint32Array,
): void {
  const { hu, R } = M;
  const h = lastAtOrBefore(rib.n_hatch, i, (k) => hu[k * HATCH_WORDS + 5] ?? 0);
  const H = hatchFrame(h, M, rib, q);
  const b = ((R.pen.table[H.tile * 8 + 4] ?? 0) + i - (hu[h * HATCH_WORDS + 5] ?? 0)) * 8;
  const B = R.pen.blobs;
  const [px, py] = tf(H, B[b] ?? 0, B[b + 1] ?? 0, rib.wobble, M.R.noise);
  const t = M.pool[(B[b + 6] ?? 0) % KNOT_POOL] ?? 0;
  const lim = f(f(3) / H.sc);
  const sx = Math.max(f(f(f(2) * (B[b + 2] ?? 0)) * f(0.85)), lim);
  const sy = Math.max(f(f(f(2) * (B[b + 3] ?? 0)) * f(0.85)), lim);
  const c = B[b + 4] ?? 1;
  const s = B[b + 5] ?? 0;
  const m = H.m;
  // chain(M, Rm(θ), Sm(sx, sy))
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

/** Everything the view tier of the line-work writes. */
export interface RibbonView {
  points: Float32Array;
  arc: Float32Array;
  stateF: Float32Array;
  stateU: Uint32Array;
  segs: Float32Array;
  segsU: Uint32Array;
  nPieces: number;
  pieces: Float32Array;
  piecesU: Uint32Array;
  caps: Float32Array;
  hdots: Float32Array;
  hdotsU: Uint32Array;
  hblobs: Float32Array;
  hblobsU: Uint32Array;
}

/** Runs every entry point, as GpuRibbons dispatches them. */
export function runRibbons(M: RibbonModel, V: ViewDesc, rib: RibUniform): RibbonView {
  const R = M.R;
  const np = R.nPoints;
  const points = new Float32Array(Math.max(1, np) * 2);
  for (let i = 0; i < np; i++) projectPoint(i, V, R.points3, points);
  const arc = new Float32Array(Math.max(1, np));
  const st = new ArrayBuffer(Math.max(1, R.nCurves) * CURVE_STATE_WORDS * 4);
  const stateF = new Float32Array(st);
  const stateU = new Uint32Array(st);
  const nPieces = measureCurves(M, rib, points, arc, stateF, stateU);
  const words = (n: number, w: number) => new ArrayBuffer(Math.max(1, n) * w * 4);
  const sb = words(R.nSegs, RIBBON_SEG_WORDS);
  const segs = new Float32Array(sb);
  const segsU = new Uint32Array(sb);
  for (let i = 0; i < R.nSegs; i++)
    expandSegment(i, M, rib, points, arc, stateF, stateU, segs, segsU);
  const pb = words(nPieces, INSTANCE_WORDS);
  const pieces = new Float32Array(pb);
  const piecesU = new Uint32Array(pb);
  for (let i = 0; i < nPieces; i++)
    placePiece(i, nPieces, M, rib, points, arc, stateF, stateU, pieces, piecesU);
  const caps = new Float32Array(words(R.nCaps, CAPSULE_WORDS));
  for (let i = 0; i < R.nCaps; i++) hatchCapsule(i, M, rib, points, caps);
  const db = words(R.nHDots, INSTANCE_WORDS);
  const hdots = new Float32Array(db);
  const hdotsU = new Uint32Array(db);
  for (let i = 0; i < R.nHDots; i++) hatchDot(i, M, rib, points, hdots, hdotsU);
  const bb = words(R.nHBlobs, INSTANCE_WORDS);
  const hblobs = new Float32Array(bb);
  const hblobsU = new Uint32Array(bb);
  for (let i = 0; i < R.nHBlobs; i++) hatchBlob(i, M, rib, points, hblobs, hblobsU);
  return {
    points,
    arc,
    stateF,
    stateU,
    segs,
    segsU,
    nPieces,
    pieces,
    piecesU,
    caps,
    hdots,
    hdotsU,
    hblobs,
    hblobsU,
  };
}
