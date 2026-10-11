/**
 * Dust as data (ADR 0003, 0010): the hatched dust lanes (`dustLanes`, app23.js:L944–985), the pen
 * lines that carve the stipple (`dustLines`, `DL`, app23.js:L199–220) and the hatching drawn
 * along the lanes (`parts`, app23.js:L1047–1050), all in the galaxy frame.
 *
 * In v21 all of this is computed in screen space: the lanes are projected as they are made, and
 * the stipple under them is culled from inside the sequential stream, so orbiting re-rolls the
 * stipple (reference notes 20.1). Here the model tier keeps 3D anchor points and each hatch's own
 * random numbers (offsets in plate px at zoom 1, angle jitter, length); the view tier projects
 * them and lays out the hatches, and the stipple's lane and carving culls are pure filters on
 * per-sample uniforms (compute/project.wgsl). Which hatches exist does not depend on the camera
 * (the lanes' noise is evaluated in the galaxy frame), only on the `incE` bucket: past 74° the
 * lanes become one hatched midplane, past 72° the carving lines lie along the midplane. Those
 * midplane lines are in screen space (x along the roll axis), so their length does not shrink with
 * the azimuth (ADR 0073).
 */
import type { Params } from '../core/params';
import { NoiseSalt, vnoise, type NoiseField } from '../core/noise';
import { Draws } from '../core/rng';
import { Stream } from '../core/streams';
import { lineParam, longestLine, type VectorSheet } from '../marks/vector';
import { incE } from '../view/camera';
import { armPhaseCpu, frac, type Vec3 } from './curves';
import type { Variation } from './variation';

/**
 * One hatch: a pen line laid along a lane. In the view tier, with q = project(a) and the unit
 * direction d0 of project(b) − q:
 * - the angle is d0 turned by `dAng`;
 * - the centre is q + n(d0)·offN·zoom + (0, offY·zoom) + d·offF·zoom, where n(d0) is d0's normal
 *   and d the final direction;
 * - the drawing is `tile` of `penlines`, scaled (len·zoom, 0.28·len·zoom), at pen scale 0.38.
 */
export interface Hatch {
  a: Vec3;
  b: Vec3;
  offN: number;
  offY: number;
  offF: number;
  dAng: number;
  len: number;
  tile: number;
  /** `a` and `b` are screen-space offsets (see `Curve.screen`, ADR 0073), not galaxy-frame points */
  screen?: boolean;
}

export interface DustLanes {
  hatches: Hatch[];
  /** the lane points the stipple is thinned near (v21's `pts`) */
  pts: Vec3[];
  /** v21's LR at zoom 1: disc samples within this many plate px of a lane point are thinned */
  laneR: number;
  /** the carving lines (`DL`), galaxy frame */
  lines: Vec3[][];
  /** the lane points (`pts`) are screen-space offsets: the edge-on midplane (ADR 0073) */
  screenPts: boolean;
  /** the carving lines are screen-space offsets: past 72° (ADR 0073) */
  screenLines: boolean;
}

/** Indices on the `dust` stream. Fixed forever (ADR 0004). */
export const DustIndex = {
  /** edge-on row r, step s: `edge + 1000 r + s` */
  edge: 0,
  ring: 3000,
  /** arm k, step s: `arms + 1000 k + s` */
  arms: 4000,
  /** carving line li: `lines + li` */
  lines: 900,
  /**
   * Retired (M4 review): hatch h's drawing was `tiles + h`, so a change of `dustScribble` or `ring`
   * re-rolled every later hatch's pen line. Each hatch now draws its pen line from its own step's
   * stream, after its other numbers. Never reuse.
   */
  tiles: 100000,
} as const;

/**
 * The lanes' discrete random choices, given rather than drawn (ADR 0018): the golden runner passes
 * v21's own (tests/golden/compare/v21-curves.ts `v21DustPicks`), as it does the strokes, so that
 * the comparison's hatches and carving lines are v21's and only the dots differ.
 */
export interface DustPicks {
  /**
   * The numbers of v21's lane stream (`mulberry32(seed·733 + 29)`), in the order dustLanes uses
   * them: each uniform as drawn, each Gaussian as `gauss(r)` returned it. The engine's loops draw
   * in v21's order (row, ring, arm steps; offset, angle, length, feather), so they line up.
   */
  lane: number[];
  /** each hatch's pen line, in the order the hatches are made (v21's `rrL`) */
  tiles: number[];
  /** each carving line's pen line (v21's `rd`) */
  lines: number[];
}

/** The random numbers of one lane step. */
interface StepDraws {
  f32(): number;
  gauss(): number;
}

