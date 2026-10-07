/**
 * A picture's hand as the kernels that make marks outside the stipple read it (the merger's debris,
 * the shell galaxy's satellite): the knot pool (24 tiles) then the dot pool, and the size of each
 * dot tile's quad at k = 1 (`dotSprite`, app23.js:L81), as `describeGalaxy` packs them.
 */
import type { Params } from '../core/params';
import { KNOT_POOL } from './galaxy';
import { dotSprite, penWeights, type DrawingsMeta, type Variation } from './variation';

export interface HandArrays {
  pool: Uint32Array<ArrayBuffer>;
  dotBase: Float32Array<ArrayBuffer>;
}

export function handArrays(P: Params, variation: Variation, meta: DrawingsMeta): HandArrays {
  const pool = new Uint32Array(KNOT_POOL + variation.dotPool.length);
  pool.set(variation.knotPool.slice(0, KNOT_POOL), 0);
  pool.set(variation.dotPool, KNOT_POOL);
  const penDot = penWeights(P.pen).dot;
  const dotBase = new Float32Array(meta.dots.size.map((s) => dotSprite(s, penDot, 1)));
  return { pool, dotBase };
}
