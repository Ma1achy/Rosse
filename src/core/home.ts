/**
 * Explicit home orientations (ADR 0050, open question Q3 option b).
 *
 * v21 fixes lensed sources (and overlays) in 3D at the camera it had when it first saw the lens
 * key (`homeFor`, app23.js:L445), so the same parameters render differently depending on how the
 * page was navigated. Here the orientation is saved with the drawing: a render is a pure function
 * of its parameters and these homes. `Params` mirrors v21's `DEF` key for key (a tested
 * invariant), so the homes are a sibling record, stored and shared with the parameters.
 */
import type { Params } from './params';

/** The orientation lensed sources are fixed at: v21's `{ incl, az, w }` of `LHOME` (pa is unused). */
export interface LensHome {
  /** inclination, degrees */
  incl: number;
  /** azimuth (orbit about the axis), degrees */
  az: number;
  /** winding, 1 or −1 */
  w: number;
}

/** The homes a drawing saves with its parameters. */
export interface Homes {
  lens?: LensHome;
}

/**
 * The home a lens preset gets when it is chosen: the camera the preset shows. This is what v21's
 * `homeFor` would remember on first sight of a lens from a fresh page, which is how the reference
 * captures were made.
 */
export function lensHomeOf(P: Pick<Params, 'incl' | 'az' | 'winding'>): LensHome {
  return { incl: P.incl, az: P.az || 0, w: P.winding };
}
