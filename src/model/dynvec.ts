/**
 * Dynamic vector sets (M7): placed drawings whose count is only known on the GPU after the view's
 * culls, such as the stipple's drawn stars (`sstars`, one per compacted `rstar`) and the deep
 * field's drawings. They use the same expansion as the placed parts (compute/vector-expand.wgsl,
 * ADR 0006) but their instance rows are written by a compute pass of the view tier
 * (compute/dyn-rows.wgsl, CPU twin `rstarRows` here) into an instance table of fixed capacity, at
 * fixed strides of slots: row k owns capsule slots `k · strideCaps …`, dot slots `k · strideDots …`
 * and blob slots `k · strideBlobs …`. A slot beyond its drawing's segments, dots or blobs, and
 * every slot of an inactive row, expands to nothing (the capsule is dropped by its key, the dot or
 * blob has a zero matrix), so no count has to come back to the CPU (ADR 0003).
 */
import type { Params } from '../core/params';
import { DRAWING_WORDS, type PackedVectors, type VectorAtlas } from '../marks/vector';
import { NO_PICKS } from './parts';
import { penWeights } from './variation';
import { VINST_WORDS, type VectorDesc, type VectorView } from './vectors';
import { wobbleAmplitude } from '../view/warp';

const f = Math.fround;

/** The drawing index of an inactive row. */
export const INACTIVE = 0xffffffff;

/** Rows, and the slots each owns. */
export interface DynSpec {
  rows: number;
  strideCaps: number;
  strideDots: number;
  strideBlobs: number;
}

/** The largest segment, dot and blob counts over the drawings of the given sheets. */
export function sheetStrides(
  lib: PackedVectors,
  sheets: readonly VectorAtlas[],
): Pick<DynSpec, 'strideCaps' | 'strideDots' | 'strideBlobs'> {
  const order = Object.entries(lib.first).sort((a, b) => a[1] - b[1]);
  let caps = 0;
  let dots = 0;
  let blobs = 0;
  for (const sheet of sheets) {
    const at = order.findIndex(([n]) => n === sheet);
    const first = order[at]?.[1] ?? 0;
    const end = order[at + 1]?.[1] ?? lib.nDrawings;
    for (let d = first; d < end; d++) {
      const o = d * DRAWING_WORDS;
      caps = Math.max(caps, lib.table[o + 1] ?? 0);
      dots = Math.max(dots, lib.table[o + 3] ?? 0);
      blobs = Math.max(blobs, lib.table[o + 5] ?? 0);
    }
  }
  return { strideCaps: caps, strideDots: dots, strideBlobs: blobs };
}

/** The model-tier description of a dynamic set: no placed parts, `rows` instances of capacity. */
export function dynDesc(lib: PackedVectors, P: Params, spec: DynSpec): VectorDesc {
  const pen = penWeights(P.pen);
  return {
    lib,
    parts: { picks: NO_PICKS, wholeType: null, streams: [] },
    drawings: [],
    warps: [],
    capFirst: [],
    dotFirst: [],
    blobFirst: [],
    nInst: spec.rows,
    nCapSlots: spec.rows * spec.strideCaps,
    nDots: spec.rows * spec.strideDots,
    nBlobs: spec.rows * spec.strideBlobs,
    penLine: pen.line,
    penDot: pen.dot,
    streamKeep: 0,
    dynamic: true,
  };
}

/** The `Vec` uniform of a dynamic set for a view: `live` rows on the CPU, the capacity on the GPU. */
export function dynUniform(
  P: Params,
  spec: DynSpec,
  live: number,
  key: number,
  nDotPool: number,
): Record<string, number> {
  const pen = penWeights(P.pen);
  return {
    n_inst: live,
    n_cap_slots: live * spec.strideCaps,
    n_dots: live * spec.strideDots,
    n_blobs: live * spec.strideBlobs,
    n_stream_segs: 0,
    n_stream_slots: 0,
    key: key >>> 0,
    n_dot_pool: nDotPool,
    pen_line: f(pen.line),
    wobble: wobbleAmplitude(P.distort),
    stream_keep: 0,
    pen_dot: f(pen.dot),
  };
}

/** One row's fields, as the `VInst` struct. */
export interface DynRow {
  /** tile → plate, column-major */
  m: readonly [number, number, number, number];
  x: number;
  y: number;
  ps: number;
  /** the drawing (index into the library's table), or INACTIVE */
  drawing: number;
}

/** Writes row `k` of an instance table (VINST_LAYOUT) at the set's strides. */
export function writeRow(
  fl: Float32Array,
  u: Uint32Array,
  k: number,
  spec: DynSpec,
  row: DynRow | null,
): void {
  const o = k * VINST_WORDS;
  fl.fill(0, o, o + VINST_WORDS);
  if (row) {
    for (let j = 0; j < 4; j++) fl[o + j] = f(row.m[j] ?? 0);
    fl[o + 4] = f(row.x);
    fl[o + 5] = f(row.y);
    fl[o + 6] = f(row.ps);
    fl[o + 7] = f(Math.sqrt(Math.abs(f(f(row.m[0] * row.m[3]) - f(row.m[1] * row.m[2])))));
  }
  u[o + 16] = row ? row.drawing : INACTIVE;
  u[o + 17] = 0;
  u[o + 18] = k * spec.strideCaps;
  u[o + 19] = k * spec.strideDots;
  u[o + 20] = k * spec.strideBlobs;
}

/**
 * The drawn stars' rows: row k is the k-th compacted `rstar` instance [x, y, tile, ps, m], the
 * drawing `first + tile` of the `sstars` sheet at its matrix and pen scale (v21's row
 * [x, y, tile, 1, simple(sz, rot)] with ps pushed, app23.js:L190). Rows beyond `count` are inactive.
 */
export function rstarRows(
  instF: Float32Array,
  instU: Uint32Array,
  base: number,
  count: number,
  first: number,
  spec: DynSpec,
  live = spec.rows,
): ArrayBuffer {
  const buf = new ArrayBuffer(Math.max(1, live) * VINST_WORDS * 4);
  const fl = new Float32Array(buf);
  const u = new Uint32Array(buf);
  const n = Math.min(count, spec.rows);
  for (let k = 0; k < live; k++) {
    if (k >= n) {
      writeRow(fl, u, k, spec, null);
      continue;
    }
    const o = (base + k) * 8;
    writeRow(fl, u, k, spec, {
      m: [instF[o + 4] ?? 0, instF[o + 5] ?? 0, instF[o + 6] ?? 0, instF[o + 7] ?? 0],
      x: instF[o] ?? 0,
      y: instF[o + 1] ?? 0,
      ps: instF[o + 3] ?? 1,
      drawing: first + (instU[o + 2] ?? 0),
    });
  }
  return buf;
}

/** A VectorView over a dynamic set's rows, for the CPU twin of the expansion. */
export function dynView(
  P: Params,
  spec: DynSpec,
  rows: ArrayBuffer,
  live: number,
  key: number,
  nDotPool: number,
): VectorView {
  return {
    rows: [],
    inst: rows,
    nStreamSegs: 0,
    nStreamSlots: 0,
    streamSegs: new ArrayBuffer(32),
    uniform: dynUniform(P, spec, live, key, nDotPool),
  };
}
