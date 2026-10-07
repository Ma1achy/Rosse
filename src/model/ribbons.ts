/**
 * The line-work of one galaxy as the GPU reads it (ADR 0003): curves (./curves.ts), dust lanes,
 * carving lines and hatches (./lanes.ts), packed into small buffers in the model tier, f32 once.
 * compute/ribbons.wgsl and its CPU twin (src/fallback/kernels/ribbons.ts) project, measure and
 * expand them in the view tier.
 *
 * Every 3D point the view tier projects is in one array (`points3`), in this order: the curves'
 * control points, the lane points, the carving lines' points, then each hatch's two anchors. One
 * projection pass serves the ribbons, the pieces, the hatches and the stipple's dust culls.
 */
import type { Params } from '../core/params';
import { packNoise, type NoiseField } from '../core/noise';
import type { StructLayout } from '../marks/instance';
import type { StrokesMeta } from '../marks/strokes';
import type { VectorSheet } from '../marks/vector';
import { ZOOM_MAX, UNIT_SCALE, type Camera } from '../view/camera';
import { wobbleAmplitude } from '../view/warp';
import { curves, edgeOnAlpha, type Curve, type CurvePicks, type Vec3 } from './curves';
import { dustLanes, type DustLanes, type DustPicks } from './lanes';
import { penWeights, type Variation } from './variation';

const f = Math.fround;

/** Curve flags. */
export const CurveFlag = { taper: 1, stretch: 2, pieces: 4, edgeAlpha: 8 } as const;

const u32Layout = (
  name: string,
  size: number,
  align: number,
  fields: readonly (readonly [string, string])[],
) => ({
  name,
  size,
  align,
  fields: fields.map(([n, type], i) => ({
    name: n,
    type: type as 'u32' | 'f32',
    offset: i * 4,
    size: 4,
  })),
});

/** One curve: the `Curve` struct of ribbons.wgsl. */
export const CURVE_LAYOUT: StructLayout = u32Layout('Curve', 48, 4, [
  ['first', 'u32'],
  ['n', 'u32'],
  ['layer', 'u32'],
  ['flags', 'u32'],
  ['w', 'f32'],
  ['a', 'f32'],
  ['thick', 'f32'],
  ['seg_first', 'u32'],
  ['piece_first', 'u32'],
  ['piece_n', 'u32'],
  ['cap_reps', 'u32'],
  ['slot_first', 'u32'],
]);
export const CURVE_WORDS = CURVE_LAYOUT.size / 4;

/** A curve measured in the view tier: the `CurveState` struct of ribbons.wgsl. */
export const CURVE_STATE_LAYOUT: StructLayout = u32Layout('CurveState', 32, 4, [
  ['tot', 'f32'],
  ['cw', 'f32'],
  ['kpx', 'f32'],
  ['reps', 'u32'],
  ['base', 'u32'],
  ['alpha', 'f32'],
  ['pad0', 'u32'],
  ['pad1', 'u32'],
]);
export const CURVE_STATE_WORDS = CURVE_STATE_LAYOUT.size / 4;

/** One hatch: the `Hatch` struct of ribbons.wgsl (./lanes.ts `Hatch`). */
export const HATCH_LAYOUT: StructLayout = u32Layout('Hatch', 48, 4, [
  ['a', 'u32'],
  ['b', 'u32'],
  ['tile', 'u32'],
  ['cap_first', 'u32'],
  ['dot_first', 'u32'],
  ['blob_first', 'u32'],
  ['off_n', 'f32'],
  ['off_y', 'f32'],
  ['off_f', 'f32'],
  ['len', 'f32'],
  ['cos_d', 'f32'],
  ['sin_d', 'f32'],
]);
export const HATCH_WORDS = HATCH_LAYOUT.size / 4;

/** The `Rib` uniform's fields, in order (ribbons.wgsl). */
const RIB_FIELDS = [
  ['n_points', 'u32'],
  ['n_curves', 'u32'],
  ['n_segs', 'u32'],
  ['piece_cap', 'u32'],
  ['n_hatch', 'u32'],
  ['n_caps', 'u32'],
  ['n_hdots', 'u32'],
  ['n_hblobs', 'u32'],
  ['pen_line', 'f32'],
  ['wobble', 'f32'],
  ['zoom', 'f32'],
  ['edge_alpha', 'f32'],
  ['sheet_w', 'f32'],
  ['sheet_h', 'f32'],
  ['n_dot_pool', 'u32'],
  ['pad0', 'u32'],
] as const;

/** The `Rib` uniform of ribbons.wgsl: counts of the model tier, and the view's numbers. */
export const RIB_LAYOUT: StructLayout = u32Layout('Rib', 64, 4, RIB_FIELDS);

