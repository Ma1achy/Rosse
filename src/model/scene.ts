/**
 * The scene description of one galaxy (ADR 0003), shared by both engines: parameters, variation,
 * the stipple model's description, and the placed parts. Built on the CPU in microseconds.
 *
 * Layer order follows the reference's `scene()` (app23.js:L1289–1301): stroke ribbons, the
 * vector drawings (hatching and placed parts: lines, dots, blobs), pieces, the stipple by
 * population (old, disc, young), the streams' dots and knots, knots, sparkle stars, then cores.
 */
import type { Params } from '../core/params';
import type { AtlasName } from '../marks/atlas';
import type { Pop } from '../render/plates';
import { Cls } from './classes';
import type { StrokesMeta } from '../marks/strokes';
import type { VectorLibrary, VectorSheet } from '../marks/vector';
import type { PartPicks } from './parts';
import { describeVectors, type VectorDesc } from './vectors';
import type { CurvePicks } from './curves';
import { packNoise, type NoiseTable } from '../core/noise';
import { describeGalaxy, type GalaxyDesc } from './galaxy';
import { describeRibbons, type RibbonDesc } from './ribbons';
import { makeVariation, type DrawingsMeta, type Variation } from './variation';

export interface GalaxyScene {
  P: Params;
  variation: Variation;
  galaxy: GalaxyDesc;
  /** the line-work (M4): curves, dust lanes, carving lines, hatches */
  ribbons: RibbonDesc;
  /** the placed vector drawings (M5): the parts' picks and their slots */
  vectors: VectorDesc;
  meta: DrawingsMeta;
}

export interface SceneOptions {
  /**
   * Draw with this variation instead of the one makeVariation picks. The golden runner passes
   * v21's own (replayed offline from v21's stream, tests/golden/compare/v21.ts), so that both
   * engines draw the same galaxy with the same pens and only the dots differ (ADR 0015): the
   * variation's choices are discrete random choices the two engines make differently (ADR 0005).
   */
  variation?: Variation;
  /**
   * Draw curves with these stroke choices (src/model/curves.ts `CurvePicks`). The golden runner
   * passes v21's own, from v21's `curves()` (tests/golden/compare/v21-curves.ts): which
   * stroke draws an arm, and which spurs are drawn, are discrete random choices too.
   */
  curvePicks?: CurvePicks;
  /**
   * Place the parts with these picks (src/model/parts.ts `PartPicks`): which envelope, whole
   * drawing, arms, bar, ring… and their spins. The golden runner passes v21's own, replayed from
   * v21's parts stream (tests/golden/compare/v21-parts.ts, ADR 0021).
   */
  partPicks?: PartPicks;
  /**
   * The key of the placement streams (the stipple), the seed by default. Re-keying keeps every
   * structural choice and re-draws the dots: the calibration of ADR 0013 and 0015.
   */
  placementKey?: number;
  /**
   * Draw with these noise tables in place of the lattice's hashed corners (src/core/noise.ts): the
   * golden runner passes v21's own corners (tests/golden/compare/v21-noise.ts), so flocculence,
   * patchiness, the lanes' gaps and the hand wobble follow v21's pattern, as the variation does.
   */
  noise?: NoiseTable[];
  /** Calibration only (negative controls, ADR 0015): a truncation radius in place of RMAX. */
  rmax?: number;
  /** Calibration only (negative controls): every dot's quad scaled by this. */
  dotScale?: number;
}

export function buildScene(P: Params, meta: DrawingsMeta, opts: SceneOptions = {}): GalaxyScene {
  const variation = opts.variation ?? makeVariation(P, meta);
  const galaxy = describeGalaxy(P, variation, meta);
  if (opts.noise) galaxy.noise = packNoise(opts.noise);
  if (opts.placementKey !== undefined) galaxy.g.key = opts.placementKey >>> 0;
  if (opts.rmax !== undefined) galaxy.g.rmax = Math.fround(opts.rmax);
  if (opts.dotScale !== undefined)
    galaxy.dotBase = galaxy.dotBase.map((x) => Math.fround(x * (opts.dotScale ?? 1)));
  const ribbons = describeRibbons(
    P,
    variation,
    meta.strokes,
    meta.penlines,
    P.incl,
    opts.curvePicks,
    galaxy.noise,
  );
  const vectors = describeVectors(P, variation, meta, P.incl, opts.partPicks);
  return { P, variation, galaxy, ribbons, vectors, meta };
}

