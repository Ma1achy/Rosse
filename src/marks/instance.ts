/**
 * Sprite instances: one bitmap mark each, as the reference's instance row
 * [x, y, tile, alpha, m0, m1, m2, m3] (app23.js:L171), in plate units (800 × 800, y down).
 *
 * The GPU struct is `Instance` in src/shaders/common/instance.wgsl. Its layout is described here
 * once (INSTANCE_LAYOUT) and checked against the WGSL declaration by tests/unit/layout.test.ts.
 * Plain data only: the CPU fallback reads the same objects.
 */

export interface Instance {
  /** centre, plate units */
  x: number;
  y: number;
  /** layer (cell) of the atlas */
  layer: number;
  /** ink alpha */
  alpha: number;
  /** 2 × 2 affine, column-major (as GLSL mat2) */
  m: readonly [number, number, number, number];
}

export type WgslScalar = 'f32' | 'u32' | 'i32';
export type WgslType = WgslScalar | `vec${2 | 3 | 4}<${WgslScalar}>`;

export interface FieldLayout {
  name: string;
  type: WgslType;
  offset: number;
  size: number;
}

export interface StructLayout {
  name: string;
  size: number;
  align: number;
  fields: readonly FieldLayout[];
}

export const INSTANCE_LAYOUT: StructLayout = {
  name: 'Instance',
  size: 32,
  align: 16,
  fields: [
    { name: 'pos', type: 'vec2<f32>', offset: 0, size: 8 },
    { name: 'layer', type: 'u32', offset: 8, size: 4 },
    { name: 'alpha', type: 'f32', offset: 12, size: 4 },
    { name: 'm', type: 'vec4<f32>', offset: 16, size: 16 },
  ],
};

/** Packs instances into the GPU layout. */
export function packInstances(list: readonly Instance[]): ArrayBuffer {
  const words = INSTANCE_LAYOUT.size / 4;
  const buf = new ArrayBuffer(Math.max(1, list.length) * INSTANCE_LAYOUT.size);
  const f = new Float32Array(buf);
  const u = new Uint32Array(buf);
  list.forEach((s, i) => {
    const o = i * words;
    f[o] = s.x;
    f[o + 1] = s.y;
    u[o + 2] = s.layer;
    f[o + 3] = s.alpha;
    f.set(s.m, o + 4);
  });
  return buf;
}

/** The reference's `simple(size, rot)`: rotate by `rot`, then scale by `size` (app23.js:L173). */
export function simple(size: number, rot: number): [number, number, number, number] {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  // chain(Rm(rot), Sm(size, size)) = Rm(rot) · Sm
  return [c * size, s * size, -s * size, c * size];
}
