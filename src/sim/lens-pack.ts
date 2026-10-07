/**
 * The lens scene as the kernels read it (ADR 0003, 0008): the table of source marks, the curves'
 * table, the warped drawings' instances and the output capacities, laid out once in the model
 * tier from a `LensScene` (./lens.ts). WebGPU (src/render/lens.ts) uploads them; the CPU engine
 * (src/fallback/lens.ts) reads them as they are, so both run the same kernels on the same tables.
 *
 * The mark table, in order:
 *   - each source's stipple samples, one mark per sample the source's own culls left (the first
 *     `nStipple[s]` entries of its range; culled ones carry class 255), filled from the source's
 *     projected samples (compute/lens-marks.wgsl, or `fillStippleMarks` on the CPU);
 *   - the drawn cores and nuclear spirals (class 6), one per source mark;
 *   - the anchor of each warped drawing (class 7), whose images the drawing is carried to;
 *   - every point of every curve, resampled in the source plane (class 8);
 *   - the quasar's own position (class 9), whose images are the quasar's.
 * A mark has up to 8 images (slots); a slot makes 0 or more instances of its class.
 */
import type { Instance } from '../marks/instance';
import type { InkLayer } from '../render/layers';
import { DRAWING_WORDS, type PackedVectors } from '../marks/vector';
import type { VectorRow } from '../model/parts';
import { CurveFlag, type RibbonDesc } from '../model/ribbons';
import {
  drawingOf,
  packedLibrary,
  WarpKind,
  type VectorDesc,
  type VectorView,
} from '../model/vectors';
import { NO_PICKS } from '../model/parts';
import type { DrawingsMeta } from '../model/variation';
import { penWeights } from '../model/variation';
import { wobbleAmplitude } from '../view/warp';
import {
  LENS_CLASSES,
  LMARK_WORDS,
  LensCls,
  MAX_BRANCHES,
  QUASAR_KNOTS,
  QUASAR_SLOTS,
  lensMarks,
  type LensMarks,
} from '../fallback/kernels/lens';
import { MAX_IMAGES, type LensScene } from './lens';
import type { Params } from '../core/params';

const f = Math.fround;

/** The branches the ribbons can hold in all (the rest are dropped). */
export const LENS_BRANCH_SLOTS = 96;
/** Repeats the re-spaced pieces of a lensed branch may take (the model's capReps, bounded). */
export const LENS_CAP_REPS = 8;
/** Words per curve in the curves' table (LCURVE_LAYOUT of src/render/lens.ts). */
export const LCURVE_WORDS = 12;
/** Words per warped drawing's anchor in the table `lvecs`. */
export const LVEC_WORDS = 2;
/** Mark classes that are not emitted. */
export const MarkKind = { vec: 7, curve: 8, quasar: 9, none: 255 } as const;

export interface LensCurveRef {
  /** its source */
  src: number;
  /** its marks: first mark index, count */
  firstMark: number;
  n: number;
  /** its raw branch points, in the kernel's scratch table */
  brawFirst: number;
}

/** The lens scene's tables. */
export interface LensLayout {
  L: LensScene;
  /** per source: first stipple mark, samples */
  stippleFirst: number[];
  nStipple: number[];
  /** index of the first non-stipple mark, and all marks */
  tailFirst: number;
  nMarks: number;
  /** the non-stipple marks (mark `tailFirst + i` is row i) */
  tail: LensMarks;
  curves: LensCurveRef[];
  /** CURVE_IN words, per curve */
  curveIn: Uint32Array<ArrayBuffer>;
  curveInF: Float32Array;
  brawPoints: number;
  /** the longest curve in marks: the compact branch slots' point capacity */
  maxPts: number;
  /** warped drawings: anchor mark per drawing, k, and the instances' static table */
  vecMark: number[];
  lvecs: Uint32Array<ArrayBuffer>;
  nVec: number;
  quasarMark: number;
  nSlots: number;
  nQSlots: number;
  /** per class: first instance and capacity */
  cbase: number[];
  ccap: number[];
  totalInstances: number;
  /** scan blocks over the slots */
  blocks: number;
}

/** A class's capacity is a multiple of 8 instances (256-byte aligned ranges). */
const round8 = (n: number) => Math.max(8, Math.ceil(n / 8) * 8);