/** A given sequence of numbers (`DustPicks.lane`), drawn in order whatever the step. */
class Sequence implements StepDraws {
  private i = 0;
  constructor(private readonly xs: readonly number[]) {}
  private next(): number {
    const x = this.xs[this.i++];
    if (x === undefined) throw new Error('dust picks: the lane sequence ran out');
    return x;
  }
  f32(): number {
    return this.next();
  }
  gauss(): number {
    return this.next();
  }
}

/** The hatching's pen scale (app23.js:L1048). */
export const HATCH_PEN = 0.38;
/** The hatching's flattening (app23.js:L1048). */
export const HATCH_FLAT = 0.28;

/**
 * `key`: the key of the lanes' draws, the placement key (the seed by default), so that a re-draw
 * (ADR 0013, 0018) re-draws the hatches' offsets, angles, lengths and pen lines with the dots,
 * and keeps which hatches the noise lays down. `picks`: v21's choices instead (ADR 0018).
 */
export function dustLanes(
  P: Params,
  V: Variation,
  penlines: VectorSheet | undefined,
  incl: number,
  field?: NoiseField | null,
  key: number = P.seed,
  picks?: DustPicks,
): DustLanes {
  const hatches: Hatch[] = [];
  const pts: Vec3[] = [];
  const e = incE(incl);
  const seq = picks ? new Sequence(picks.lane) : null;
  const step = (index: number): StepDraws => seq ?? new Draws(key >>> 0, Stream.dust, index);
  // each hatch's pen line (app23.js:L1048): v21's, or drawn from the step's own stream after its
  // other numbers, so that a hatch's drawing does not depend on how many hatches came before it
  const nPen = penlines?.n ?? 0;
  let made = 0;
  const pen = (r: StepDraws): number => {
    if (!nPen) return 0;
    if (picks) {
      const t = picks.tiles[made++];
      if (t === undefined) throw new Error('dust picks: fewer pen lines than hatches');
      return Math.min(nPen - 1, t);
    }
    return Math.min(nPen - 1, Math.floor(r.f32() * nPen));
  };
  if ((P.dustScribble > 0.02 || P.ring > 0.1) && P.bulge < 0.9 && !P.merger && !P.irr) {
    const keep = 0.3 + 0.55 * Math.max(P.dustScribble, P.ring > 0.1 ? 0.5 : 0);
    if (e > 74) {
      // the edge-on midplane: three rows of hatches, thickest at the centre
      for (let row = 0; row < 3; row++) {
        const zo = (row - 1) * 0.022;
        let s = 0;
        for (let x = -2.8; x <= 2.8; x += 0.055, s++) {
          const dens = Math.exp(-Math.abs(x) / 1.5);
          const n = vnoise(
            x * 1.9 + frac(P.seed * 0.1),
            row * 3.1,
            P.seed,
            NoiseSalt.laneEdge,
            field,
          );
          // screen space (ADR 0073): x along the roll axis, y down; the row offset is the z of
          // the galaxy frame seen edge-on (Y = -z), so the rows keep their spacing at every azimuth
          const a: Vec3 = [x, -zo, 0];
          if (row === 1) pts.push(a);
          if (n > keep * (0.4 + 0.8 * dens)) continue;
          const r = step(DustIndex.edge + 1000 * row + s);
          if (r.f32() > 0.85) continue;
          const offY = r.gauss() * 1.2;
          const dAng = r.gauss() * 0.08;
          const len = (10 + 9 * r.f32()) * (0.6 + 0.6 * dens);
          hatches.push({
            a,
            b: [x + 0.1, -zo, 0],
            offN: 0,
            offY,
            offF: 0,
            dAng,
            len,
            tile: pen(r),
            screen: true,
          });
        }
      }
    }
    if (P.ring > 0.1 && e <= 74) {
      // a hatched dust lane just inside the ring
      let s = 0;
      for (let tr0 = 0; tr0 < 6.2832; tr0 += 0.07, s++) {
        const Rr = P.ringR * 0.9;
        const nr = vnoise(
          Math.cos(tr0) * 2.6 + 11,
          Math.sin(tr0) * 2.6 + frac(P.seed * 0.01),
          P.seed,
          NoiseSalt.laneRing,
          field,
        );
        if (nr > keep * 1.05) continue;
        const a: Vec3 = [Rr * Math.cos(tr0), Rr * Math.sin(tr0), 0];
        pts.push(a);
        const r = step(DustIndex.ring + s);
        const dAng = r.gauss() * 0.08;
        const len = 9 + 8 * r.f32();
        hatches.push({
          a,
          b: [Rr * Math.cos(tr0 + 0.05), Rr * Math.sin(tr0 + 0.05), 0],
          offN: 0,
          offY: 0,
          offF: 0,
          dAng,
          len,
          tile: pen(r),
        });
      }
    }
    if (e <= 74 && P.arms >= 1) {
      // along the inner, trailing edge of each arm, patchy, with the odd feather
      const lx = V.lop * Math.cos(V.lopA) * 0.35;
      const ly = V.lop * Math.sin(V.lopA) * 0.35;
      for (let k = 0; k < P.arms; k++) {
        const va = V.arms[k % V.arms.length];
        const Rend = (va ? va.rmax : 2.1) * 0.95;
        const off = (2 * Math.PI * k) / P.arms;
        let s = 0;
        for (let R = 0.45; R <= Rend; R += 0.035 + 0.02 * R, s++) {
          const th = armPhaseCpu(P, V, R, k) + off - (0.12 + 0.04 * Math.sin(R * 3 + k));
          const a: Vec3 = [R * Math.cos(th) + lx * R, R * Math.sin(th) + ly * R, 0];
          const R2 = R + 0.05;
          const th2 = armPhaseCpu(P, V, R2, k) + off - (0.12 + 0.04 * Math.sin(R2 * 3 + k));
          const b: Vec3 = [R2 * Math.cos(th2) + lx * R, R2 * Math.sin(th2) + ly * R, 0];
          const n = vnoise(
            R * 2.1 + k * 5.3,
            7 + frac(P.seed * 0.01),
            P.seed,
            NoiseSalt.laneArm,
            field,
          );
          if (n > keep) continue; // dust is patchy
          pts.push(a);
          const r = step(DustIndex.arms + 1000 * k + s);
          const offN = r.gauss() * 2.2;
          const dAng = r.gauss() * 0.07;
          const len = 9 + 9 * r.f32();
          // the hatch's pen line next, before the feather's numbers, so that it does not depend
          // on `dustScribble` either (v21's order otherwise; v21 draws pen lines on their own
          // stream, so a replay takes nothing from the lane sequence here)
          hatches.push({ a, b, offN, offY: 0, offF: 0, dAng, len, tile: pen(r) });
          if (r.f32() < 0.14 * P.dustScribble) {
            // a feather: a short wisp crossing outward
            const fa = (r.f32() < 0.5 ? 1 : -1) * (1.0 + 0.4 * r.f32());
            const fl = 8 + 8 * r.f32();
            const tile = pen(r);
            hatches.push({ a, b, offN: 0, offY: 0, offF: fl * 0.45, dAng: fa, len: fl, tile });
          }
        }
      }
    }
  }
  if (!nPen) hatches.length = 0;
  return {
    hatches,
    pts,
    laneR: 3.5 + 3 * P.dustScribble,
    screenPts: e > 74,
    screenLines: e > 72,
    lines: dustLines(P, V, penlines, incl, key, picks?.lines),
  };
}

