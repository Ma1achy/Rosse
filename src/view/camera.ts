/**
 * The camera: inclination, azimuth (orbit about the galaxy's axis), position angle (roll on the
 * plate), winding (mirror) and zoom, and every projection the reference builds from them
 * (docs/reference-notes.md section 5).
 *
 * **One rotation.** v21 writes the same rotation out five times: `project` (app23.js:L153),
 * `discM` (L126), `rotFwd`/`rotInv` (L440–441), `toView`/`toScreen` (L859–860). Here the
 * trigonometry is evaluated once per orientation (`rotation`) and every stage reads it:
 *
 * - `rotFwd(p, R)`: galaxy frame → view frame (x right, y down, z towards the viewer): mirror x by
 *   the winding, orbit by `az` about the galaxy's axis, tilt by `incl` about x;
 * - `rotInv(v, R)`: its inverse;
 * - `toView(w, R)`: `rotFwd` without the mirror (the sky, L859);
 * - `toScreen(v, k, R, scale)`: roll by `pa`, scale by `VIEW.scale · k`, centre on the plate (L860);
 * - `project(p, cam)` = `toScreen(rotFwd(p), 1)`: the orthographic galaxy (L153);
 * - `perspective(depth)` = CAM / (CAM − depth): the deep field's perspective factor (L884);
 * - `viewDesc(cam)`: the same numbers rounded to f32 once, the `View` uniform both engines read.
 *
 * The operations are in v21's order, so these functions give v21's numbers to the last bit
 * (tests/unit/camera.test.ts against tests/vectors/camera.json, made by evaluating v21's own
 * functions: `npm run vectors:camera`).
 *
 * **incE buckets.** v21 switches structure at fixed inclinations through `incE()` (L856), the
 * inclination folded into 0–90°. `INCE_USES` lists every use; `inclBucket` numbers the intervals
 * between them, so that every use gives the same answer for any two inclinations in one bucket.
 * The bucket is part of the model tier's key (ADR 0010): crossing one rebuilds the model.
 *
 * **Zoom.** Not a parameter in v21 (`ZOOM`, L857) but page state: `VIEW.scale` = 84 · zoom
 * (L1227), clamped to 0.15–12 by every control (L1853–1874). It is a view-tier input here.
 */
import type { Params } from '../core/params';
import type { StructLayout } from '../marks/instance';

const f = Math.fround;

/** The plate's size in units (the reference's `VIEW.W`). */
export const PLATE = 800;
/** Plate units per galaxy unit at zoom 1 (`VIEW.scale`, app23.js:L122). */
export const UNIT_SCALE = 84;
/** The zoom range of every zoom control (app23.js:L1853, L1861, L1865, L1873). */
export const ZOOM_MIN = 0.15;
export const ZOOM_MAX = 12;
/** The deep field's perspective camera (app23.js:L857): distance on the view axis, in galaxy units. */
export const CAM = 30;
/** The sky's shell of background galaxies and the foreground stars' radius (app23.js:L857). */
export const SKY_RMIN = 40;
export const SKY_RMAX = 240;
export const R_FG = 42;

export interface Camera {
  incl: number;
  az: number;
  pa: number;
  winding: number;
  zoom: number;
}

/** v21's orientation `{ incl, az, w, pa }` (`orientNow`, app23.js:L442). */
export interface Orientation {
  incl: number;
  az: number;
  w: number;
  pa: number;
}

export function cameraOf(P: Params, zoom = 1): Camera {
  return { incl: P.incl, az: P.az || 0, pa: P.pa, winding: P.winding, zoom };
}

export function orientationOf(cam: Camera): Orientation {
  return { incl: cam.incl, az: cam.az || 0, w: cam.winding, pa: cam.pa };
}

/** v21's `VIEW.scale` for a zoom (app23.js:L1227). */
export function viewScale(zoom: number): number {
  return UNIT_SCALE * zoom;
}

export function clamp(x: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, x));
}

export function clampZoom(z: number): number {
  return clamp(z, ZOOM_MIN, ZOOM_MAX);
}

/** An angle in degrees wrapped into [0, 360), as the orbit control does (app23.js:L1837). */
export function wrapDeg(a: number): number {
  return ((a % 360) + 360) % 360;
}

