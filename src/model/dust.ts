/**
 * The natural dust of a galaxy (ADR 0075). v21 has one dust parameter, `dust`, 0 unless a preset
 * or `fromVotes` raises it: a galaxy with no dust set has none. A real disc galaxy has a thin dust
 * layer almost always, with a face-on optical depth through the centre of about a third; seen
 * edge-on, the same layer is the dark midplane lane and dims the bulge behind it. Ellipticals have
 * almost none.
 *
 * `dustAuto` (0 in `DEF`, so the core, the goldens and the vectors stay v21's; 1 on the page) asks
 * for that layer: `effectiveDust` is `max(dust, naturalDust)`, so an explicit dust above the
 * natural one still wins. It is the one value every reader of `P.dust` takes: the galaxy uniform
 * (`g.dust`, which the stipple's carving, the optical-depth cull and the overlay stars read), the
 * edge-on curves' stroke and the whole-drawing type. It reads only the model's parameters, never
 * the camera, so an orbit or a zoom leaves the model alone (ADR 0010).
 *
 * The model is v21's own smooth slab (`dustTau`, src/fallback/kernels/project.ts). Not modelled:
 * dust that follows the arms in clumps, and the dust of the deep-field galaxies.
 */
import type { Params } from '../core/params';

/**
 * The dust of a spiral with a small bulge. Face-on the optical depth through the centre is
 * `dustTau` = 9 · dust · 0.12 = 1.08 · dust, so 0.36 gives about 0.35 before the bulge's share is
 * taken off; it is also above the 0.3 at which v21 carves the edge-on lane (app23.js:L227–228).
 */
export const DUST_SPIRAL = 0.36;
/** A disc with no arms (a lenticular, a ringed disc): half the dust of a spiral. */
export const DUST_LENTICULAR = DUST_SPIRAL * 0.5;
/** An irregular galaxy: a little, and patchy rather than in a layer. */
export const DUST_IRREGULAR = 0.2;
/** A bulge takes this share of the dust away at bulge 1 (a big bulge is a dust-poor spheroid). */
export const DUST_BULGE_SHARE = 0.5;
/** From this bulge (or with a Sérsic profile) a galaxy is an elliptical: the disc is not drawn. */
export const SMOOTH_BULGE = 0.95;

/**
 * Whether the galaxy is a smooth spheroid, as the engine draws it: a bulge that leaves no disc
 * (`describeGalaxy`: the Sérsic profile and the end of the arms are at 0.95 and 0.98) or a Sérsic
 * index.
 */
export function isSmooth(P: Params): boolean {
  return P.sersicN > 0 || P.bulge >= SMOOTH_BULGE;
}

/** The dust a galaxy of this kind carries by nature: 0 for a star, an artefact or an elliptical. */
export function naturalDust(P: Params): number {
  if (P.subject !== 'galaxy' || isSmooth(P)) return 0;
  const base = P.irr > 0.5 ? DUST_IRREGULAR : P.arms >= 1 ? DUST_SPIRAL : DUST_LENTICULAR;
  return base * (1 - DUST_BULGE_SHARE * Math.min(1, Math.max(0, P.bulge)));
}

/** The dust the engine uses: `P.dust` as v21 has it, or with the natural layer as its floor. */
export function effectiveDust(P: Params): number {
  return P.dustAuto ? Math.max(P.dust, naturalDust(P)) : P.dust;
}
