/**
 * Curves: the control polylines of the stroke ribbons, in the galaxy frame (the reference's
 * `curves()`, app23.js:L768–800). Part of the scene description (ADR 0003): a few hundred points
 * built on the CPU in the model tier, rounded to f32 once (src/model/ribbons.ts), then projected,
 * measured and expanded into ribbons or re-spaced pieces on the GPU (compute/ribbons.wgsl) or by
 * its CPU twin (src/fallback/kernels/ribbons.ts).
 *
 * The rules are v21's. The random numbers are the counter-based ones (ADR 0004): v21 draws every
 * stroke choice from one sequential stream (`mulberry32(VAR.strokeSeed)`), so turning a spur off
 * changes the strokes of the ring, the bar and the tail. Here each curve has its own index on the
 * `curves` stream (CurveIndex), so a curve's choices depend on that curve only.
 */
import type { Params } from '../core/params';
import { NoiseSalt, vnoise, type NoiseField } from '../core/noise';
import { Draws } from '../core/rng';
import { Stream } from '../core/streams';
import { strokeIndex, strokePools, type StrokesMeta } from '../marks/strokes';
import { incE } from '../view/camera';
import type { Variation } from './variation';

export type Vec3 = [number, number, number];

const DEG = Math.PI / 180;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** Indices on the `curves` stream, one per curve. Fixed forever (ADR 0004). */
export const CurveIndex = {
  ring: 1,
  bar: 2,
  edgeOn: 3,
  outline: 4,
  tail: 5,
  /** arm k uses index `arms + k` */
  arms: 100,
  /** spur i uses index `spurs + i` */
  spurs: 200,
} as const;

/**
 * The stroke choices of another engine, to draw with (the golden runner passes v21's own, made by
 * its `curves()` from `VAR.strokeSeed`): like the hand, which stroke of the sheet draws an arm is a
 * discrete random choice (ADR 0005). `strokes[c]` is curve c's row, in curve order; `spurs[i]`
 * whether spur i is drawn.
 */
export interface CurvePicks {
  strokes: number[];
  spurs: boolean[];
  /** the outline arcs' start angle and length, radians (ADR 0018); absent: drawn */
  outline?: { st: number; len: number }[];
  /** the tidal tail's start angle, radians (ADR 0018); absent: drawn */
  tail?: number;
}

export interface Curve {
  /** control points, galaxy frame */
  pts: Vec3[];
  /** the ink's width, in pens (`PEN.line × w` plate px) */
  w: number;
  /** the stroke: a row of the strokes sheet */
  k: number;
  /** ink alpha */
  a: number;
  /** narrows from 1.1 at the root to 0.65 at the tip */
  taper: boolean;
  /** drawn once along the curve, never repeated or re-spaced */
  stretch: boolean;
  /**
   * The edge-on midplane stroke, whose alpha is `lines · (incl − 72) / 18`: it changes with the
   * inclination inside an `incE` bucket, so the view tier computes it (v21 parity: the reference
   * uses `incl`, not `incE()`, reference notes 20.12).
   */
  edgeAlpha: boolean;
  /** what it is (tests, statistics) */
  role: 'arm' | 'arm-piece' | 'spur' | 'ring' | 'bar' | 'edge-on' | 'outline' | 'tail';
}

/**
 * The reference's `armPhase(R, k)` (app23.js:L127), in f64 on the CPU: the angle of arm `k` at
 * radius R, a logarithmic spiral from r0 (the bar's end, or 0.25) plus the arm's phase and wiggle.
 * `k` undefined is the unperturbed spiral.
 */
export function armPhaseCpu(P: Params, V: Variation, R: number, k?: number): number {
  const r0 = P.bar > 0.05 ? Math.max(0.2, P.barLen) : 0.25;
  const a = k === undefined ? undefined : V.arms[k % V.arms.length];
  const pitch = P.pitch * (a ? a.pitch : 1);
  let ph = Math.log(Math.max(R, r0) / r0) / Math.tan(clamp(pitch, 4, 60) * DEG);
  if (a) ph += a.phase + a.wig * Math.sin(R * a.wf + a.wp);
  return ph;
}