/** The trigonometry of one orientation, evaluated once (in v21's expression order). */
export interface Rotation {
  /** cos and sin of incl */
  ci: number;
  si: number;
  /** cos and sin of az */
  cz: number;
  sz: number;
  /** cos and sin of pa */
  cp: number;
  sp: number;
  /** winding (x mirror) */
  w: number;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

export function rotation(o: Orientation): Rotation {
  const i = rad(o.incl);
  const az = rad(o.az || 0);
  const pa = rad(o.pa);
  return {
    ci: Math.cos(i),
    si: Math.sin(i),
    cz: Math.cos(az),
    sz: Math.sin(az),
    cp: Math.cos(pa),
    sp: Math.sin(pa),
    w: o.w,
  };
}

export const rotationOf = (cam: Camera): Rotation => rotation(orientationOf(cam));

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];
/** A 2 × 2 matrix, column-major as GLSL `mat2` (app23.js:L89–92). */
export type Mat2 = [number, number, number, number];

/** Galaxy frame → view frame (app23.js:L440): [x, y down the plate, depth towards the viewer]. */
export function rotFwd(p: readonly number[], R: Rotation): Vec3 {
  const x0 = (p[0] ?? 0) * R.w;
  const y0 = p[1] ?? 0;
  const z = p[2] ?? 0;
  const x = x0 * R.cz - y0 * R.sz;
  const ya = x0 * R.sz + y0 * R.cz;
  return [x, ya * R.ci - z * R.si, ya * R.si + z * R.ci];
}

/** View frame → galaxy frame (app23.js:L441), the inverse of `rotFwd`. */
export function rotInv(v: readonly number[], R: Rotation): Vec3 {
  const v0 = v[0] ?? 0;
  const v1 = v[1] ?? 0;
  const v2 = v[2] ?? 0;
  const ya = v1 * R.ci + v2 * R.si;
  const pz = -v1 * R.si + v2 * R.ci;
  const x0 = v0 * R.cz + ya * R.sz;
  const y0 = -v0 * R.sz + ya * R.cz;
  return [x0 / R.w, y0, pz];
}

/** World → view without the mirror (app23.js:L859), for the sky. */
export function toView(w: readonly number[], R: Rotation): Vec3 {
  return rotFwd(w, R.w === 1 ? R : { ...R, w: 1 });
}

/** View → plate with a perspective factor `k` (app23.js:L860): roll by pa, scale, centre. */
export function toScreen(v: readonly number[], k: number, R: Rotation, scale: number): Vec2 {
  const fk = scale * k;
  const v0 = v[0] ?? 0;
  const v1 = v[1] ?? 0;
  return [PLATE / 2 + (v0 * R.cp - v1 * R.sp) * fk, PLATE / 2 + (v0 * R.sp + v1 * R.cp) * fk];
}

/** The deep field's perspective factor for a view-frame depth (app23.js:L884). */
export function perspective(depth: number): number {
  return CAM / (CAM - depth);
}

/** The reference's `project(p)` (app23.js:L153), in f64: galaxy frame → plate. Orthographic. */
export function project(p: readonly number[], cam: Camera, R: Rotation = rotationOf(cam)): Vec2 {
  const v = rotFwd(p, R);
  return toScreen(v, 1, R, viewScale(cam.zoom));
}

function Rm(t: number): Mat2 {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [c, s, -s, c];
}
function Sm(x: number, y: number): Mat2 {
  return [x, 0, 0, y];
}
function mul(A: Mat2, B: Mat2): Mat2 {
  return [
    A[0] * B[0] + A[2] * B[1],
    A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3],
    A[1] * B[2] + A[3] * B[3],
  ];
}
/** v21's `chain` (app23.js:L92): the product of the matrices, left to right. */
export function chain(...ms: Mat2[]): Mat2 {
  let M: Mat2 = [1, 0, 0, 1];
  for (const m of ms) M = mul(M, m);
  return M;
}

/**
 * The disc plane → plate at unit scale (app23.js:L126): `R(pa)·S(1, cos i)·R(az)·S(winding, 1)`.
 * Lays drawings on the disc.
 */
export function discM(cam: Camera): Mat2 {
  return chain(
    Rm(rad(cam.pa)),
    Sm(1, Math.cos(rad(cam.incl))),
    Rm(rad(cam.az || 0)),
    Sm(cam.winding, 1),
  );
}

/** Two unit vectors spanning the plane with normal `n` (app23.js:L861). */
export function basis(n: readonly number[]): [Vec3, Vec3] {
  const n0 = n[0] ?? 0;
  const n1 = n[1] ?? 0;
  const n2 = n[2] ?? 0;
  const a = Math.abs(n2) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const [a0 = 0, a1 = 0, a2 = 0] = a;
  let e1: Vec3 = [n1 * a2 - n2 * a1, n2 * a0 - n0 * a2, n0 * a1 - n1 * a0];
  const l = Math.hypot(e1[0], e1[1], e1[2]);
  e1 = [e1[0] / l, e1[1] / l, e1[2] / l];
  return [e1, [n1 * e1[2] - n2 * e1[1], n2 * e1[0] - n0 * e1[2], n0 * e1[1] - n1 * e1[0]]];
}