export function layoutLens(
  L: LensScene,
  nStipple: readonly number[],
  meta: DrawingsMeta,
): LensLayout {
  const stippleFirst: number[] = [];
  let n = 0;
  L.sources.forEach((_, i) => {
    stippleFirst.push(n);
    n += nStipple[i] ?? 0;
  });
  const tailFirst = n;
  const rows: { cls: number; src: number; b: [number, number]; inst?: Instance }[] = [];
  L.sources.forEach((s, si) => {
    for (const e of s.extras) rows.push({ cls: LensCls.core, src: si, b: e.b, inst: e.inst });
  });
  const vecMark: number[] = [];
  const vecK: number[] = [];
  L.sources.forEach((s, si) => {
    for (const v of s.vecs) {
      vecMark.push(tailFirst + rows.length);
      vecK.push(s.k);
      rows.push({ cls: MarkKind.vec, src: si, b: v.b });
    }
  });
  const curves: LensCurveRef[] = [];
  const curveSrc: number[] = [];
  let braw = 0;
  let maxPts = 8;
  const strokes = meta.strokes;
  L.sources.forEach((s, si) => {
    s.curves.forEach((c) => {
      curves.push({
        src: si,
        firstMark: tailFirst + rows.length,
        n: c.pts.length,
        brawFirst: braw,
      });
      curveSrc.push(si);
      braw += MAX_BRANCHES * c.pts.length;
      maxPts = Math.max(maxPts, c.pts.length);
      for (const p of c.pts) rows.push({ cls: MarkKind.curve, src: si, b: p });
    });
  });
  const quasarMark = L.quasar ? tailFirst + rows.length : -1;
  if (L.quasar) rows.push({ cls: MarkKind.quasar, src: 0, b: [0, 0] });
  const nMarks = tailFirst + rows.length;

  const tail = lensMarks(rows.length);
  rows.forEach((r, i) => {
    const o = i * LMARK_WORDS;
    tail.f[o] = f(r.b[0]);
    tail.f[o + 1] = f(r.b[1]);
    if (r.inst) {
      tail.u[o + 2] = r.inst.layer;
      tail.f[o + 3] = r.inst.alpha;
      tail.f.set(r.inst.m.map(f), o + 4);
    }
    tail.u[o + 8] = r.cls;
    tail.u[o + 9] = r.src;
  });

  // the curves' table
  const curveIn = new Uint32Array(Math.max(1, curves.length) * LCURVE_WORDS);
  const curveInF = new Float32Array(curveIn.buffer);
  let ci = 0;
  // every stroke's first piece in the pieces table, as `packPieces` lays it out
  const pieceCount = (strokes?.pieces ?? []).map((p) => p?.length ?? 0);
  const firstPiece: number[] = [];
  {
    let run = 0;
    for (const c of pieceCount) {
      firstPiece.push(run);
      run += c;
    }
  }
  L.sources.forEach((s) => {
    for (const c of s.curves) {
      const ref = curves[ci] as LensCurveRef;
      const o = ci * LCURVE_WORDS;
      const np = pieceCount[c.k] ?? 0;
      const pieces = np > 0 && !c.stretch;
      const T = L.solvers[s.solver];
      curveIn[o] = ref.firstMark;
      curveIn[o + 1] = ref.n;
      curveIn[o + 2] = ref.brawFirst;
      curveInF[o + 3] = f((T?.cell ?? 0) * 4);
      curveIn[o + 4] = c.k;
      curveIn[o + 5] = (c.stretch ? CurveFlag.stretch : 0) | (pieces ? CurveFlag.pieces : 0);
      curveInF[o + 6] = f(c.w);
      curveInF[o + 7] = f(c.a);
      curveInF[o + 8] = f(strokes?.thick[c.k] ?? 10);
      curveIn[o + 9] = firstPiece[c.k] ?? 0;
      curveIn[o + 10] = pieces ? np : 0;
      curveIn[o + 11] = pieces ? LENS_CAP_REPS : 0;
      ci++;
    }
  });

  const lvecs = new Uint32Array(Math.max(1, vecMark.length) * LVEC_WORDS);
  const lvF = new Float32Array(lvecs.buffer);
  vecMark.forEach((m, i) => {
    lvecs[i * LVEC_WORDS] = m;
    lvF[i * LVEC_WORDS + 1] = f(vecK[i] ?? 1);
  });

  // slots and output capacities
  const nSlots = nMarks * MAX_IMAGES;
  const nQSlots = L.quasar ? MAX_IMAGES * QUASAR_SLOTS : 0;
  const dens = L.sources.reduce((a, s) => a + s.dens, 0);
  const stippleTotal = nStipple.reduce((a, b) => a + b, 0);
  const coreMarks = rows.filter((r) => r.cls === LensCls.core).length;
  const dots = round8(Math.min(8 * stippleTotal, Math.ceil(0.575 * dens) + 2048));
  const nonDot = round8(8 * stippleTotal + MAX_IMAGES * QUASAR_KNOTS);
  const ccap: number[] = new Array<number>(LENS_CLASSES + 1).fill(8);
  ccap[LensCls.old] = dots;
  ccap[LensCls.disc] = round8(dots + MAX_IMAGES * (QUASAR_SLOTS - QUASAR_KNOTS));
  ccap[LensCls.young] = dots;
  ccap[LensCls.knot] = nonDot;
  ccap[LensCls.star] = round8(8 * stippleTotal);
  ccap[LensCls.rstar] = round8(8 * stippleTotal + MAX_IMAGES);
  ccap[LensCls.core] = round8(8 * coreMarks);
  const cbase: number[] = [];
  let total = 0;
  for (let c = 0; c <= LENS_CLASSES; c++) {
    cbase.push(total);
    total += ccap[c] ?? 8;
  }
  return {
    L,
    stippleFirst,
    nStipple: [...nStipple],
    tailFirst,
    nMarks,
    tail,
    curves,
    curveIn,
    curveInF,
    brawPoints: Math.max(1, braw),
    maxPts,
    vecMark,
    lvecs,
    nVec: vecMark.length,
    quasarMark,
    nSlots,
    nQSlots,
    cbase,
    ccap,
    totalInstances: total,
    blocks: Math.max(1, Math.ceil((nSlots + nQSlots) / 256)),
  };
}

