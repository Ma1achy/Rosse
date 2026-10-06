/**
 * The placed vector drawings as the GPU reads them (ADR 0003, 0006): the library's tables
 * (src/marks/vector.ts `packVectors`, built once per set of drawings), the instance table of the
 * rows `vectorRows` places for a view (./parts.ts), and the stellar streams' polylines cut into
 * slots for their marks. compute/vector-expand.wgsl and its CPU twin
 * (src/fallback/kernels/vector.ts) expand them.
 *
 * Tiers (ADR 0010): which drawings are placed, with which warp, and so how many capsule, dot and
 * blob slots each takes, is the model tier (`describeVectors`); where they are, the per-view
 * matrices and the streams' slot counts (which follow the zoom), is the view tier (`vectorView`),
 * a few dozen rows and segments packed on the CPU.
 */
import type { Params } from '../core/params';
import type { StructLayout } from '../marks/instance';
import {
  DRAWING_WORDS,
  VECTOR_ATLASES,
  packVectors,
  type PackedVectors,
  type VectorLibrary,
} from '../marks/vector';
import { PLATE, UNIT_SCALE, type Camera } from '../view/camera';
import { wobbleAmplitude } from '../view/warp';
import { describeParts, vectorRows, type PartPicks, type PartsDesc, type VectorRow } from './parts';
import { penWeights, type DrawingsMeta, type Variation } from './variation';

const f = Math.fround;

const words = (name: string, fields: [string, 'u32' | 'f32' | 'vec2<f32>' | 'vec4<f32>'][]) => {
  let off = 0;
  const out = fields.map(([n, type]) => {
    const size = type === 'vec4<f32>' ? 16 : type === 'vec2<f32>' ? 8 : 4;
    const e = { name: n, type, offset: off, size };
    off += size;
    return e;
  });
  const align = Math.max(
    ...fields.map(([, t]) => (t === 'vec4<f32>' ? 16 : t === 'vec2<f32>' ? 8 : 4)),
  );
  return { name, size: off, align, fields: out };
};

/** Warp kinds of an instance (row[9], reference notes 8.3). */
export const WarpKind = {
  none: 0,
  /** the spiral rewind of a whole drawing (`{ fn }`, app23.js:L842–845): tile → tile */
  rewind: 1,
  /**
   * The generic hook for later milestones (`{ post }`: merger tides M8, lens Jacobians M9): a plate
   * → plate affine about a centre, `c + S·(q − c)`, after the matrix and before the wobble, with
   * v21's drop of segments stretched more than 1.8× (app23.js:L1208).
   */
  post: 2,
  /**
   * A merging galaxy's mark carried by its tides (M8, app23.js:L1195): the galaxy's 49 × 49 grid of
   * the tidal map (common/tide.wgsl `tide_post`) after the matrix, with the drops of `post`.
   */
  tide: 3,
  /**
   * `mWarp`'s whole drawing (app23.js:L1196, L1262): the tidal map itself (the 4 nearest stars) on
   * the drawing's own coordinates, mirrored for an S-wise drawing; dropped only past 22 px.
   */
  tideScreen: 4,
} as const;

/** One placed drawing: the `VInst` struct of vector-expand.wgsl (96 bytes). */
export const VINST_LAYOUT: StructLayout = words('VInst', [
  ['m', 'vec4<f32>'],
  ['t', 'vec2<f32>'],
  ['ps', 'f32'],
  ['sc', 'f32'],
  ['w', 'vec4<f32>'],
  ['w2', 'vec4<f32>'],
  ['drawing', 'u32'],
  ['warp', 'u32'],
  ['cap_first', 'u32'],
  ['dot_first', 'u32'],
  ['blob_first', 'u32'],
  ['pad0', 'u32'],
  ['pad1', 'u32'],
  ['pad2', 'u32'],
]);
export const VINST_WORDS = VINST_LAYOUT.size / 4;

/** A stream's segment between two points of its pen line: the `StreamSeg` struct (32 bytes). */
export const STREAM_SEG_LAYOUT: StructLayout = words('StreamSeg', [
  ['p0', 'vec2<f32>'],
  ['p1', 'vec2<f32>'],
  ['slot_first', 'u32'],
  ['n', 'u32'],
  ['index', 'u32'],
  ['pad0', 'u32'],
]);
export const STREAM_SEG_WORDS = STREAM_SEG_LAYOUT.size / 4;

/** The `Vec` uniform of vector-expand.wgsl. */
export const VEC_LAYOUT: StructLayout = words('Vec', [
  ['n_inst', 'u32'],
  ['n_cap_slots', 'u32'],
  ['n_dots', 'u32'],
  ['n_blobs', 'u32'],
  ['n_stream_segs', 'u32'],
  ['n_stream_slots', 'u32'],
  ['key', 'u32'],
  ['n_dot_pool', 'u32'],
  ['pen_line', 'f32'],
  ['wobble', 'f32'],
  ['stream_keep', 'f32'],
  ['pen_dot', 'f32'],
]);