/** The `Rib` uniform's values by field, typed from its layout (`ribUniform`). */
export type RibUniform = { [K in (typeof RIB_FIELDS)[number][0]]: number };

/** A textured ribbon segment, written by `expand`: the `RibbonSeg` struct (plate units). */
export const RIBBON_SEG_LAYOUT: StructLayout = {
  name: 'RibbonSeg',
  size: 48,
  align: 16,
  fields: [
    { name: 'a', type: 'vec4<f32>', offset: 0, size: 16 },
    { name: 'b', type: 'vec4<f32>', offset: 16, size: 16 },
    { name: 'u', type: 'vec2<f32>', offset: 32, size: 8 },
    { name: 'layer', type: 'u32', offset: 40, size: 4 },
    { name: 'alpha', type: 'f32', offset: 44, size: 4 },
  ],
};
export const RIBBON_SEG_WORDS = RIBBON_SEG_LAYOUT.size / 4;

/** A pen-line capsule, written by `hatch_caps`: the `Capsule` struct (plate units). */
export const CAPSULE_LAYOUT: StructLayout = {
  name: 'Capsule',
  size: 32,
  align: 8,
  fields: [
    { name: 'a', type: 'vec2<f32>', offset: 0, size: 8 },
    { name: 'b', type: 'vec2<f32>', offset: 8, size: 8 },
    { name: 'w', type: 'f32', offset: 16, size: 4 },
    { name: 'alpha', type: 'f32', offset: 20, size: 4 },
    { name: 'pad0', type: 'f32', offset: 24, size: 4 },
    { name: 'pad1', type: 'f32', offset: 28, size: 4 },
  ],
};
export const CAPSULE_WORDS = CAPSULE_LAYOUT.size / 4;

/** A vector sheet as GPU tables: per drawing [seg_first, seg_n, dot_first, dot_n, blob_first, blob_n, 0, 0]. */
export interface PackedPen {
  table: Uint32Array<ArrayBuffer>;
  /** per segment (ax, ay, bx, by), tile units */
  segs: Float32Array<ArrayBuffer>;
  /** per dot (x, y, r, hash): hash = |round(997x + 131y)| (expandVector, app23.js:L1215) */
  dots: Float32Array<ArrayBuffer>;
  /** per blob (cx, cy, rx, ry), (cos θ, sin θ, hash, 0): hash = |round(991 cx)| (L1217) */
  blobs: Float32Array<ArrayBuffer>;
}

export function packPen(sheet: VectorSheet | undefined): PackedPen {
  const recs = sheet?.vec ?? [];
  const table = new Uint32Array(Math.max(1, recs.length) * 8);
  const segs: number[] = [];
  const dots: number[] = [];
  const blobs: number[] = [];
  recs.forEach((r, i) => {
    const o = i * 8;
    table[o] = segs.length / 4;
    for (const fl of r.l)
      for (let k = 2; k < fl.length; k += 2)
        segs.push(fl[k - 2] ?? 0, fl[k - 1] ?? 0, fl[k] ?? 0, fl[k + 1] ?? 0);
    table[o + 1] = segs.length / 4 - (table[o] ?? 0);
    table[o + 2] = dots.length / 4;
    for (const d of r.d) {
      const x = d[0] ?? 0;
      const y = d[1] ?? 0;
      dots.push(x, y, d[2] ?? 0, Math.abs(Math.round(x * 997 + y * 131)));
    }
    table[o + 3] = r.d.length;
    table[o + 4] = blobs.length / 8;
    for (const b of r.b) {
      const t = b[4] ?? 0;
      blobs.push(
        b[0] ?? 0,
        b[1] ?? 0,
        b[2] ?? 0,
        b[3] ?? 0,
        Math.cos(t),
        Math.sin(t),
        Math.abs(Math.round((b[0] ?? 0) * 991)),
        0,
      );
    }
    table[o + 5] = r.b.length;
  });
  const pad = (a: number[], n: number) => (a.length ? a : new Array<number>(n).fill(0));
  return {
    table,
    segs: new Float32Array(pad(segs, 4)),
    dots: new Float32Array(pad(dots, 4)),
    blobs: new Float32Array(pad(blobs, 8)),
  };
}

/** Every stroke's pieces in one table, (x, y, size, tile) each; per row, its first piece and count. */
export function packPieces(strokes: StrokesMeta | undefined): {
  table: Float32Array<ArrayBuffer>;
  first: number[];
  count: number[];
} {
  const out: number[] = [];
  const first: number[] = [];
  const count: number[] = [];
  (strokes?.pieces ?? []).forEach((pcs) => {
    first.push(out.length / 4);
    count.push(pcs?.length ?? 0);
    for (const pc of pcs ?? []) out.push(pc[0] ?? 0, pc[1] ?? 0, pc[2] ?? 0, pc[3] ?? 0);
  });
  return { table: new Float32Array(out.length ? out : [0, 0, 0, 0]), first, count };
}