/**
 * A 2 × 2 laying a drawing on a plane with world normal `nw` (app23.js:L863): foreshortened by
 * |n_z| (at least `flat`, 0.12 by default), mirrored when the plane faces away.
 */
export function orient(
  nw: readonly number[],
  size: number,
  spin: number,
  flat: number | undefined,
  cam: Camera,
  R: Rotation = rotationOf(cam),
): Mat2 {
  const n = toView(nw, R);
  const cosI = Math.abs(n[2]);
  const phi = Math.atan2(n[1], n[0]) + Math.PI / 2 + rad(cam.pa);
  return chain(
    Rm(phi),
    Sm(size, size * Math.max(flat || 0.12, cosI)),
    Sm(n[2] < 0 ? -1 : 1, 1),
    Rm(spin),
  );
}

/**
 * A point placed at plate offset (sx, sy) and `depth` as seen from `home`, seen now
 * (app23.js:L446). v21 remembers `home` from navigation history (`homeFor`); here it is explicit
 * (docs/architecture.md, deliberate divergence 2).
 */
export function scenePoint(
  home: Orientation,
  sx: number,
  sy: number,
  depth: number,
  cam: Camera,
): Vec2 {
  const pa0 = rad(home.pa);
  const lx = sx * Math.cos(pa0) + sy * Math.sin(pa0);
  const ly = -sx * Math.sin(pa0) + sy * Math.cos(pa0);
  const R = rotationOf(cam);
  const v = rotFwd(rotInv([lx, ly, depth], rotation(home)), R);
  const pa = rad(cam.pa);
  const sc = viewScale(cam.zoom);
  return [
    PLATE / 2 + (v[0] * Math.cos(pa) - v[1] * Math.sin(pa)) * sc,
    PLATE / 2 + (v[0] * Math.sin(pa) + v[1] * Math.cos(pa)) * sc,
  ];
}

/**
 * A lensed source fixed in 3D a distance D behind the lens, placed at (bx, by) from `home`: its
 * lens-plane offset as seen now (app23.js:L450).
 */
export function srcNow(home: Orientation, bx: number, by: number, D: number, cam: Camera): Vec2 {
  const v = rotFwd(rotInv([bx, by, -D], rotation(home)), rotationOf(cam));
  return [v[0], v[1]];
}

// ---------------------------------------------------------------------------------------------
// incE and its buckets

/** The reference's `incE()` (app23.js:L856): the inclination folded into 0–90°. */
export function incE(incl: number): number {
  let i = ((incl % 360) + 360) % 360;
  if (i > 180) i = 360 - i;
  return i > 90 ? 180 - i : i;
}

/** The `incE()` thresholds at which the reference switches structure (reference notes 5.1). */
export const INCL_THRESHOLDS = [70, 72, 74, 78, 80] as const;

/** One use of `incE()` in v21: where, the test it makes, and what it switches. */
export interface IncEUse {
  line: number;
  test: (e: number) => boolean;
  /** the test as written in app23.js */
  source: string;
  what: string;
  /** the milestone that implements it */
  milestone: string;
}

/**
 * Every use of `incE()` in app23.js (12, besides its definition at L856). Checked against the
 * source by tests/unit/camera.test.ts.
 */
