/**
 * Struct layouts of the lens passes, written once here and once in the WGSL (ADR 0002):
 * tests/unit/lens-layout.test.ts checks every one against the declaration it describes.
 */
import type { StructLayout } from '../marks/instance';

type Word = 'u32' | 'f32' | 'vec2<f32>' | 'vec4<f32>';

const alignOf = (t: Word) => (t === 'vec4<f32>' ? 16 : t === 'vec2<f32>' ? 8 : 4);
const sizeOf = (t: Word) => (t === 'vec4<f32>' ? 16 : t === 'vec2<f32>' ? 8 : 4);

const words = (name: string, fields: [string, Word][]): StructLayout => {
  let off = 0;
  const out = fields.map(([n, type]) => {
    off = Math.ceil(off / alignOf(type)) * alignOf(type);
    const e = { name: n, type, offset: off, size: sizeOf(type) };
    off += sizeOf(type);
    return e;
  });
  const align = Math.max(...fields.map(([, t]) => alignOf(t)));
  return { name, size: Math.ceil(off / align) * align, align, fields: out };
};

/** One solver (common/lens-types.wgsl): 20 words. */
export const SOLVER_LAYOUT = words('Solver', [
  ['g', 'u32'],
  ['n', 'u32'],
  ['n_halo', 'u32'],
  ['hbase', 'u32'],
  ['vbase', 'u32'],
  ['obase', 'u32'],
  ['ibase', 'u32'],
  ['id_cap', 'u32'],
  ['r', 'f32'],
  ['f', 'f32'],
  ['cell', 'f32'],
  ['sh_g', 'f32'],
  ['sh_c2', 'f32'],
  ['sh_s2', 'f32'],
  ['pad0', 'f32'],
  ['pad1', 'f32'],
  ['bx0', 'f32'],
  ['by0', 'f32'],
  ['cw', 'f32'],
  ['ch', 'f32'],
]);
export const SOLVER_WORDS = SOLVER_LAYOUT.size / 4;

/** One source mark (compute/lens-query.wgsl, lens-marks.wgsl): 48 bytes. */
export const LMARK_LAYOUT = words('LMark', [
  ['b', 'vec2<f32>'],
  ['layer', 'u32'],
  ['alpha', 'f32'],
  ['m', 'vec4<f32>'],
  ['cls', 'u32'],
  ['src', 'u32'],
  ['pad0', 'u32'],
  ['pad1', 'u32'],
]);

/** One source as the view sees it. */
export const LSRC_LAYOUT = words('Src', [
  ['bc', 'vec2<f32>'],
  ['k', 'f32'],
  ['dens', 'f32'],
  ['solver', 'u32'],
  ['pad0', 'u32'],
  ['pad1', 'u32'],
  ['pad2', 'u32'],
]);
export const LSRC_WORDS = LSRC_LAYOUT.size / 4;

/** One image of a mark. */
export const IMG_LAYOUT = words('Img', [
  ['p', 'vec2<f32>'],
  ['mu', 'f32'],
  ['tri', 'u32'],
  ['j', 'vec4<f32>'],
]);

/** One source curve, as the matcher reads it. */
export const LCURVE_LAYOUT = words('CurveIn', [
  ['first_mark', 'u32'],
  ['n_pts', 'u32'],
  ['braw_first', 'u32'],
  ['cell4_bits', 'u32'],
  ['layer', 'u32'],
  ['flags', 'u32'],
  ['w', 'f32'],
  ['a', 'f32'],
  ['thick', 'f32'],
  ['piece_first', 'u32'],
  ['piece_n', 'u32'],
  ['cap_reps', 'u32'],
]);

/** The marks job of compute/lens-marks.wgsl. */
export const LMARKS_JOB_LAYOUT = words('Job', [
  ['n', 'u32'],
  ['first', 'u32'],
  ['src', 'u32'],
  ['k', 'f32'],
]);

/** Words of the view uniform (compute/lens-query.wgsl `LensView`), and where its arrays start. */
export const LENS_VIEW_WORDS = 36;
export const LENS_VIEW_CBASE = 20;
export const LENS_VIEW_CCAP = 28;
