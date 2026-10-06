/**
 * The deep field and the foreground stars (`skyParts`, app23.js:L878–912), the CPU twin of
 * src/shaders/compute/sky.wgsl (ADR 0011, 0014), function for function, in f32 through `Math.fround`.
 *
 * Per view, from the catalogue (src/model/sky.ts):
 * 1. `cullGalaxy`: a background galaxy through the perspective camera (CAM 30): dropped when it is
 *    nearer than 2 units to the camera or within the camera's 0.8 magnification, off the plate by
 *    more than 120 · zoom/84 px, or bigger than 140 px; otherwise its plate position `q`, its
 *    magnification `k`, its apparent radius `appR` and its dot count `np` = clamp(2.2 · appR, 10,
 *    150) (L884–885, L890).
 * 2. `skyDot`: dot `j` of a visible galaxy: a point of a small 3D galaxy (a bulge fraction of
 *    `bulge`, else a disc with a half of its points on two logarithmic arms and a thin z), placed
 *    in the galaxy's own plane and projected with the perspective camera, a dots sprite of size
 *    `dotSprite(t, 0.62 · clamp(zoom, 0.6, 1.3))` (L891–899). Its numbers are on the `skyDots`
 *    stream, index `catalogue index · 256 + j`.
 * 3. `galaxyRows`: its drawing laid on the same plane at pen scale 0.42: `orient` (foreshortened by
 *    the plane's tilt, at least 0.12), sheared round the mass when `massive` (L902), an `arms`
 *    drawing copied `na` times (L903–904). The rows go to the dynamic vector set of
 *    src/model/dynvec.ts.
 * 4. `fgStar`: a foreground star's sprite, `size · min(2.2, k / 0.42)` (L908–912).
 *
 * v21 sorts the galaxies far to near and draws their dots first, then their drawings; every mark has
 * alpha 1 and the one ink, so the order does not show and is not kept.
 */
import { cosF, randGaussF, sinF } from '../../core/f32math';
import { randF32 } from '../../core/rng';
import { Stream } from '../../core/streams';
import type { NoiseField } from '../../core/noise';
import { CAM, PLATE } from '../../view/camera';
import { smWarp } from '../../view/warp';
import { writeRow } from '../../model/dynvec';
import {
  ARMS_FLAG,
  BG_WORDS,
  FG_WORDS,
  SKY_NP_MAX,
  SKY_NP_MIN,
  type SkyDesc,
} from '../../model/sky';
import type { ViewDesc } from '../../view/camera';
import { INSTANCE_WORDS } from './project';

const f = Math.fround;
const TAU = f(2 * Math.PI);
const sqrt = (x: number) => f(Math.sqrt(x));
const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);

/** The numbers a galaxy's stream index reserves for its dots (np ≤ 150 < 256). */
export const SKY_DOT_STRIDE = 256;

/** The numbers of one view. */
export interface SkyView {
  V: ViewDesc;
  key: number;
  /** the hand wobble's amplitude */
  wobble: number;
  nDotPool: number;
  massive: boolean;
}

export interface SkyInputs {
  S: SkyDesc;
  view: SkyView;
  items: Uint32Array;
  bgF: Float32Array;
  bgU: Uint32Array;
  fgF: Float32Array;
  fgU: Uint32Array;
  pool: Uint32Array;
  dotBase: Float32Array;
  noise: NoiseField;
}

const KNOT_POOL = 24;

/** A galaxy that survived the cull. */
export interface Visible {
  /** the catalogue index */
  b: number;
  qx: number;
  qy: number;
  k: number;
  appR: number;
  np: number;
}

/** toView (app23.js:L859): the orbit and tilt without the mirror, f32. */
export function toViewF(V: ViewDesc, x: number, y: number, z: number): [number, number, number] {
  const cz = V.cos_az ?? 1;
  const sz = V.sin_az ?? 0;
  const ci = V.cos_i ?? 1;
  const si = V.sin_i ?? 0;
  const xr = f(f(x * cz) - f(y * sz));
  const yr = f(f(x * sz) + f(y * cz));
  return [xr, f(f(yr * ci) - f(z * si)), f(f(yr * si) + f(z * ci))];
}