export const INCE_USES: readonly IncEUse[] = [
  {
    line: 201,
    source: 'incE() > 72',
    test: (e) => e > 72,
    milestone: 'M4',
    what: 'dust-carving pen lines: one lane along the midplane instead of one per arm (up to 3)',
  },
  {
    line: 207,
    source: 'incE() > 72',
    test: (e) => e > 72,
    milestone: 'M4',
    what: 'dust-carving pen lines laid along the midplane',
  },
  {
    line: 788,
    source: 'incE() > 80',
    test: (e) => e > 80,
    milestone: 'M4',
    what: 'the edge-on midplane stroke',
  },
  {
    line: 928,
    source: 'incE() > 74',
    test: (e) => e > 74,
    milestone: 'M4',
    what: 'dust clouds: edge-on scribble count (3 instead of 5 + 9·dustScribble)',
  },
  {
    line: 950,
    source: 'incE() > 74',
    test: (e) => e > 74,
    milestone: 'M4',
    what: 'hatched dust lanes on the edge-on midplane',
  },
  {
    line: 960,
    source: 'incE() <= 74',
    test: (e) => e <= 74,
    milestone: 'M4',
    what: 'the hatched lane just inside a ring',
  },
  {
    line: 965,
    source: 'incE() > 74',
    test: (e) => e > 74,
    milestone: 'M4',
    what: 'no hatched arm lanes when edge-on',
  },
  {
    line: 1000,
    source: 'incE() > 70',
    test: (e) => e > 70,
    milestone: 'M5',
    what: "whole-drawing type 'smooth:elongated' (with bulgeFlat < 0.6)",
  },
  {
    line: 1001,
    source: 'incE() > 78',
    test: (e) => e > 78,
    milestone: 'M5',
    what: "whole-drawing types 'edge-on', 'edge-on:dust-lane', 'edge-on:thick'",
  },
  {
    line: 1028,
    source: 'incE() < 80',
    test: (e) => e < 80,
    milestone: 'M2',
    what: 'the drawn core (none from 80° up)',
  },
  {
    line: 1029,
    source: 'incE() > 70',
    test: (e) => e > 70,
    milestone: 'M2',
    what: "the drawn core's style: dotted above 70°",
  },
  {
    line: 1031,
    source: 'incE() > 78',
    test: (e) => e > 78,
    milestone: 'M5',
    what: 'the core flattened to 0.55 on edge-on galaxies',
  },
];

/**
 * The bucket edges, in increasing order: every use above is one of these predicates or its
 * complement. 80 appears twice because L1028 tests `< 80` and L788 `> 80`, so exactly 80° is a
 * bucket of its own.
 */
const BUCKET_EDGES: readonly ((e: number) => boolean)[] = [
  (e) => e > 70,
  (e) => e > 72,
  (e) => e > 74,
  (e) => e > 78,
  (e) => e >= 80,
  (e) => e > 80,
];

/** Number of `incE` buckets (`inclBucket` is in 0 … INCL_BUCKETS − 1). */
export const INCL_BUCKETS = BUCKET_EDGES.length + 1;

/**
 * Which side of each `incE()` threshold `incl` is on: part of the model tier's key (ADR 0010).
 * Two inclinations in the same bucket give the same answer at every use in `INCE_USES`.
 */
export function inclBucket(incl: number): number {
  const e = incE(incl);
  let b = 0;
  for (const edge of BUCKET_EDGES) if (edge(e)) b++;
  return b;
}

// ---------------------------------------------------------------------------------------------
// The View uniform

/** The `View` uniform of project.wgsl: the camera as f32 numbers. */
export const VIEW_LAYOUT: StructLayout = {
  name: 'View',
  size: 64,
  align: 4,
  fields: [
    'cos_i',
    'sin_i',
    'cos_az',
    'sin_az',
    'cos_pa',
    'sin_pa',
    'winding',
    'scale',
    'cx',
    'cy',
    'dust',
    'pad0',
    'n',
    'cap',
    'pad1',
    'pad2',
  ].map((name, i) => ({
    name,
    type: i >= 12 ? ('u32' as const) : ('f32' as const),
    offset: i * 4,
    size: 4,
  })),
};

export type ViewDesc = Record<string, number>;

/** The camera's numbers, rounded to f32. `dust` is the galaxy's extinction (for the τ cull). */
export function viewDesc(cam: Camera, dust: number, n: number, cap: number): ViewDesc {
  const R = rotationOf(cam);
  return {
    cos_i: f(R.ci),
    sin_i: f(R.si),
    cos_az: f(R.cz),
    sin_az: f(R.sz),
    cos_pa: f(R.cp),
    sin_pa: f(R.sp),
    winding: f(cam.winding),
    scale: f(viewScale(cam.zoom)),
    cx: PLATE / 2,
    cy: PLATE / 2,
    dust: f(dust),
    pad0: 0,
    n,
    cap,
    pad1: 0,
    pad2: 0,
  };
}

export function packView(v: ViewDesc): ArrayBuffer {
  const buf = new ArrayBuffer(VIEW_LAYOUT.size);
  const u = new Uint32Array(buf);
  const fl = new Float32Array(buf);
  for (const field of VIEW_LAYOUT.fields) {
    const x = v[field.name];
    if (x === undefined) throw new Error(`View.${field.name} missing`);
    if (field.type === 'u32') u[field.offset / 4] = x;
    else fl[field.offset / 4] = x;
  }
  return buf;
}