/** The fractional part: v21 offsets noise by multiples of the seed; the lattice here is keyed by it. */
export const frac = (x: number) => x - Math.floor(x);

export function curves(
  P: Params,
  V: Variation,
  strokes: StrokesMeta | undefined,
  incl: number,
  picks?: CurvePicks,
  field?: NoiseField | null,
): Curve[] {
  const C: Curve[] = [];
  if (P.lines <= 0 || !strokes) return C;
  const pools = strokePools(strokes.kind);
  const pick = (kind: string, r: Draws) => {
    const u = r.f32();
    const given = picks?.strokes[C.length];
    return given ?? strokeIndex(kind, pools, u);
  };
  const at = (i: number) => new Draws(P.seed, Stream.curves, i);
  const w = 1;
  const A = 1;
  const lx = V.lop * Math.cos(V.lopA) * 0.35;
  const ly = V.lop * Math.sin(V.lopA) * 0.35;

  if (P.arms >= 1 && P.bulge < 0.95 && P.armStyle === 'ribbons' && !P.ringOnlyLines) {
    // v21 parity: the arm curves start at barLen (not max(0.2, barLen) as armPhase does)
    const r0 = P.bar > 0.05 ? P.barLen : 0.25;
    for (let k = 0; k < P.arms; k++) {
      const r = at(CurveIndex.arms + k);
      const pts: Vec3[] = [];
      const off = (2 * Math.PI * k) / P.arms;
      const va = V.arms[k % V.arms.length];
      const rmax = Math.min(va ? va.rmax : 2.1, 2.1 + 0.5 * (1 - P.bulge));
      for (let j = 0; j <= 160; j++) {
        const R = r0 + ((rmax - r0) * j) / 160;
        const th = armPhaseCpu(P, V, R, k) + off;
        pts.push([R * Math.cos(th) + lx * R, R * Math.sin(th) + ly * R, 0]);
      }
      if (P.flocc > 0.3) {
        // flocculent: the arm breaks where the noise is low; pieces of more than 6 points stay
        let seg: Vec3[] = [];
        const push = () => {
          if (seg.length > 6)
            C.push({
              pts: seg,
              w: w * 0.8,
              k: pick(P.stroke, r),
              a: A,
              taper: false,
              stretch: false,
              edgeAlpha: false,
              role: 'arm-piece',
            });
        };
        for (let j2 = 0; j2 < pts.length; j2++) {
          const n = vnoise(j2 * 0.08 + k * 7, 0, P.seed, NoiseSalt.floccArm, field);
          const p = pts[j2];
          if (n > 0.25 + 0.35 * P.flocc && p) seg.push(p);
          else {
            push();
            seg = [];
          }
        }
        push();
      } else
        C.push({
          pts,
          w,
          k: pick(P.stroke, r),
          a: A,
          taper: true,
          stretch: false,
          edgeAlpha: false,
          role: 'arm',
        });
    }
    V.spurs.forEach((sp, i) => {
      const r = at(CurveIndex.spurs + i);
      const keep = r.f32() <= 0.6;
      if (!(picks?.spurs[i] ?? keep)) return;
      const pts: Vec3[] = [];
      const base = armPhaseCpu(P, V, sp.R0, sp.k) + (2 * Math.PI * sp.k) / P.arms;
      const t = Math.tan(clamp(P.pitch * sp.pk, 10, 70) * DEG);
      for (let j3 = 0; j3 <= 30; j3++) {
        const R3 = sp.R0 + (sp.len * j3) / 30;
        const t3 = base + Math.log(R3 / sp.R0) / t;
        pts.push([R3 * Math.cos(t3), R3 * Math.sin(t3), 0]);
      }
      C.push({
        pts,
        w: w * 0.7,
        k: pick(P.stroke === 'mixed' ? 'spurred' : P.stroke, r),
        a: A,
        taper: true,
        stretch: false,
        edgeAlpha: false,
        role: 'spur',
      });
    });
  }
  if (P.ring > 0.1 && P.ringStyle === 'ribbon') {
    const pts: Vec3[] = [];
    for (let a = 0; a <= 180; a++) {
      const t = (a / 180) * 2 * Math.PI;
      pts.push([P.ringR * Math.cos(t), P.ringR * Math.sin(t), 0]);
    }
    C.push({
      pts,
      w: w * 0.45,
      k: pick(P.stroke, at(CurveIndex.ring)),
      a: A * P.ring,
      taper: false,
      stretch: false,
      edgeAlpha: false,
      role: 'ring',
    });
  }
  if (P.bar > 0.1 && P.barStyle === 'ribbon')
    C.push({
      pts: [
        [-P.barLen, 0, 0],
        [0, 0, 0],
        [P.barLen, 0, 0],
      ],
      w: w * (1.2 + 1.6 * P.bar),
      k: pick('plain', at(CurveIndex.bar)),
      a: Math.min(1, P.lines * 1.2) * P.bar,
      taper: false,
      stretch: true,
      edgeAlpha: false,
      role: 'bar',
    });
  if (incE(incl) > 80 && P.kind !== 'merger' && P.bulge < 0.95)
    C.push({
      pts: [
        [-3.2, 0, 0],
        [0, 0, 0],
        [3.2, 0, 0],
      ],
      w: w * 0.8,
      k: pick(P.dust > 0.3 ? 'faint' : P.stroke, at(CurveIndex.edgeOn)),
      // the alpha is the view tier's (ribUniform): the model holds no continuous inclination
      a: 1,
      taper: false,
      stretch: true,
      edgeAlpha: true,
      role: 'edge-on',
    });
  if (P.outline > 0.05) {
    const r = at(CurveIndex.outline);
    const R = 2.6;
    const a0 = r.f32() * 6.28;
    for (let s = 0; s < 2; s++) {
      const drawnSt = a0 + s * (1.9 + r.f32() * 0.5);
      const drawnLen = 0.7 + r.f32() * 0.8;
      const given = picks?.outline?.[s];
      const st = given ? given.st : drawnSt;
      const len = given ? given.len : drawnLen;
      const pts: Vec3[] = [];
      for (let j = 0; j <= 40; j++) {
        const t = st + (len * j) / 40;
        pts.push([R * Math.cos(t), R * Math.sin(t), 0]);
      }
      C.push({
        pts,
        w: w * 0.55,
        k: pick('faint', r),
        a: 1,
        taper: false,
        stretch: false,
        edgeAlpha: false,
        role: 'outline',
      });
    }
  }
  if (P.tail > 0.05) {
    // a tidal tail swept out from the disc edge
    const r = at(CurveIndex.tail);
    const pts: Vec3[] = [];
    const drawnA1 = r.f32() * 6.28;
    const a1 = picks?.tail ?? drawnA1;
    for (let j3 = 0; j3 <= 90; j3++) {
      const fj = j3 / 90;
      const R3 = 2.6 + 2.8 * fj;
      const t3 = a1 + 1.5 * fj;
      pts.push([R3 * Math.cos(t3), R3 * Math.sin(t3) + 0.6 * fj * fj, 0]);
    }
    C.push({
      pts,
      w: w * 0.9,
      k: pick(r.f32() < 0.5 ? 'faint' : 'broken', r),
      a: 1,
      taper: true,
      stretch: false,
      edgeAlpha: false,
      role: 'tail',
    });
  }
  return C;
}

/** The edge-on midplane stroke's alpha (app23.js:L788): `lines · (incl − 72) / 18`. */
// v21 parity: `incl`, not `incE()`; computed per view (src/model/ribbons.ts ribUniform)
export function edgeOnAlpha(lines: number, incl: number): number {
  return (lines * (incl - 72)) / 18;
}
