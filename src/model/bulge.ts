/**
 * The natural bulge (ADR 0076). v21 draws every bulge as one Hernquist sphere, flattened by
 * `bulgeFlat`: a classical bulge and a disc-like pseudo-bulge come out alike. `bulgeAuto` (0 in
 * `DEF`, so the core, the goldens and the vectors stay v21's; 1 on the page) draws it from a
 * Sérsic law instead, deprojected to 3D (Prugniel and Simien 1997), whose index `n` follows the
 * galaxy: steep and centrally concentrated for a big round bulge (n up to 4, the de Vaucouleurs
 * law), shallow and nearly exponential for a small or flat one (n down to 1, a pseudo-bulge).
 * An explicit `sersicN` always wins. The 3D half-mass radius stays the Hernquist one, (1 + √2)·a
 * (1.35 times the projected half-light radius `BULGE_RE`, whatever the index), so the bulge keeps
 * its size and only its profile changes.
 *
 * It reads only the model's parameters, so an orbit or a zoom leaves the model alone (ADR 0010).
 */
import type { Params } from '../core/params';

/**
 * The projected half-light radius of the Sérsic bulge, in units of the Hernquist scale `a`:
 * (1 + √2) / 1.35. The kernels carry the same number (1.788).
 */
export const BULGE_RE = (1 + Math.SQRT2) / 1.35;

/** The Sérsic index of the bulge for a parameter set (not used when `bulgeAuto` is off). */
export function bulgeIndex(P: Params): number {
  const n =
    P.sersicN > 0
      ? P.sersicN
      : 1 +
        3 * Math.sqrt(Math.max(0, Math.min(1, P.bulge))) * Math.max(0, Math.min(1, P.bulgeFlat));
  return Math.max(0.7, Math.min(6, n));
}

/** The Prugniel–Simien density slope `p` of a deprojected Sérsic law of index `n`. */
export function psSlope(n: number): number {
  return 1 - 0.6097 / n + 0.05463 / (n * n);
}

/** The Sérsic `b` for the deprojected law (Lima Neto et al. 1999). */
export function psB(n: number): number {
  return 2 * n - 1 / 3 + 0.009876 / n;
}

/** Whether the bulge of a parameter set is drawn from the Sérsic law (a smooth galaxy has its own). */
export function bulgeIsSersic(P: Params): boolean {
  return P.bulgeAuto > 0 && !(P.sersicN > 0 && P.bulge >= 0.95);
}
