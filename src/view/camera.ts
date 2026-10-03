/**
 * The camera: inclination, azimuth (orbit about the galaxy's axis), position angle (twist on the
 * plate), winding (mirror) and zoom.
 *
 * `project` is the reference's (app23.js:L153): mirror x by the winding, orbit by `az` about the
 * galaxy's axis, tilt by `incl` about x (y' = y cos i − z sin i), roll by `pa`, then scale by
 * `VIEW.scale` = 84 × zoom and centre on the 800-unit plate (y down). Orthographic.
 *
 * The trigonometry is evaluated once on the CPU and rounded to f32 (`viewDesc`), and both engines
 * read those numbers, so the WebGPU and CPU engines start from identical rotations. Still to come
 * (M3): `discM`, `rotFwd`/`rotInv`, `toView`, the deep-field perspective (`CAM = 30`) and orbit
 * input, which belongs to the page and only writes camera parameters.
 */
import type { Params } from '../core/params';
import type { StructLayout } from '../marks/instance';

const f = Math.fround;

/** The plate's size in units (the reference's `VIEW.W`). */
export const PLATE = 800;
/** Plate units per galaxy unit at zoom 1 (`VIEW.scale`, app23.js:L122). */
export const UNIT_SCALE = 84;

export interface Camera {
  incl: number;
  az: number;
  pa: number;
  winding: number;
  zoom: number;
}

export function cameraOf(P: Params, zoom = 1): Camera {
  return { incl: P.incl, az: P.az || 0, pa: P.pa, winding: P.winding, zoom };
}

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

const RAD = Math.PI / 180;

/** The camera's numbers, rounded to f32. `dust` is the galaxy's extinction (for the τ cull). */
export function viewDesc(cam: Camera, dust: number, n: number, cap: number): ViewDesc {
  const i = cam.incl * RAD;
  const az = cam.az * RAD;
  const pa = cam.pa * RAD;
  return {
    cos_i: f(Math.cos(i)),
    sin_i: f(Math.sin(i)),
    cos_az: f(Math.cos(az)),
    sin_az: f(Math.sin(az)),
    cos_pa: f(Math.cos(pa)),
    sin_pa: f(Math.sin(pa)),
    winding: f(cam.winding),
    scale: f(UNIT_SCALE * cam.zoom),
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

/** The reference's `project(p)` in f64, for tests and CPU-side placement. */
export function project(p: readonly [number, number, number], cam: Camera): [number, number] {
  const i = cam.incl * RAD;
  const c = Math.cos(i);
  const s = Math.sin(i);
  const az = cam.az * RAD;
  const cz = Math.cos(az);
  const sz = Math.sin(az);
  const x0 = p[0] * cam.winding;
  const y0 = p[1];
  const x = x0 * cz - y0 * sz;
  const ya = x0 * sz + y0 * cz;
  const y = ya * c - p[2] * s;
  const a = cam.pa * RAD;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const sc = UNIT_SCALE * cam.zoom;
  return [PLATE / 2 + (x * ca - y * sa) * sc, PLATE / 2 + (x * sa + y * ca) * sc];
}
