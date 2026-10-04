/**
 * Part placement: which whole drawings go where (the reference's `parts(r)`, app23.js:L987–1086).
 *
 * M2 places the drawn core only, because it is a bitmap and part of the plain disc galaxies the
 * milestone's goldens cover (`Disc, no arms`: bulge 0.4). Everything else in `parts` arrives with
 * the vector marks (M5): envelopes, whole drawings, drawn arms, bars, rings, the nuclear spiral,
 * arcs, shells, tails, trails, the sky, hatching, arrows, bubbles, jets and streams.
 */
import type { Params } from '../core/params';
import { incE } from '../view/camera';
import type { Instance } from '../marks/instance';
import { PLATE, UNIT_SCALE, type Camera } from '../view/camera';
import { smWarp, wobbleAmplitude } from '../view/warp';
import type { DrawingsMeta } from './variation';

/**
 * The drawn core (app23.js:L1028–1033): for a bulge between 0.03 and 0.97, not a Sérsic galaxy,
 * and not edge-on past 80°. The core drawing is picked by bulge strength among the `core` kind,
 * preferring the dotted style for stipple-heavy or steep views, scaled by bulge size and flattened
 * by max(bulgeFlat, cos incl), at alpha 0.9.
 */
export function coreInstances(P: Params, meta: DrawingsMeta, cam: Camera): Instance[] {
  const e = incE(cam.incl);
  if (!(P.bulge > 0.03 && P.bulge < 0.97) || (P.sersicN > 0 && P.bulge >= 0.95) || e >= 80)
    return [];
  const n = meta.cores.kind.filter((k) => k === 'core').length;
  if (n < 1) return [];
  const wantS = (P.stipple > 0.5 && P.lines < 0.5) || e > 70 ? 'dotted' : 'line';
  let idx = Math.min(n - 1, Math.floor(Math.pow(P.bulge, 0.6) * n));
  for (let k = 0; k < n; k++) {
    const j = (idx + k) % n;
    if (meta.cores.style[j] === wantS) {
      idx = j;
      break;
    }
  }
  const sc = UNIT_SCALE * cam.zoom;
  const s = sc * (0.32 + 0.8 * P.bulgeSize * Math.sqrt(P.bulge));
  const ci = Math.cos((cam.incl * Math.PI) / 180);
  const a = (cam.pa * Math.PI) / 180;
  const sy = s * Math.max(P.bulgeFlat, ci);
  // chain(Rm(pa), Sm(s, sy))
  const c = Math.cos(a);
  const sn = Math.sin(a);
  // a bitmap mark's centre goes through the hand wobble (inst, app23.js:L171)
  const [x, y] = smWarp(PLATE / 2, PLATE / 2, wobbleAmplitude(P.distort));
  return [{ x, y, layer: idx, alpha: 0.9, m: [c * s, sn * s, -sn * sy, c * sy] }];
}