/** toScreen (app23.js:L860): roll by pa, scale by VIEW.scale · k, centre on the plate. */
export function toScreenF(V: ViewDesc, v0: number, v1: number, k: number): [number, number] {
  const fk = f((V.scale ?? 84) * k);
  const cp = V.cos_pa ?? 1;
  const sp = V.sin_pa ?? 0;
  return [
    f(PLATE / 2 + f(f(f(v0 * cp) - f(v1 * sp)) * fk)),
    f(PLATE / 2 + f(f(f(v0 * sp) + f(v1 * cp)) * fk)),
  ];
}

/** Background galaxy `b` of the catalogue. */
function bg(X: SkyInputs, b: number) {
  const o = b * BG_WORDS;
  const F = X.bgF;
  return {
    w: [F[o] ?? 0, F[o + 1] ?? 0, F[o + 2] ?? 0] as [number, number, number],
    rad: F[o + 3] ?? 0,
    n: [F[o + 4] ?? 0, F[o + 5] ?? 0, F[o + 6] ?? 0] as [number, number, number],
    spin: F[o + 7] ?? 0,
    item: X.bgU[o + 8] ?? 0,
    na: F[o + 9] ?? 2,
    bulge: F[o + 10] ?? 0,
  };
}

/**
 * 1. The cull of background galaxy `b`: null when it is not drawn. `slack` relaxes every limit by
 * that fraction, for `skyBound`.
 */
export function cullGalaxy(X: SkyInputs, b: number, slack = 0): Visible | null {
  const V = X.view.V;
  const g = bg(X, b);
  const v = toViewF(V, g.w[0], g.w[1], g.w[2]);
  const depth = f(CAM - v[2]);
  if (depth < f(2 * (1 - slack))) return null;
  const k = f(CAM / depth);
  if (k > f(f(0.8) * (1 + slack))) return null;
  const sc = V.scale ?? 84;
  const zf = f(sc / 84);
  const q = toScreenF(V, v[0], v[1], k);
  const m = f(f(f(120) * zf) * (1 + slack) + (slack ? 2 : 0));
  if (!(q[0] > -m && q[0] < f(PLATE + m) && q[1] > -m && q[1] < f(PLATE + m))) return null;
  const appR = f(f(g.rad * k) * sc);
  if (f(f(g.rad * k) * sc) > f(140 * (1 + slack))) return null;
  const np = clamp(Math.floor(f(appR * f(2.2)) + 0.5), SKY_NP_MIN, SKY_NP_MAX);
  return { b, qx: q[0], qy: q[1], k, appR, np };
}

/** The basis of the plane with normal n (app23.js:L861), f32. */
function basis(n: readonly number[]): [[number, number, number], [number, number, number]] {
  const n0 = n[0] ?? 0;
  const n1 = n[1] ?? 0;
  const n2 = n[2] ?? 0;
  const tall = Math.abs(n2) < f(0.9);
  const a0 = tall ? 0 : 1;
  const a2 = tall ? 1 : 0;
  const c0 = f(f(n1 * a2) - f(n2 * 0));
  const c1 = f(f(n2 * a0) - f(n0 * a2));
  const c2 = f(f(n0 * 0) - f(n1 * a0));
  const l = sqrt(f(f(f(c0 * c0) + f(c1 * c1)) + f(c2 * c2)));
  const e0 = f(c0 / l);
  const e1 = f(c1 / l);
  const e2 = f(c2 / l);
  return [
    [e0, e1, e2],
    [f(f(n1 * e2) - f(n2 * e1)), f(f(n2 * e0) - f(n0 * e2)), f(f(n0 * e1) - f(n1 * e0))],
  ];
}