export interface RibbonDesc {
  curves: Curve[];
  lanes: DustLanes;
  nPoints: number;
  /** 4 floats per point (x, y, z, 0), galaxy frame */
  points3: Float32Array<ArrayBuffer>;
  nCurves: number;
  curveBuf: ArrayBuffer;
  /** textured segments, and the pieces' slot capacity at the largest zoom */
  nSegs: number;
  pieceCap: number;
  pieces: Float32Array<ArrayBuffer>;
  nHatch: number;
  hatchBuf: ArrayBuffer;
  nCaps: number;
  nHDots: number;
  nHBlobs: number;
  pen: PackedPen;
  /** lane points in points3, and the carving segments' first points */
  laneFirst: number;
  nLane: number;
  carve: Uint32Array<ArrayBuffer>;
  nCarve: number;
  /** v21's LR at zoom 1, the carving width (px) and probabilities */
  laneR: number;
  carveW: number;
  carveP: number;
  /** `lines`, for the edge-on stroke's alpha */
  lines: number;
  penLine: number;
  sheetW: number;
  sheetH: number;
  /** pieces of the strokes sheet, per row (the lens sizes its branch slots from them, M9) */
  strokePieces: number[];
  /** the scene's noise field (the wobble of ribbons, pieces and hatches) */
  noise: NoiseField;
}

/** The model tier's line-work for a galaxy at an inclination (only its `incE` bucket matters). */
export function describeRibbons(
  P: Params,
  V: Variation,
  strokes: StrokesMeta | undefined,
  penlines: VectorSheet | undefined,
  incl: number,
  picks?: CurvePicks,
  noise: NoiseField = packNoise(),
  key: number = P.seed,
  dustPicks?: DustPicks,
  /** more curves, drawn with these (a shell galaxy's arcs, M8) */
  extra: readonly Curve[] = [],
): RibbonDesc {
  const C = [...curves(P, V, strokes, incl, picks, noise), ...extra];
  const lanes = dustLanes(P, V, penlines, incl, noise, key, dustPicks);
  const pen = packPen(penlines);
  const pcs = packPieces(strokes);
  const penLine = penWeights(P.pen).line;
  const sheetW = strokes?.w ?? 512;
  const sheetH = strokes?.h ?? 64;

  const pts: Vec3[] = [];
  const curveBuf = new ArrayBuffer(Math.max(1, C.length) * CURVE_LAYOUT.size);
  const cu = new Uint32Array(curveBuf);
  const cf = new Float32Array(curveBuf);
  let nSegs = 0;
  let pieceCap = 0;
  C.forEach((c, i) => {
    const o = i * CURVE_WORDS;
    const thick = strokes?.thick[c.k] ?? 10;
    const np = pcs.count[c.k] ?? 0;
    const pieces = np > 0 && !c.stretch;
    // the pieces' slots: enough repeats for the curve's 3D length at the largest zoom (a
    // projection never lengthens a curve), plus a margin for rounding
    let L3 = 0;
    for (let j = 1; j < c.pts.length; j++) {
      const a = c.pts[j - 1] ?? [0, 0, 0];
      const b = c.pts[j] ?? [0, 0, 0];
      L3 += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    }
    const cw = Math.max(6, Math.min(90, (penLine * c.w * sheetH) / thick));
    const pat = sheetW * (cw / sheetH);
    const capReps = pieces ? Math.floor((L3 * UNIT_SCALE * ZOOM_MAX) / (pat * 1.4)) + 2 : 0;
    cu[o] = pts.length;
    cu[o + 1] = c.pts.length;
    cu[o + 2] = c.k;
    cu[o + 3] =
      (c.taper ? CurveFlag.taper : 0) |
      (c.stretch ? CurveFlag.stretch : 0) |
      (pieces ? CurveFlag.pieces : 0) |
      (c.edgeAlpha ? CurveFlag.edgeAlpha : 0);
    cf[o + 4] = f(c.w);
    cf[o + 5] = f(c.a);
    cf[o + 6] = f(thick);
    cu[o + 7] = nSegs;
    cu[o + 8] = pcs.first[c.k] ?? 0;
    cu[o + 9] = pieces ? np : 0;
    cu[o + 10] = capReps;
    cu[o + 11] = pieceCap;
    if (!pieces) nSegs += Math.max(0, c.pts.length - 1);
    else pieceCap += capReps * np;
    pts.push(...c.pts);
  });

  const laneFirst = pts.length;
  pts.push(...lanes.pts);
  const carve: number[] = [];
  for (const line of lanes.lines) {
    const first = pts.length;
    for (let j = 0; j + 1 < line.length; j++) carve.push(first + j);
    pts.push(...line);
  }

  const hatchBuf = new ArrayBuffer(Math.max(1, lanes.hatches.length) * HATCH_LAYOUT.size);
  const hu = new Uint32Array(hatchBuf);
  const hf = new Float32Array(hatchBuf);
  let nCaps = 0;
  let nHDots = 0;
  let nHBlobs = 0;
  lanes.hatches.forEach((h, i) => {
    const o = i * HATCH_WORDS;
    hu[o] = pts.length;
    hu[o + 1] = pts.length + 1;
    pts.push(h.a, h.b);
    hu[o + 2] = h.tile;
    hu[o + 3] = nCaps;
    hu[o + 4] = nHDots;
    hu[o + 5] = nHBlobs;
    hf[o + 6] = f(h.offN);
    hf[o + 7] = f(h.offY);
    hf[o + 8] = f(h.offF);
    hf[o + 9] = f(h.len);
    hf[o + 10] = f(Math.cos(h.dAng));
    hf[o + 11] = f(Math.sin(h.dAng));
    const t = h.tile * 8;
    nCaps += pen.table[t + 1] ?? 0;
    nHDots += pen.table[t + 3] ?? 0;
    nHBlobs += pen.table[t + 5] ?? 0;
  });

  const points3 = new Float32Array(Math.max(1, pts.length) * 4);
  pts.forEach((p, i) => {
    points3.set([p[0], p[1], p[2], 0], i * 4);
  });
  return {
    curves: C,
    lanes,
    nPoints: pts.length,
    points3,
    nCurves: C.length,
    curveBuf,
    nSegs,
    pieceCap,
    pieces: pcs.table,
    nHatch: lanes.hatches.length,
    hatchBuf,
    nCaps,
    nHDots,
    nHBlobs,
    pen,
    laneFirst,
    nLane: lanes.pts.length,
    carve: new Uint32Array(carve.length ? carve : [0]),
    nCarve: carve.length,
    laneR: lanes.laneR,
    carveW: 4 + 5 * P.dustLines,
    carveP: 0.9 * P.dustLines,
    lines: P.lines,
    penLine,
    sheetW,
    sheetH,
    strokePieces: pcs.count,
    noise,
  };
}

