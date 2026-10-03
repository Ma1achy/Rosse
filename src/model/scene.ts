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
   * Draw with this hand (dot tiles) instead of the one makeVariation picks. The golden runner
   * passes the reference's own `VAR.dotPool`, recorded at capture, so that ink and pen weight are
   * compared with the same pen (tests/golden/README.md); the choice of hand is a discrete random
   * choice that the two engines make differently (ADR 0005).
   */
  hand?: readonly number[];
  /**
   * The key of the placement streams (the stipple), the seed by default. Re-keying keeps every
   * structural choice and re-draws the dots: the calibration of ADR 0013.
   */
  placementKey?: number;
}

export function buildScene(P: Params, meta: DrawingsMeta, opts: SceneOptions = {}): GalaxyScene {
  const variation = makeVariation(P, meta);
  if (opts.hand?.length) variation.dotPool = [...opts.hand];
  const galaxy = describeGalaxy(P, variation, meta);
  if (opts.placementKey !== undefined) galaxy.g.key = opts.placementKey >>> 0;
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