/** 2. Dot `j` of visible galaxy `v` as a `dots` sprite into `outF/outU` at instance `at`. */
export function skyDot(
  X: SkyInputs,
  v: Visible,
  j: number,
  outF: Float32Array,
  outU: Uint32Array,
  at: number,
): void {
  const V = X.view.V;
  const g = bg(X, v.b);
  const idx = (v.b * SKY_DOT_STRIDE + j) >>> 0;
  const key = X.view.key >>> 0;
  const r = (d: number) => randF32(key, Stream.skyDots, idx, d);
  const gs = (d: number) => randGaussF(key, Stream.skyDots, idx, d);
  let lx: number;
  let ly: number;
  let lz: number;
  if (r(0) < g.bulge) {
    // the bulge: a Hernquist-like radius, a point of the sphere, flattened to 0.8 in z
    const sq = sqrt(Math.min(r(1), f(0.97)));
    const br = f(f(f(0.18) * sq) / f(1 - sq));
    const z = f(f(2 * r(2)) - 1);
    const t = f(r(3) * f(6.28318));
    const q = sqrt(f(1 - f(z * z)));
    lx = f(f(q * cosF(t)) * br);
    ly = f(f(q * sinF(t)) * br);
    lz = f(f(z * br) * f(0.8));
  } else {
    // the disc: an exponential radius; a half of the points on two logarithmic arms
    let R2 = f(f(-0.35) * f(Math.log(f(f(r(1) * r(2)) + f(1e-9)))));
    let th = f(r(3) * f(6.28));
    if (r(4) < f(0.55))
      th = f(
        f(f(f(Math.log(f(f(R2 / f(0.08)) + 1))) / f(0.45)) + f(Math.PI * Math.floor(f(r(5) * 2)))) +
          f(gs(6) * f(0.35)),
      );
    R2 = Math.min(R2, f(1.6));
    lx = f(R2 * cosF(th));
    ly = f(R2 * sinF(th));
    lz = f(gs(8) * f(0.05));
  }
  const B = basis(g.n);
  const wx = f(g.w[0] + f(g.rad * f(f(f(lx * B[0][0]) + f(ly * B[1][0])) + f(lz * g.n[0]))));
  const wy = f(g.w[1] + f(g.rad * f(f(f(lx * B[0][1]) + f(ly * B[1][1])) + f(lz * g.n[1]))));
  const wz = f(g.w[2] + f(g.rad * f(f(f(lx * B[0][2]) + f(ly * B[1][2])) + f(lz * g.n[2]))));
  const pv = toViewF(V, wx, wy, wz);
  const pk = f(CAM / f(CAM - pv[2]));
  const pq = toScreenF(V, pv[0], pv[1], pk);
  const zf = f((V.scale ?? 84) / 84);
  const nDot = X.view.nDotPool;
  const t = X.pool[KNOT_POOL + Math.floor(f(r(10) * nDot))] ?? 0;
  const k = f(f(0.62) * Math.max(f(0.6), Math.min(f(1.3), zf)));
  const size = f((X.dotBase[t] ?? 0) * k);
  const rot = f(r(11) * f(6.28));
  const [px, py] = smWarp(pq[0], pq[1], X.view.wobble, X.noise);
  const c = cosF(rot);
  const s = sinF(rot);
  const o = at * INSTANCE_WORDS;
  outF[o] = px;
  outF[o + 1] = py;
  outU[o + 2] = t;
  outF[o + 3] = 1;
  outF[o + 4] = f(c * size);
  outF[o + 5] = f(s * size);
  outF[o + 6] = f(-f(s * size));
  outF[o + 7] = f(c * size);
}

type M2 = [number, number, number, number];
const mul2 = (A: M2, B: M2): M2 => [
  f(f(A[0] * B[0]) + f(A[2] * B[1])),
  f(f(A[1] * B[0]) + f(A[3] * B[1])),
  f(f(A[0] * B[2]) + f(A[2] * B[3])),
  f(f(A[1] * B[2]) + f(A[3] * B[3])),
];
const Rm = (c: number, s: number): M2 => [c, s, f(-s), c];