/** Whether the stipple has view culls besides the dust's optical depth: lanes or carving lines. */
export function hasDustCulls(R: RibbonDesc): boolean {
  return R.nLane > 0 || R.nCarve > 0;
}

/** The `Rib` uniform for a view. */
export function ribUniform(R: RibbonDesc, cam: Camera, P: Params, nDotPool: number): RibUniform {
  return {
    n_points: R.nPoints,
    n_curves: R.nCurves,
    n_segs: R.nSegs,
    piece_cap: R.pieceCap,
    n_hatch: R.nHatch,
    n_caps: R.nCaps,
    n_hdots: R.nHDots,
    n_hblobs: R.nHBlobs,
    pen_line: f(R.penLine),
    wobble: wobbleAmplitude(P.distort),
    zoom: f(cam.zoom),
    // v21 parity: the edge-on stroke's alpha is lines·(incl − 72)/18 from the RAW inclination
    // (app23.js:L788), continuous and asymmetric about 90° (1.5·lines at 99°, 0.5·lines at 81°,
    // one incE bucket), so it is a view-tier number; whether the stroke exists is the bucket's
    edge_alpha: f(edgeOnAlpha(R.lines, cam.incl)),
    sheet_w: R.sheetW,
    sheet_h: R.sheetH,
    n_dot_pool: nDotPool,
    pad0: 0,
  };
}

/** The stipple's dust culls for a view (project.wgsl `Culls`), without the points. */
export function cullsUniform(R: RibbonDesc | null, cam: Camera, P: Params, key: number) {
  const lr = R ? f(R.laneR * cam.zoom) : 0;
  const cw = R ? f(R.carveW) : 0;
  return {
    key: key >>> 0,
    n_lane: R?.nLane ?? 0,
    lane_first: R?.laneFirst ?? 0,
    n_carve: R?.nCarve ?? 0,
    lane_r2: f(lr * lr),
    lane_p: f(0.7),
    carve_w2: f(cw * cw),
    carve_p: R ? f(R.carveP) : 0,
    wobble: wobbleAmplitude(P.distort),
    pad0: 0,
    pad1: 0,
    pad2: 0,
  };
}