// ---------------------------------------------------------------------------------------------
// The warped drawings

/** The lens's drawings as the vector expansion reads them (src/model/vectors.ts). */
export interface LensVectors {
  D: VectorDesc;
  /** warped drawings × 8 image slots, then the member galaxies */
  nWarped: number;
  nMembers: number;
}

/** Slots per instance, as `describeVectors` counts them. */
function slotsOf(lib: PackedVectors, d: number, warp: number) {
  const o = d * DRAWING_WORDS;
  return {
    caps: (warp !== WarpKind.none ? lib.table[o + 7] : lib.table[o + 1]) ?? 0,
    dots: lib.table[o + 3] ?? 0,
    blobs: lib.table[o + 5] ?? 0,
  };
}

export function lensVectors(
  Lo: LensLayout,
  meta: DrawingsMeta,
  P: Params,
): { V: LensVectors; inst: ArrayBuffer } {
  const lib = packedLibrary(meta.vectors);
  const rows: { row: Pick<VectorRow, 'atlas' | 'tile'> & Partial<VectorRow>; warp: number }[] = [];
  const L = Lo.L;
  for (const s of L.sources)
    for (const v of s.vecs) for (let j = 0; j < MAX_IMAGES; j++) rows.push({ row: v.row, warp: 2 });
  const nWarped = rows.length;
  for (const m of L.members) rows.push({ row: { atlas: 'whole', tile: m.tile }, warp: 0 });
  const drawings: number[] = [];
  const warps: number[] = [];
  const capFirst: number[] = [];
  const dotFirst: number[] = [];
  const blobFirst: number[] = [];
  let nCap = 0;
  let nDot = 0;
  let nBlob = 0;
  for (const r of rows) {
    const d = drawingOf(lib, r.row);
    drawings.push(d);
    warps.push(r.warp);
    capFirst.push(nCap);
    dotFirst.push(nDot);
    blobFirst.push(nBlob);
    const s = slotsOf(lib, d, r.warp);
    nCap += s.caps;
    nDot += s.dots;
    nBlob += s.blobs;
  }
  const pen = penWeights(P.pen);
  const D: VectorDesc = {
    lib,
    parts: { picks: NO_PICKS, wholeType: null, streams: [] },
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
    streamKeep: 1,
  };
  // the static fields of every instance; the kernel writes the warped ones' `w`, `w2` and `pad0`
  const inst = new ArrayBuffer(Math.max(1, rows.length) * 96);
  const fl = new Float32Array(inst);
  const u = new Uint32Array(inst);
  const vecRows: VectorRow[] = [];
  for (const s of L.sources) for (const v of s.vecs) vecRows.push(v.row);
  rows.forEach((_, i) => {
    const o = i * 24;
    const src = i < nWarped ? (vecRows[Math.floor(i / MAX_IMAGES)] as VectorRow) : undefined;
    if (src) {
      fl.set(src.m.map(f), o);
      fl[o + 4] = f(src.x);
      fl[o + 5] = f(src.y);
      fl[o + 6] = f(src.ps);
      fl[o + 7] = f(Math.sqrt(Math.abs(src.m[0] * src.m[3] - src.m[1] * src.m[2])));
      u[o + 21] = 1;
    }
    u[o + 16] = drawings[i] ?? 0;
    u[o + 17] = warps[i] ?? 0;
    u[o + 18] = capFirst[i] ?? 0;
    u[o + 19] = dotFirst[i] ?? 0;
    u[o + 20] = blobFirst[i] ?? 0;
  });
  return { V: { D, nWarped, nMembers: L.members.length }, inst };
}