/**
 * `orient` (app23.js:L863): the plane with normal `n` laid on the plate at `size`, foreshortened by
 * |n_z| (at least `flat`), mirrored when it faces away; with the angle of its tilt taken as a cosine
 * and a sine (no `atan2`).
 */
export function orientF(
  V: ViewDesc,
  n: readonly number[],
  size: number,
  spin: number,
  flat = 0.12,
): M2 {
  const nv = toViewF(V, n[0] ?? 0, n[1] ?? 0, n[2] ?? 0);
  const cosI = Math.abs(nv[2]);
  const rho = sqrt(f(f(nv[0] * nv[0]) + f(nv[1] * nv[1])));
  const c0 = rho > 0 ? f(nv[0] / rho) : 1;
  const s0 = rho > 0 ? f(nv[1] / rho) : 0;
  const cp = V.cos_pa ?? 1;
  const sp = V.sin_pa ?? 0;
  // phi = atan2(n_y, n_x) + π/2 + pa
  const cphi = f(-f(f(s0 * cp) + f(c0 * sp)));
  const sphi = f(f(c0 * cp) - f(s0 * sp));
  const fl = f(size * Math.max(f(flat || 0.12), cosI));
  let M = mul2(Rm(cphi, sphi), [size, 0, 0, fl]);
  M = mul2(M, [nv[2] < 0 ? -1 : 1, 0, 0, 1]);
  return mul2(M, Rm(cosF(spin), sinF(spin)));
}

/** 3. The rows of visible galaxy `v`: one, or `na` copies of an `arms` drawing. */
export function galaxyRows(
  X: SkyInputs,
  v: Visible,
): { m: M2; x: number; y: number; ps: number; drawing: number }[] {
  const V = X.view.V;
  const g = bg(X, v.b);
  const item = X.items[g.item] ?? 0;
  const arms = (item & ARMS_FLAG) !== 0;
  const drawing = item & ~ARMS_FLAG;
  let M0 = orientF(V, g.n, f(v.appR * f(2.1)), g.spin);
  if (X.view.massive) {
    const sc = V.scale ?? 84;
    const dx = f(v.qx - PLATE / 2);
    const dy = f(v.qy - PLATE / 2);
    const h = sqrt(f(f(dx * dx) + f(dy * dy)));
    const rf = h || 1;
    const gam = Math.min(f(0.45), f(f(f(0.35) * f(f(1.3) * sc)) / rf));
    // ph = atan2(dy, dx) + π/2
    const cph = h ? f(-f(dy / rf)) : 0;
    const sph = h ? f(dx / rf) : 1;
    let S = mul2(Rm(cph, sph), [f(1 + gam), 0, 0, f(1 - gam)]);
    S = mul2(S, Rm(cph, f(-sph)));
    M0 = mul2(S, M0);
  }
  const rows: { m: M2; x: number; y: number; ps: number; drawing: number }[] = [];
  if (arms) {
    const na = g.na;
    for (let a = 0; a < na; a++) {
      const ang = f(f(f(TAU * a) / na));
      rows.push({
        m: mul2(M0, Rm(cosF(ang), sinF(ang))),
        x: v.qx,
        y: v.qy,
        ps: f(0.42),
        drawing,
      });
    }
  } else rows.push({ m: M0, x: v.qx, y: v.qy, ps: f(0.42), drawing });
  return rows;
}

