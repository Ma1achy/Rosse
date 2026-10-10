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
import { describeVectors, packedLibrary, type VectorDesc } from './vectors';
import type { CurvePicks } from './curves';
import type { RingKnotPick } from './clumps';
import type { DustPicks } from './lanes';
import { packNoise, type NoiseTable } from '../core/noise';
import { describeGalaxy, rstarBound, type GalaxyDesc } from './galaxy';
import { sheetStrides, type DynSpec } from './dynvec';
import { describeStars, starSlotCapacity, type StarPicks, type StarsDesc } from './stars';
import { describeSky, type SkyCatalogue, type SkyDesc } from './sky';
import { cameraOf, orientationOf, structuralIncl, type Orientation } from '../view/camera';
import { describeRibbons, type RibbonDesc } from './ribbons';
import { describeLens, type LensOptions, type LensScene } from '../sim/lens';
import { makeVariation, type DrawingsMeta, type Variation } from './variation';
import type { MergerSceneOptions } from './merger';
import type { ShellSceneOptions } from './shells';

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
  /** the lensed scene (M9): the sources behind the lens, their curves and drawn parts */
  lens?: LensScene;
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
   * The key of the placement streams, the seed by default: the stipple, ring knots and clumps, and
   * the dust lanes' own draws (each hatch's offset, angle, length and pen line, and which pen
   * lines carve the stipple). Re-keying keeps every structural choice and re-draws the marks: the
   * re-draws of ADR 0013, 0015 and 0018.
   */
  placementKey?: number;
  /**
   * Draw the dust lanes' hatches and carving lines with these choices (src/model/lanes.ts
   * `DustPicks`); the golden runner passes v21's own (ADR 0018).
   */
  dustPicks?: DustPicks;
  /** Place the ring-knot clusters as given (src/model/clumps.ts); the golden runner passes v21's. */
  ringKnotPicks?: RingKnotPick[];
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
  /**
   * The lens (M9): the orientation the sources are fixed at (`home`, saved with the drawing, ADR
   * 0050) and, for the golden runner, v21's own discrete choices (`picks`, ADR 0051).
   */
  lens?: LensOptions;
  /**
   * A merging galaxy (M8): which of the two (0 or 1). Its vector drawings are carried by that
   * galaxy's tides (`WarpKind.tide`); the bitmap marks and ribbons are carried after the kernels
   * (src/render/tide.ts, src/fallback/stipple.ts), which the engines know from their own setup.
   */
  tide?: 0 | 1;
  /**
   * A merger (`P.merger`, M8): the draws the picture is made with: v21's, replayed, in the goldens
   * (src/model/merger.ts `MergerSceneOptions`). Read by the merger engines, not by `buildScene`.
   */
  merger?: MergerSceneOptions;
  /** the simulated shells (`P.shellsOn`, M8): v21's stroke rows for the arcs, replayed in the goldens */
  shells?: ShellSceneOptions;
  /**
   * The sky host of a merger (render(), app23.js:L1232–1234): the main parameters' own sky, trails,
   * arrow and overlays without a galaxy, though the sky still shears round the merger's mass.
   */
  skyHost?: boolean;
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
    dustAuto: 0,
    bulgeAuto: 0,
    starsAuto: 0,
    occlAuto: 0,
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
  const Pg = P.subject === 'galaxy' && !opts.skyHost ? P : withoutGalaxy(P);
  const variation = opts.variation ?? makeVariation(P, meta);
  const key = (opts.placementKey ?? P.seed) >>> 0;
  const galaxy = describeGalaxy(Pg, variation, meta, {
    key,
    ...(opts.ringKnotPicks ? { ringKnots: opts.ringKnotPicks } : {}),
  });
  if (opts.noise) galaxy.noise = packNoise(opts.noise);
  if (opts.rmax !== undefined) galaxy.g.rmax = Math.fround(opts.rmax);
  if (opts.dotScale !== undefined)
    galaxy.dotBase = galaxy.dotBase.map((x) => Math.fround(x * (opts.dotScale ?? 1)));
  const ribbons = describeRibbons(
    Pg,
    variation,
    meta.strokes,
    meta.penlines,
    structuralIncl(P),
    opts.curvePicks,
    galaxy.noise,
    key,
    opts.dustPicks,
  );
  const lib = packedLibrary(meta.vectors);
  const sky = describeSky(P, meta, lib, meta.fgstars?.count ?? 0, galaxy.g.key, opts.sky);
  const vectors = describeVectors(
    Pg,
    variation,
    meta,
    structuralIncl(P),
    opts.partPicks,
    sky?.catalogue.companions,
    opts.tide,
    opts.tide !== undefined ? ribbons.lanes.hatches.map((h) => h.tile) : undefined,
  );
  // a merging galaxy's hatching goes through the vector drawings (densified under the tides, torn
  // piece by piece); the line-work keeps its lanes and curves
  if (opts.tide !== undefined) {
    ribbons.nCaps = 0;
    ribbons.nHDots = 0;
    ribbons.nHBlobs = 0;
  }
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
  // a merger's lens is M8's; a lensed star or artefact has none (the lens needs a galaxy)
  const lens =
    P.lensOn && !P.merger && P.subject === 'galaxy'
      ? describeLens(P, meta, buildScene, {
          ...opts.lens,
          ...(opts.placementKey === undefined ? {} : { placementKey: opts.placementKey }),
        })
      : undefined;
  return {
    // a sky host (a merger's own sky and overlays) has no galaxy: its parameters are the galaxyless
    // ones, so nothing draws a drawn core, a nuclear spiral or the like at its plate centre
    P: opts.skyHost ? Pg : P,
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
    ...(lens ? { lens } : {}),
  };
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
    fgstars?: { layers: number; meta?: Record<string, unknown[]> };
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
    ...(atlases.fgstars
      ? {
          fgstars: {
            count: atlases.fgstars.layers,
            ...(atlases.fgstars.meta?.src ? { src: atlases.fgstars.meta.src as string[] } : {}),
          },
        }
      : {}),
    cores: {
      ...(atlases.cores.meta.src ? { src: atlases.cores.meta.src as string[] } : {}),
      kind: atlases.cores.meta.kind as string[],
      style: atlases.cores.meta.style as string[],
    },
  };
}