/**
 * The stipple classes that are drawn, in draw order, with their atlas (after the line-work). The
 * streams' dots and knots (old ink) go after `young` (scene(), app23.js:L1295). `pop` is the
 * population the colour plate inks the layer as (L1295–1296: knots as HII, sparkle stars as young).
 */
export const STIPPLE_LAYERS: readonly { cls: number; atlas: AtlasName; name: string; pop: Pop }[] =
  [
    { cls: Cls.old, atlas: 'dots', name: 'old', pop: 'old' },
    { cls: Cls.disc, atlas: 'dots', name: 'disc', pop: 'disc' },
    { cls: Cls.young, atlas: 'dots', name: 'young', pop: 'young' },
    { cls: Cls.knot, atlas: 'knots', name: 'knots', pop: 'hii' },
    { cls: Cls.star, atlas: 'stars', name: 'stars', pop: 'young' },
  ];

/** Mark counts, comparable with the reference's `__GEN.stats()` (app23.js:L1302). */
export interface MarkCounts {
  dots: number;
  knots: number;
  stars: number;
  rstars: number;
  /** curves (`STATS.curves`, the length of `curves()`), when the line-work is known */
  curves?: number;
  /** re-spaced pieces and textured ribbon segments drawn (no v21 statistic) */
  pieces?: number;
  ribbonSegments?: number;
  /** dust hatches (pen-line drawings) */
  hatches?: number;
  /** placed vector drawings (parts), and the capsules, dots and blobs they expand to (M5) */
  drawings?: number;
  vectorCaps?: number;
  vectorDots?: number;
  vectorBlobs?: number;
  /** the streams' dots and knots */
  streamDots?: number;
  streamKnots?: number;
  /** source drawings used (`STATS.used`, app23.js:L1302), where the engine can tell */
  used?: number;
  /** per population, for the colour plates and debugging */
  old: number;
  disc: number;
  young: number;
}

export function markCounts(perClass: ArrayLike<number>): MarkCounts {
  const c = (k: number) => perClass[k] ?? 0;
  return {
    dots: c(Cls.old) + c(Cls.disc) + c(Cls.young),
    knots: c(Cls.knot),
    stars: c(Cls.star),
    rstars: c(Cls.rstar),
    old: c(Cls.old),
    disc: c(Cls.disc),
    young: c(Cls.young),
  };
}

/** What makeVariation and the parts need from the drawings' metadata (assets-built/index.json). */
export function drawingsMeta(
  atlases: {
    dots: { meta: Record<string, unknown[]> };
    knots: { layers: number; meta?: Record<string, unknown[]> };
    stars: { layers: number; meta?: Record<string, unknown[]> };
    cores: { meta: Record<string, unknown[]> };
    strokes?: { meta: Record<string, unknown[]>; levels: { width: number; height: number }[] };
  },
  penlines?: VectorSheet,
  vectors?: Partial<VectorLibrary>,
): DrawingsMeta {
  const s = atlases.strokes;
  const strokes: StrokesMeta | undefined = s
    ? {
        kind: s.meta.kind as string[],
        thick: s.meta.thick as number[],
        pieces: s.meta.pieces as (number[][] | null)[],
        src: s.meta.src as string[],
        w: s.levels[0]?.width ?? 512,
        h: s.levels[0]?.height ?? 64,
      }
    : undefined;
  return {
    ...(strokes ? { strokes } : {}),
    ...(penlines ? { penlines } : {}),
    ...(vectors ? { vectors } : {}),
    dots: {
      src: atlases.dots.meta.src as string[],
      size: atlases.dots.meta.size as number[],
    },
    knots: {
      count: atlases.knots.layers,
      ...(atlases.knots.meta?.src ? { src: atlases.knots.meta.src as string[] } : {}),
    },
    stars: {
      count: atlases.stars.layers,
      ...(atlases.stars.meta?.src ? { src: atlases.stars.meta.src as string[] } : {}),
    },
    cores: {
      ...(atlases.cores.meta.src ? { src: atlases.cores.meta.src as string[] } : {}),
      kind: atlases.cores.meta.kind as string[],
      style: atlases.cores.meta.style as string[],
    },
  };
}