/**
 * The pen lines that carve gaps in the stipple (app23.js:L199–213): the longest polyline of 1–3
 * `penlines` drawings, laid along the arms' inner edges, or along the midplane past 72°. They are
 * never drawn; the stipple near them is culled (compute/project.wgsl).
 */
export function dustLines(
  P: Params,
  V: Variation,
  penlines: VectorSheet | undefined,
  incl: number,
  key: number = P.seed,
  picks?: readonly number[],
): Vec3[][] {
  const out: Vec3[][] = [];
  if (!(P.dustLines > 0.02 && P.bulge < 0.95) || !penlines?.n) return out;
  const edge = incE(incl) > 72;
  const lanes = edge ? 1 : Math.min(3, P.arms);
  for (let li = 0; li < lanes; li++) {
    // the pen line: v21's (`picks`), or drawn on the placement key, so that re-draws vary it
    const pi = Math.min(
      penlines.n - 1,
      picks?.[li] ??
        Math.floor(new Draws(key >>> 0, Stream.dust, DustIndex.lines + li).f32() * penlines.n),
    );
    const rec = penlines.vec[pi];
    const fl = rec ? longestLine(rec) : null;
    if (!fl) continue;
    out.push(
      lineParam(fl).map(([s, d]): Vec3 => {
        if (edge) return [-3 + 6 * s, -d * 0.28, 0]; // screen space (ADR 0073)
        const Rr = 0.5 + 2.0 * s;
        const th =
          armPhaseCpu(P, V, Rr, li) +
          (2 * Math.PI * li) / Math.max(1, P.arms) -
          0.16 +
          (d * 0.5) / Rr;
        return [Rr * Math.cos(th), Rr * Math.sin(th), 0];
      }),
    );
  }
  return out;
}
