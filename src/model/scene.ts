/**
 * The scene description of one galaxy (ADR 0003), shared by both engines: parameters, variation,
 * the stipple model's description, and the placed parts. Built on the CPU in microseconds.
 *
 * Layer order follows the reference's `scene()` (app23.js:L1289–1301) for what M2 draws:
 * stipple by population (old, disc, young), knots, sparkle stars, then cores.
 */
import type { Params } from '../core/params';
import type { AtlasName } from '../marks/atlas';
import { Cls } from './classes';
import { describeGalaxy, type GalaxyDesc } from './galaxy';
import { makeVariation, type DrawingsMeta, type Variation } from './variation';

export interface GalaxyScene {
  P: Params;
  variation: Variation;
  galaxy: GalaxyDesc;
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
   * The key of the placement streams (the stipple), the seed by default. Re-keying keeps every
   * structural choice and re-draws the dots: the calibration of ADR 0013 and 0015.
   */
  placementKey?: number;
  /** Calibration only (negative controls, ADR 0015): a truncation radius in place of RMAX. */
  rmax?: number;
  /** Calibration only (negative controls): every dot's quad scaled by this. */
  dotScale?: number;
}

export function buildScene(P: Params, meta: DrawingsMeta, opts: SceneOptions = {}): GalaxyScene {
  const variation = opts.variation ?? makeVariation(P, meta);
  const galaxy = describeGalaxy(P, variation, meta);
  if (opts.placementKey !== undefined) galaxy.g.key = opts.placementKey >>> 0;
  if (opts.rmax !== undefined) galaxy.g.rmax = Math.fround(opts.rmax);
  if (opts.dotScale !== undefined)
    galaxy.dotBase = galaxy.dotBase.map((x) => Math.fround(x * (opts.dotScale ?? 1)));
  return { P, variation, galaxy, meta };
}

/** The stipple classes that are drawn, in draw order, with their atlas. */
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
export function drawingsMeta(atlases: {
  dots: { meta: Record<string, unknown[]> };
  knots: { layers: number };
  stars: { layers: number };
  cores: { meta: Record<string, unknown[]> };
}): DrawingsMeta {
  return {
    dots: {
      src: atlases.dots.meta.src as string[],
      size: atlases.dots.meta.size as number[],
    },
    knots: { count: atlases.knots.layers },
    stars: { count: atlases.stars.layers },
    cores: {
      kind: atlases.cores.meta.kind as string[],
      style: atlases.cores.meta.style as string[],
    },
  };
}
