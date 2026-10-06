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
import { Cls } from './classes';
import type { StrokesMeta } from '../marks/strokes';
import type { VectorLibrary, VectorSheet } from '../marks/vector';
import type { PartPicks } from './parts';
import { describeVectors, packedLibrary, type VectorDesc } from './vectors';
import type { CurvePicks } from './curves';
import { packNoise, type NoiseTable } from '../core/noise';
import { describeGalaxy, rstarBound, type GalaxyDesc } from './galaxy';
import { sheetStrides, type DynSpec } from './dynvec';
import { describeStars, starSlotCapacity, type StarPicks, type StarsDesc } from './stars';
import { describeSky, type SkyCatalogue, type SkyDesc } from './sky';
import { cameraOf, orientationOf, type Orientation } from '../view/camera';
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
  /** the drawn stars' rows (M7): their capacity and the slots each owns (src/model/dynvec.ts) */
  rstars: DynSpec;
  /** a star or an artefact, and the overlays (M7); null when the parameters draw none */
  stars: StarsDesc | null;
  /** the deep field, the foreground stars and the companions (M7); null when there are none */
  sky: SkyDesc | null;
  /** the most mark slots the stars' marks can take (at the largest zoom): buffer sizes */
  starSlots: number;
  /**
   * The home orientation of the overlays (open question Q3, option b): the camera they were placed
   * at, which the camera then moves round. v21 remembers it from navigation history (`homeFor`);
   * here it is a parameter, by default the camera of the parameters the scene is built from.
   */
  home: Orientation;
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
  /**
   * Draw the stars and artefacts with these choices (src/model/stars.ts `StarPicks`): the golden
   * runner passes v21's own, replayed from `starSprites` (tests/golden/compare/v21-stars.ts).
   */
  starPicks?: StarPicks;
  /**
   * Draw this sky catalogue (src/model/sky.ts): the golden runner passes v21's own, replayed from
   * `buildSky` and `skyParts` (tests/golden/compare/v21-sky.ts).
   */
  sky?: SkyCatalogue;
  /**
   * The overlays' home orientation (the camera they are placed at). The default is the
   * orientation of the parameters, which pins an overlay to the plate: a page that orbits passes
   * the orientation of the preset it started from, and the golden runner the capture's home.
   */
  home?: Orientation;
  /** Calibration only (negative controls, ADR 0015): a truncation radius in place of RMAX. */
  rmax?: number;
  /** Calibration only (negative controls): every dot's quad scaled by this. */
  dotScale?: number;
}

/**
 * A star or an artefact has no galaxy (render(), app23.js:L1229–1230: `generate` and `curves` are
 * not called, and the galaxy's own parts are emptied): the parameters of everything a galaxy
 * draws, off. The sky, the trails, cosmic rays, the arrow, the jet and the streams stay.
 */
export function withoutGalaxy(P: Params): Params {
  return {
    ...P,
    stars: 0,
    arms: 0,
    irr: 0,
    ring: 0,
    bar: 0,
    bulge: 0,
    sersicN: 0,
    lines: 0,
    dust: 0,
    dustLines: 0,
    dustScribble: 0,
    outline: 0,
    tail: 0,
    lens: 0,
    shells: 0,
    shellsOn: 0,
    envelope: 0,
    whole: 0,
    nuclear: 0,
    bubbles: 0,
    merger: 0,
    lensOn: 0,
    companions: P.companions,
  };
}

export function buildScene(P0: Params, meta: DrawingsMeta, opts: SceneOptions = {}): GalaxyScene {
  const P = P0;
  const Pg = P.subject === 'galaxy' ? P : withoutGalaxy(P);
  const variation = opts.variation ?? makeVariation(P, meta);
  const galaxy = describeGalaxy(Pg, variation, meta);
  if (opts.noise) galaxy.noise = packNoise(opts.noise);
  if (opts.placementKey !== undefined) galaxy.g.key = opts.placementKey >>> 0;
  if (opts.rmax !== undefined) galaxy.g.rmax = Math.fround(opts.rmax);
  if (opts.dotScale !== undefined)
    galaxy.dotBase = galaxy.dotBase.map((x) => Math.fround(x * (opts.dotScale ?? 1)));
  const ribbons = describeRibbons(
    Pg,
    variation,
    meta.strokes,
    meta.penlines,
    P.incl,
    opts.curvePicks,
    galaxy.noise,
  );
  const lib = packedLibrary(meta.vectors);
  const sky = describeSky(P, meta, lib, meta.fgstars?.count ?? 0, galaxy.g.key, opts.sky);
  const vectors = describeVectors(
    Pg,
    variation,
    meta,
    P.incl,
    opts.partPicks,
    sky?.catalogue.companions,
  );
  const stars = describeStars(P, variation, meta, opts.starPicks, galaxy.g.key);
  const home = opts.home ?? orientationOf(cameraOf(P));
  const strides = sheetStrides(vectors.lib, ['sstars']);
  const rstars: DynSpec = {
    rows:
      strides.strideCaps + strides.strideDots + strides.strideBlobs
        ? rstarBound(galaxy) + (stars?.nDrawn ?? 0)
        : 0,
    ...strides,
  };
  return {
    P,
    variation,
    galaxy,
    ribbons,
    vectors,
    meta,
    rstars,
    stars,
    sky,
    starSlots: stars ? starSlotCapacity(stars, P, home) : 0,
    home,
  };
}

/**
 * The stipple classes that are drawn, in draw order, with their atlas (after the line-work). The
 * streams' dots and knots (old ink) go after `young` (scene(), app23.js:L1295).
 */
export const STIPPLE_LAYERS: readonly { cls: number; atlas: AtlasName; name: string }[] = [
  { cls: Cls.old, atlas: 'dots', name: 'old' },
  { cls: Cls.disc, atlas: 'dots', name: 'disc' },
  { cls: Cls.young, atlas: 'dots', name: 'young' },
  { cls: Cls.knot, atlas: 'knots', name: 'knots' },
  { cls: Cls.star, atlas: 'stars', name: 'stars' },
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
  /** the capsules of the drawn stars (M7) */
  starCaps?: number;
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
    fgstars?: { layers: number };
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
    ...(atlases.fgstars ? { fgstars: { count: atlases.fgstars.layers } } : {}),
    cores: {
      ...(atlases.cores.meta.src ? { src: atlases.cores.meta.src as string[] } : {}),
      kind: atlases.cores.meta.kind as string[],
      style: atlases.cores.meta.style as string[],
    },
  };
}