/** 4. Foreground star `i`: its sprite into `outF/outU` at `at`, or false when it is not drawn. */
export function fgStar(
  X: SkyInputs,
  i: number,
  outF: Float32Array,
  outU: Uint32Array,
  at: number,
): boolean {
  const V = X.view.V;
  const o = i * FG_WORDS;
  const F = X.fgF;
  const v = toViewF(V, F[o] ?? 0, F[o + 1] ?? 0, F[o + 2] ?? 0);
  const depth = f(CAM - v[2]);
  if (depth < 3) return false;
  const k = f(CAM / depth);
  const q = toScreenF(V, v[0], v[1], k);
  if (!(q[0] > -40 && q[0] < PLATE + 40 && q[1] > -40 && q[1] < PLATE + 40)) return false;
  const size = f((F[o + 3] ?? 0) * Math.min(f(2.2), f(k / f(0.42))));
  const rot = F[o + 4] ?? 0;
  const [px, py] = smWarp(q[0], q[1], X.view.wobble, X.noise);
  const c = cosF(rot);
  const s = sinF(rot);
  const at8 = at * INSTANCE_WORDS;
  outF[at8] = px;
  outF[at8 + 1] = py;
  outU[at8 + 2] = X.fgU[o + 5] ?? 0;
  outF[at8 + 3] = 1;
  outF[at8 + 4] = f(c * size);
  outF[at8 + 5] = f(s * size);
  outF[at8 + 6] = f(-f(s * size));
  outF[at8 + 7] = f(c * size);
  return true;
}

/** What the sky makes in one view: the CPU engine's lists, in catalogue order. */
export interface SkyOut {
  visible: Visible[];
  /** the dots, one instance each */
  dots: Float32Array;
  dotsU: Uint32Array;
  nDots: number;
  /** the galaxies' drawings as rows of a dynamic set, and how many */
  rows: ArrayBuffer;
  nRows: number;
  fg: Float32Array;
  fgU: Uint32Array;
  nFg: number;
}

export function skyInputs(
  S: SkyDesc,
  view: SkyView,
  pool: Uint32Array,
  dotBase: Float32Array,
  noise: NoiseField,
): SkyInputs {
  return {
    S,
    view,
    items: S.items,
    bgF: S.bgBuf,
    bgU: new Uint32Array(S.bgBuf.buffer),
    fgF: S.fgBuf,
    fgU: new Uint32Array(S.fgBuf.buffer),
    pool,
    dotBase,
    noise,
  };
}

/**
 * How many galaxies a view can show, with a margin: the number of those a slightly relaxed cull
 * keeps, at most the capacity. The view tier sizes its dispatches with it (the buffers are sized
 * for the capacity), so a view at zoom 1 expands the few dozen galaxies it shows and not the few
 * hundred of the widest. The CPU reads the catalogue's entries (a few thousand) and no marks.
 */
export function skyBound(X: SkyInputs): number {
  let n = 0;
  for (let b = 0; b < X.S.nBg; b++) if (cullGalaxy(X, b, 0.03)) n++;
  return Math.min(X.S.visCap, n + 4);
}

/** Runs the sky for a view. */
export function runSky(X: SkyInputs): SkyOut {
  const S = X.S;
  const visible: Visible[] = [];
  for (let b = 0; b < S.nBg; b++) {
    const v = cullGalaxy(X, b);
    if (v) visible.push(v);
  }
  let nDots = 0;
  for (const v of visible) nDots += v.np;
  const dbuf = new ArrayBuffer(Math.max(1, nDots) * INSTANCE_WORDS * 4);
  const dots = new Float32Array(dbuf);
  const dotsU = new Uint32Array(dbuf);
  let at = 0;
  const all: ReturnType<typeof galaxyRows> = [];
  for (const v of visible) {
    for (let j = 0; j < v.np; j++) skyDot(X, v, j, dots, dotsU, at++);
    all.push(...galaxyRows(X, v));
  }
  const spec = S.spec;
  const rows = new ArrayBuffer(Math.max(1, all.length) * 96);
  const rf = new Float32Array(rows);
  const ru = new Uint32Array(rows);
  all.forEach((r, k) => {
    writeRow(rf, ru, k, spec, r);
  });
  const fb = new ArrayBuffer(Math.max(1, S.nFg) * INSTANCE_WORDS * 4);
  const fg = new Float32Array(fb);
  const fgU = new Uint32Array(fb);
  let nFg = 0;
  for (let i = 0; i < S.nFg; i++) if (fgStar(X, i, fg, fgU, nFg)) nFg++;
  return { visible, dots, dotsU, nDots, rows, nRows: all.length, fg, fgU, nFg };
}