/** The `Job` uniform of one compaction (vector-expand.wgsl `scan_local` …). */
export const JOB_LAYOUT: StructLayout = words('Job', [
  ['n', 'u32'],
  ['blocks', 'u32'],
  ['cap', 'u32'],
  ['mode', 'u32'],
]);
/** Job modes: capsules (one class, draw args [6n, 1, 0, 0]) or marks (dots, knots: [4, n, 0, 0]). */
export const JobMode = { caps: 0, marks: 1 } as const;

/** Stream mark classes, the compaction's keys. */
export const MarkClass = { dot: 0, knot: 1, none: 0xffffffff } as const;

/**
 * The index of a stream mark on the `partMarks` stream: its stream, its segment and its place on
 * the segment, so a zoom that adds marks to a segment keeps the ones it had.
 */
export const streamMarkIndex = (q: number, j: number, m: number) =>
  ((q << 24) | (j << 12) | (m & 0xfff)) >>> 0;

/** The model tier's vector drawings. */
export interface VectorDesc {
  lib: PackedVectors;
  parts: PartsDesc;
  /** per instance, in draw order: its drawing (index into `lib.table`) and warp kind */
  drawings: number[];
  warps: number[];
  capFirst: number[];
  dotFirst: number[];
  blobFirst: number[];
  nInst: number;
  nCapSlots: number;
  nDots: number;
  nBlobs: number;
  penLine: number;
  penDot: number;
  /** 0.55 + 0.45 · streams: a stream mark is kept when its draw is at most this (L1077) */
  streamKeep: number;
  /** a merging galaxy (0 or 1): every drawing is carried by that galaxy's tides (M8) */
  tide?: number;
}

const libCache = new WeakMap<object, PackedVectors>();

/** The library's tables, packed once per set of drawings. */
export function packedLibrary(vectors: Partial<VectorLibrary> | undefined): PackedVectors {
  if (!vectors) return packVectors({});
  let p = libCache.get(vectors);
  if (!p) libCache.set(vectors, (p = packVectors(vectors)));
  return p;
}

/** The drawing index of a row. */
export function drawingOf(lib: PackedVectors, row: Pick<VectorRow, 'atlas' | 'tile'>): number {
  return lib.first[row.atlas] + row.tile;
}

/** Slots per instance: a warped drawing's segments are densified (app23.js:L1202). */
function slots(lib: PackedVectors, d: number, warp: number) {
  const o = d * DRAWING_WORDS;
  return {
    caps: (warp !== WarpKind.none ? lib.table[o + 7] : lib.table[o + 1]) ?? 0,
    dots: lib.table[o + 3] ?? 0,
    blobs: lib.table[o + 5] ?? 0,
  };
}

/**
 * The model tier: the parts' picks (the engine's, or `picks`), and the drawings they place with
 * their slots. The rows are laid out once at the home camera to fix the instance list; every
 * view's rows have the same drawings in the same order (only matrices and positions move).
 */
export function describeVectors(
  P: Params,
  V: Variation,
  meta: DrawingsMeta,
  incl: number,
  picks?: PartPicks,
  tide?: number,
): VectorDesc {
  const lib = packedLibrary(meta.vectors);
  const parts = describeParts(P, V, meta, incl, picks);
  const rows = vectorRows(P, V, meta, parts, {
    incl,
    az: P.az || 0,
    pa: P.pa,
    winding: P.winding,
    zoom: 1,
  });
  const drawings: number[] = [];
  const warps: number[] = [];
  const capFirst: number[] = [];
  const dotFirst: number[] = [];
  const blobFirst: number[] = [];
  let nCap = 0;
  let nDot = 0;
  let nBlob = 0;
  for (const r of rows) {
    const d = drawingOf(lib, r);
    const w = tide !== undefined ? WarpKind.tide : r.warp ? WarpKind.rewind : WarpKind.none;
    drawings.push(d);
    warps.push(w);
    capFirst.push(nCap);
    dotFirst.push(nDot);
    blobFirst.push(nBlob);
    const s = slots(lib, d, w);
    nCap += s.caps;
    nDot += s.dots;
    nBlob += s.blobs;
  }
  const pen = penWeights(P.pen);
  return {
    lib,
    parts,
    drawings,
    warps,
    capFirst,
    dotFirst,
    blobFirst,
    nInst: rows.length,
    nCapSlots: nCap,
    nDots: nDot,
    nBlobs: nBlob,
    penLine: pen.line,
    penDot: pen.dot,
    streamKeep: 0.55 + 0.45 * P.streams,
    ...(tide !== undefined ? { tide } : {}),
  };
}

