/**
 * Per-galaxy variation: the seeded irregularities scaled by `vary`, and the choice of "one hand"
 * (a pool of dot and knot drawings) per galaxy. Equivalent of `makeVariation` (app23.js:L96–119).
 *
 * The rules are the reference's; the random numbers are the counter-based ones (ADR 0004). The
 * reference draws everything from one sequential stream, so changing `arms` shifts every later
 * field (the pools, `lop`, `warp`, `strokeSeed`). Here each group of fields has its own index on
 * the `variation` stream (below), so changing the number of arms changes the arms and spurs only.
 *
 * Every number is rounded to f32 here, once, because the WebGPU and CPU engines both read this
 * description as f32 (ADR 0011).
 */
import { Draws } from '../core/rng';
import { Stream } from '../core/streams';
import type { Params } from '../core/params';
import type { StrokesMeta } from '../marks/strokes';
import type { VectorLibrary, VectorSheet } from '../marks/vector';

const f = Math.fround;

/** Indices on the `variation` stream, one per group of fields. Fixed forever (ADR 0004). */
export const VariationIndex = {
  spurs: 1,
  clumps: 2,
  dust: 3,
  hand: 4,
  knotPool: 5,
  misc: 6,
  /** arm k uses index `arms + k` */
  arms: 100,
} as const;

/** What makeVariation needs to know about the drawings. */
export interface DrawingsMeta {
  dots: { src: readonly string[]; size: readonly number[] };
  knots: { count: number };
  stars: { count: number };
  cores: { kind: readonly string[]; style: readonly string[] };
  /** the strokes sheet (M4): without it no curves are drawn */
  strokes?: StrokesMeta;
  /** the pen lines of the dust hatching and carving (M4): without them no hatches */
  penlines?: VectorSheet;
  /** every vector sheet (M5): without them no drawn parts */
  vectors?: Partial<VectorLibrary>;
}

export interface ArmVariation {
  pitch: number;
  amp: number;
  phase: number;
  rmax: number;
  wig: number;
  wf: number;
  wp: number;
}

export interface Spur {
  k: number;
  R0: number;
  len: number;
  pk: number;
}

export interface Clump {
  R: number;
  t: number;
  s: number;
  n: number;
}

export interface DustPatch {
  R: number;
  th: number;
  s: number;
}

export interface Variation {
  arms: ArmVariation[];
  spurs: Spur[];
  clumps: Clump[];
  dust: DustPatch[];
  lop: number;
  lopA: number;
  warp: number;
  warpA: number;
  /** dot tiles of this galaxy's hand */
  dotPool: number[];
  /** the source drawings the hand was chosen from */
  hand: string[];
  /** 24 knot tiles, drawn with replacement */
  knotPool: number[];
  spike: number;
  strokeSeed: number;
}

/** Source drawings whose median dot size is at least 7 and which have at least 8 dots. */
export function readableSources(dots: DrawingsMeta['dots']): string[] {
  const bySrc = new Map<string, number[]>();
  dots.src.forEach((s, i) => {
    let a = bySrc.get(s);
    if (!a) bySrc.set(s, (a = []));
    a.push(dots.size[i] ?? 0);
  });
  // insertion order, as the reference's Object.keys(bySrc)
  const ok = [...bySrc].filter(([, a]) => {
    const sorted = a.slice().sort((p, q) => p - q);
    return (sorted[Math.floor(sorted.length / 2)] ?? 0) >= 7 && sorted.length >= 8;
  });
  return (ok.length ? ok : [...bySrc]).map(([s]) => s);
}

