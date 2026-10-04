/**
 * Ring knots and clumps (generate, app23.js:L282–297): small groups of marks placed after the
 * stipple. The scene description holds one entry per group (its centre, spread and how many
 * marks it has); the marks themselves are sampled on the GPU, one invocation each, by the
 * `extra` entry point of compute/stipple.wgsl (CPU twin `sampleExtra` in
 * src/fallback/kernels/stipple.ts), into the same sample buffer after the stipple, so they are
 * projected and compacted with it.
 *
 * - Ring knots (`ring` > 0.1, not a merger): round(6 + 10·ring) clusters on the ring, 5–12 marks
 *   each (half knots, half young dots), with a drawn star at the centre.
 * - Clumps (arms or `irr`, bulge < 0.9): one per `VAR.clumps` entry, on its arm (or scattered
 *   round the lopsided centre when irregular), `n` marks of which a quarter are knots, plus 1–4
 *   drawn stars with probability 0.85 when `starMix` > 0.01.
 *
 * Drawn stars are vector marks (`sstars`): classified and counted here, drawn in M5/M7. They are
 * not subject to the stipple's view culls, as in v21, where they are added after the loop.
 */
import type { Params } from '../core/params';
import { Draws } from '../core/rng';
import { Stream } from '../core/streams';
import { armPhaseCpu, type Vec3 } from './curves';
import type { Variation } from './variation';

export const GroupKind = { ringKnots: 0, clump: 1 } as const;

export interface MarkGroup {
  kind: number;
  /** the group's index within its kind: its marks' stream indices start at id · GROUP_STRIDE */
  id: number;
  /** centre, galaxy frame */
  c: Vec3;
  /** Gaussian spread of the marks in x and y */
  s: number;
  /** marks (knots and dots) */
  count: number;
  /** drawn stars after the marks */
  rstars: number;
}

/** Group-level draws (counts, centres): indices on the group's stream. Fixed forever. */
export const GROUP_INDEX = 1 << 24;
/** A group's marks use indices `group · GROUP_STRIDE + local` on the group's stream. */
export const GROUP_STRIDE = 256;

export function markGroups(P: Params, V: Variation): MarkGroup[] {
  const out: MarkGroup[] = [];
  if (P.ring > 0.1 && !P.merger) {
    const nkc = Math.round(6 + 10 * P.ring);
    for (let kc = 0; kc < nkc; kc++) {
      const r = new Draws(P.seed, Stream.ringKnots, GROUP_INDEX + kc);
      const tk = r.f32() * 6.2832;
      const Rk = P.ringR * (1 + r.gauss() * 0.02);
      const count = 5 + Math.floor(r.f32() * 8);
      out.push({
        kind: GroupKind.ringKnots,
        id: kc,
        c: [Rk * Math.cos(tk), Rk * Math.sin(tk), 0],
        s: 0.045,
        count,
        rstars: 1,
      });
    }
  }
  if ((P.arms >= 1 || P.irr > 0) && P.bulge < 0.9)
    V.clumps.forEach((cl, i) => {
      const k = i % Math.max(1, P.arms);
      const irr = P.irr > 0;
      const th0 = irr ? cl.t * 6.28 : armPhaseCpu(P, V, cl.R, k) + (2 * Math.PI * k) / P.arms;
      const cR = irr ? cl.R * 0.7 : cl.R;
      const c: Vec3 = [
        cR * Math.cos(th0) + (irr ? 0.5 * Math.cos(V.lopA) : 0),
        cR * Math.sin(th0) + (irr ? 0.5 * Math.sin(V.lopA) : 0),
        0,
      ];
      const r = new Draws(P.seed, Stream.clumps, GROUP_INDEX + i);
      let rstars = 0;
      if (P.starMix > 0.01 && r.f32() < 0.85)
        rstars = 1 + Math.floor(r.f32() * (1 + 3 * P.starMix));
      out.push({ kind: GroupKind.clump, id: i, c, s: cl.s, count: cl.n, rstars });
    });
  return out;
}