/** The view's table of instances: the static one with this view's member galaxies written in. */
export function lensVectorView(
  V: LensVectors,
  inst: ArrayBuffer,
  members: readonly VectorRow[],
  P: Params,
  key: number,
  nDotPool: number,
): VectorView {
  const out = inst.slice(0);
  const fl = new Float32Array(out);
  const u = new Uint32Array(out);
  members.forEach((r, k) => {
    const o = (V.nWarped + k) * 24;
    fl.set(r.m.map(f), o);
    fl[o + 4] = f(r.x);
    fl[o + 5] = f(r.y);
    fl[o + 6] = f(r.ps);
    fl[o + 7] = f(Math.sqrt(Math.abs(r.m[0] * r.m[3] - r.m[1] * r.m[2])));
    u[o + 21] = 0;
  });
  const D = V.D;
  return {
    rows: members as VectorRow[],
    inst: out,
    nStreamSegs: 0,
    nStreamSlots: 0,
    streamSegs: new ArrayBuffer(32),
    uniform: {
      n_inst: D.nInst,
      n_cap_slots: D.nCapSlots,
      n_dots: D.nDots,
      n_blobs: D.nBlobs,
      n_stream_segs: 0,
      n_stream_slots: 0,
      key: key >>> 0,
      n_dot_pool: nDotPool,
      pen_line: f(D.penLine),
      wobble: wobbleAmplitude(P.distort),
      stream_keep: f(D.streamKeep),
      pen_dot: f(D.penDot),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The lensed curves as ribbons

/**
 * The ribbons' model for the lensed branches (src/model/ribbons.ts): `LENS_BRANCH_SLOTS` curves
 * of `maxPts` points each, the slots' points and `n` written by the gather, everything else (the
 * strokes' pieces, the pen, the sheet) the main galaxy's. The textured segments and the pieces
 * are expanded by the line-work's own kernels (compute/ribbons.wgsl `measure`, `expand`,
 * `place_pieces`); a branch shorter than its slot has no segments past its end.
 */
export function lensRibbonDesc(main: RibbonDesc, maxPts: number): RibbonDesc {
  const nSlots = LENS_BRANCH_SLOTS;
  const curveBuf = new ArrayBuffer(nSlots * 48);
  const cu = new Uint32Array(curveBuf);
  for (let k = 0; k < nSlots; k++) {
    cu[k * 12] = k * maxPts;
    cu[k * 12 + 7] = k * (maxPts - 1);
  }
  const maxNp = Math.max(0, ...main.strokePieces);
  return {
    ...main,
    curves: [],
    lanes: { ...main.lanes, hatches: [], pts: [], lines: [] },
    nPoints: nSlots * maxPts,
    points3: new Float32Array(4),
    nCurves: nSlots,
    curveBuf,
    nSegs: nSlots * (maxPts - 1),
    pieceCap: nSlots * LENS_CAP_REPS * maxNp,
    nHatch: 0,
    hatchBuf: new ArrayBuffer(48),
    nCaps: 0,
    nHDots: 0,
    nHBlobs: 0,
    laneFirst: 0,
    nLane: 0,
    carve: new Uint32Array(1),
    nCarve: 0,
  };
}

/** The lens's ink layers, grouped by where they go among the galaxy's own (src/render/stipple.ts). */
export interface LensLayers {
  /** the lensed curves' textured ribbons (line ink) */
  line: InkLayer[];
  /** their re-spaced pieces (young ink) */
  pieces: InkLayer[];
  /** the warped drawings and the member galaxies (line ink) */
  vectors: InkLayer[];
  /** the dots: old, disc, young */
  dots: InkLayer[];
  knots: InkLayer[];
  stars: InkLayer[];
  /** the drawn cores (old ink) */
  cores: InkLayer[];
}