/** One view of the vector drawings: the packed instance table, the streams' slots, the uniform. */
export interface VectorView {
  rows: VectorRow[];
  inst: ArrayBuffer;
  nStreamSegs: number;
  nStreamSlots: number;
  streamSegs: ArrayBuffer;
  uniform: Record<string, number>;
}

/** The streams' segments for a zoom: slots per segment, max(1, round(d / 2.4)) (L1076). */
export function streamSegments(
  parts: PartsDesc,
  zoom: number,
): { buf: ArrayBuffer; nSegs: number; nSlots: number } {
  const sc = UNIT_SCALE * zoom;
  const c = PLATE / 2;
  const segs: { p0: [number, number]; p1: [number, number]; n: number; index: number }[] = [];
  parts.streams.forEach((pts, q) => {
    for (let j = 1; j < pts.length; j++) {
      const a = pts[j - 1] ?? [0, 0];
      const b = pts[j] ?? [0, 0];
      const p0: [number, number] = [c + a[0] * sc, c + a[1] * sc];
      const p1: [number, number] = [c + b[0] * sc, c + b[1] * sc];
      const n = Math.max(1, Math.round(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / 2.4));
      segs.push({ p0, p1, n: Math.min(n, 4096), index: streamMarkIndex(q, j, 0) });
    }
  });
  const buf = new ArrayBuffer(Math.max(1, segs.length) * STREAM_SEG_LAYOUT.size);
  const fl = new Float32Array(buf);
  const u = new Uint32Array(buf);
  let slot = 0;
  segs.forEach((s, i) => {
    const o = i * STREAM_SEG_WORDS;
    fl[o] = f(s.p0[0]);
    fl[o + 1] = f(s.p0[1]);
    fl[o + 2] = f(s.p1[0]);
    fl[o + 3] = f(s.p1[1]);
    u[o + 4] = slot;
    u[o + 5] = s.n;
    u[o + 6] = s.index;
    slot += s.n;
  });
  return { buf, nSegs: segs.length, nSlots: slot };
}

/** The view tier: this camera's rows, packed, and the uniform. */
export function vectorView(
  D: VectorDesc,
  P: Params,
  V: Variation,
  meta: DrawingsMeta,
  cam: Camera,
  key: number,
  nDotPool: number,
  r2 = 0,
): VectorView {
  const rows = vectorRows(P, V, meta, D.parts, cam);
  if (rows.length !== D.nInst) throw new Error('the placed drawings changed with the view');
  const inst = new ArrayBuffer(Math.max(1, rows.length) * VINST_LAYOUT.size);
  const fl = new Float32Array(inst);
  const u = new Uint32Array(inst);
  rows.forEach((r, i) => {
    const o = i * VINST_WORDS;
    fl.set(r.m.map(f), o);
    fl[o + 4] = f(r.x);
    fl[o + 5] = f(r.y);
    fl[o + 6] = f(r.ps);
    fl[o + 7] = f(Math.sqrt(Math.abs(r.m[0] * r.m[3] - r.m[1] * r.m[2])));
    if (D.tide !== undefined) {
      // the tides: the galaxy and R2, the plate px the grid spans
      fl[o + 8] = D.tide;
      fl[o + 9] = f(r2);
    } else if (r.warp) {
      fl[o + 8] = f(r.warp.dk);
      fl[o + 9] = r.warp.flip ? 1 : 0;
    }
    u[o + 16] = D.drawings[i] ?? 0;
    u[o + 17] = D.warps[i] ?? 0;
    u[o + 18] = D.capFirst[i] ?? 0;
    u[o + 19] = D.dotFirst[i] ?? 0;
    u[o + 20] = D.blobFirst[i] ?? 0;
  });
  const st = streamSegments(D.parts, cam.zoom);
  return {
    rows,
    inst,
    nStreamSegs: st.nSegs,
    nStreamSlots: st.nSlots,
    streamSegs: st.buf,
    uniform: {
      n_inst: D.nInst,
      n_cap_slots: D.nCapSlots,
      n_dots: D.nDots,
      n_blobs: D.nBlobs,
      n_stream_segs: st.nSegs,
      n_stream_slots: st.nSlots,
      key: key >>> 0,
      n_dot_pool: nDotPool,
      pen_line: f(D.penLine),
      wobble: wobbleAmplitude(P.distort),
      stream_keep: f(D.streamKeep),
      pen_dot: f(D.penDot),
    },
  };
}

/** Every sheet, by name, for statistics: how many drawings of each are placed. */
export function placedBySheet(rows: readonly VectorRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of VECTOR_ATLASES) out[a] = 0;
  for (const r of rows) out[r.atlas] = (out[r.atlas] ?? 0) + 1;
  return out;
}