export function makeVariation(P: Params, meta: DrawingsMeta): Variation {
  const v = P.vary;
  const at = (index: number) => new Draws(P.seed, Stream.variation, index);
  const nArms = Math.max(1, P.arms);

  const arms: ArmVariation[] = [];
  for (let k = 0; k < nArms; k++) {
    const r = at(VariationIndex.arms + k);
    arms.push({
      pitch: f(1 + 0.28 * v * r.gauss()),
      amp: f(1 - 0.55 * v * r.f32()),
      phase: f(0.35 * v * r.gauss()),
      rmax: f(2.1 + 0.6 * r.f32()),
      wig: f(0.3 * v * r.f32()),
      wf: f(1.5 + 3 * r.f32()),
      wp: f(r.f32() * 6.28),
    });
  }

  const rs = at(VariationIndex.spurs);
  const spurs: Spur[] = [];
  const ns = Math.round(v * (2 + rs.f32() * 4) * Math.min(1, P.arms));
  for (let i = 0; i < ns; i++)
    spurs.push({
      k: Math.floor(rs.f32() * Math.max(1, P.arms)),
      R0: f(0.8 + 1.6 * rs.f32()),
      len: f(0.5 + 0.9 * rs.f32()),
      pk: f(1.7 + 0.8 * rs.f32()),
    });

  const rc = at(VariationIndex.clumps);
  const clumps: Clump[] = [];
  const nc = Math.round(v * (4 + rc.f32() * 10) * (1 + 2 * P.patchy));
  for (let j = 0; j < nc; j++)
    clumps.push({
      R: f(0.7 + 2.2 * rc.f32()),
      t: f(rc.f32()),
      s: f(0.05 + 0.08 * rc.f32()),
      n: 20 + Math.floor(60 * rc.f32()),
    });

  const rd = at(VariationIndex.dust);
  const dust: DustPatch[] = [];
  const nd = Math.round(v * rd.f32() * 5);
  for (let d = 0; d < nd; d++)
    dust.push({ R: f(0.8 + 2 * rd.f32()), th: f(rd.f32() * 6.28), s: f(0.18 + 0.3 * rd.f32()) });

  // a pen for this galaxy: dots from a few of the drawings only, so each galaxy has one hand
  const rh = at(VariationIndex.hand);
  const srcs = readableSources(meta.dots);
  const pickN = 1 + Math.floor(rh.f32() * 3);
  const chosen = new Set<string>();
  for (let c = 0; c < pickN; c++) {
    const s = srcs[Math.floor(rh.f32() * srcs.length)];
    if (s !== undefined) chosen.add(s);
  }
  let dotPool: number[] = [];
  meta.dots.src.forEach((s, i) => {
    if (chosen.has(s) || v < 0.15) dotPool.push(i);
  });
  if (dotPool.length < 12) dotPool = meta.dots.src.map((_, i) => i);

  const rk = at(VariationIndex.knotPool);
  const knotPool: number[] = [];
  for (let q = 0; q < 24; q++) knotPool.push(Math.floor(rk.f32() * meta.knots.count));

  const rm = at(VariationIndex.misc);
  const spike = f((rm.f32() - 0.5) * 0.5);
  const lop = f(v * (0.22 + 0.7 * P.patchy) * (0.5 + 0.5 * rm.f32()));
  const lopA = f(rm.f32() * 6.28);
  const warp = f(v * 0.35 * rm.f32());
  const warpA = f(rm.f32() * 6.28);
  const strokeSeed = Math.floor(rm.f32() * 1e6);

  return {
    arms,
    spurs,
    clumps,
    dust,
    lop,
    lopA,
    warp,
    warpA,
    dotPool,
    hand: [...chosen],
    knotPool,
    spike,
    strokeSeed,
  };
}

/**
 * The reference's `dotSprite(t, k)` (app23.js:L81): the quad size, in plate units, that draws a dot
 * of measured size `size` at a readable diameter. The dot fills about 1/40 of its cell, so the
 * quad is about 40/size times the dot.
 */
export function dotSprite(size: number, penDot: number, k = 1): number {
  const ds = Math.max(4, size);
  const want = Math.min(3.4, Math.max(1.9, 1.9 + 0.045 * ds)) * penDot * k;
  return (want * 40) / ds;
}

/** The reference's pen weights (render(), app23.js:L1227): `PEN.line` and `PEN.dot`. */
export function penWeights(pen: number): { line: number; dot: number } {
  return { line: pen, dot: 0.75 + 0.1 * pen };
}
