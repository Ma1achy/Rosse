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
import { effectiveDust } from './dust';
import type { Variation } from './variation';

export type Vec3 = [number, number, number];

const DEG = Math.PI / 180;
const TAU = 2 * Math.PI;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** Indices on the `curves` stream, one per curve. Fixed forever (ADR 0004). */
export const CurveIndex = {
  ring: 1,
  bar: 2,
  edgeOn: 3,
  outline: 4,
  tail: 5,
  /** the 3D dust lane's arcs (ADR 0081): arc k uses `laneRing + k` */
  laneRing: 300,
  /** the natural arm's companion strokes (ADR 0082): arm k, stroke i uses `armFibre + 16k + i` */
  armFibre: 400,
  /** dust wisp i (ADR 0087) uses `dustWisp + i` */
  dustWisp: 700,
  /** the jet's strands (ADR 0089): lobe l, strand i uses `jet + 16l + i` */
  jet: 800,
  /** stream q's strands use `stream + 32q + i` (ADR 0089) */
  stream: 840,
  /** the tidal tail's strands use `tailStrand + i` (ADR 0089) */
  tailStrand: 920,
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
  /**
   * The points are screen-space offsets (galaxy units, rolled by `pa`, mirrored by the winding),
   * not galaxy-frame points: the view tier does not orbit them (ADR 0073). Absent: galaxy frame.
   */
  screen?: boolean;
  /** what it is (tests, statistics) */
  role:
    | 'arm'
    | 'arm-piece'
    | 'arm-fibre'
    | 'spur'
    | 'ring'
    | 'bar'
    | 'edge-on'
    | 'lane-ring'
    | 'dust-wisp'
    | 'jet'
    | 'stream'
    | 'outline'
    | 'tail'
    | 'shell';
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
    const fibres: Curve[] = [];
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
      if (P.strokesAuto > 0) fibres.push(...armFibres(P, pts, k, at, pick));
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
    C.push(...fibres);
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
  if (P.lineWorld > 0 && P.kind !== 'merger' && P.bulge < 0.95) C.push(...laneRings(P, at, pick));
  if (P.strokesAuto > 0 && P.kind !== 'merger' && P.arms >= 1 && P.bulge < 0.95)
    C.push(...dustWisps(P, V, at, pick));
  if (incE(incl) > 80 && P.kind !== 'merger' && P.bulge < 0.95)
    C.push({
      pts: [
        [-3.2, 0, 0],
        [0, 0, 0],
        [3.2, 0, 0],
      ],
      w: w * 0.8,
      k: pick(effectiveDust(P) > 0.3 ? 'faint' : P.stroke, at(CurveIndex.edgeOn)),
      // the alpha is the view tier's (ribUniform): the model holds no continuous inclination
      a: 1,
      taper: false,
      stretch: true,
      edgeAlpha: true,
      // a line in the galaxy plane would shrink with cos(az) while the disc keeps its width; the
      // stroke keeps its length along the roll axis at every azimuth (ADR 0073)
      screen: true,
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
  if (P.lineWorld > 0 && P.jet > 0.5) C.push(...jetStrands(P, at, pick));
  if (P.lineWorld > 0 && P.streams > 0.02) C.push(...streamStrands(P, at, pick));
  if (P.tail > 0.05 && P.lineWorld > 0) {
    C.push(...tailStrands(at, pick));
  } else if (P.tail > 0.05) {
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

/**
 * The edge-on midplane stroke's alpha: `lines · clamp((incE − 72) / 18, 0, 1)`. v21 (app23.js:L788)
 * used the raw `incl` unclamped, so the alpha passed 1 above 90° (1.55 at 100°, 11 at 270°) and went
 * negative below 72°; the folded inclination is symmetric about 90° and bounded (ADR 0073).
 */
export function edgeOnAlpha(lines: number, incl: number): number {
  return lines * clamp((incE(incl) - 72) / 18, 0, 1);
}

/**
 * The dust lane in 3D (ADR 0081): a few broken arcs of rings in the disc plane, tapered like a
 * pen stroke, laid inside the arms. They are ordinary curves in the galaxy frame, so the camera
 * simply looks at them: edge-on they flatten into the dark midplane band, at 80° they are the
 * crescent that crosses the bulge, face-on they are faint rings in the disc. No inclination
 * switch, no screen-space line. Only a dusty disc has them.
 */
function laneRings(
  P: Params,
  at: (i: number) => Draws,
  pick: (kind: string, r: Draws) => number,
): Curve[] {
  const dust = effectiveDust(P);
  if (!(dust > 0.15)) return [];
  const out: Curve[] = [];
  const rings = dust > 0.5 ? 3 : 2;
  for (let i = 0; i < rings; i++) {
    const r0 = at(CurveIndex.laneRing + 10 * i);
    const R = 0.45 + 0.42 * i + 0.12 * r0.f32();
    const arcs = 2 + (r0.f32() < 0.5 ? 1 : 0);
    const a0 = r0.f32() * TAU;
    for (let a = 0; a < arcs; a++) {
      const r = at(CurveIndex.laneRing + 10 * i + 1 + a);
      const span = 1.1 + 1.2 * r.f32();
      const t0 = a0 + (a * TAU) / arcs + 0.3 * r.f32();
      const ph = r.f32() * TAU;
      const pts: Vec3[] = [];
      for (let j = 0; j <= 36; j++) {
        const t = t0 + (span * j) / 36;
        const Rr = R * (1 + 0.04 * Math.sin(3 * t + ph));
        pts.push([Rr * Math.cos(t), Rr * Math.sin(t), 0.012 * Math.sin(2 * t + ph)]);
      }
      out.push({
        pts,
        w: 0.55,
        k: pick(dust > 0.3 ? 'faint' : P.stroke, r),
        a: 1,
        taper: true,
        stretch: false,
        edgeAlpha: false,
        role: 'lane-ring',
      });
    }
  }
  return out;
}

/**
 * The natural arm's companion strokes (ADR 0082): the arm is drawn as a few overlapping strokes
 * of different length, offset and width, not one line. Thick where the arm joins the bar or bulge
 * and thin toward its tip; each arm has its own thickness, so some are fine and some are broad.
 */
function armFibres(
  P: Params,
  pts: Vec3[],
  k: number,
  at: (i: number) => Draws,
  pick: (kind: string, r: Draws) => number,
): Curve[] {
  const out: Curve[] = [];
  const n = pts.length - 1;
  const rr = at(CurveIndex.armFibre + 16 * k);
  const body = 0.6 + 0.9 * rr.f32();
  const count = 2 + Math.round(2 * clamp(P.lines, 0, 1)) + Math.floor(2 * rr.f32());
  const slice = (a: number, b: number, off: number, z: number, dz = 0): Vec3[] => {
    const q: Vec3[] = [];
    for (let j = Math.floor(a * n); j <= Math.ceil(b * n); j++) {
      const p = pts[clamp(j, 0, n)];
      const p0 = pts[clamp(j - 1, 0, n)];
      const p1 = pts[clamp(j + 1, 0, n)];
      if (!p || !p0 || !p1) continue;
      const tx = p1[0] - p0[0];
      const ty = p1[1] - p0[1];
      const l = Math.hypot(tx, ty) || 1;
      const R = Math.hypot(p[0], p[1]);
      q.push([p[0] - (ty / l) * off * R, p[1] + (tx / l) * off * R, z + dz * (j / n - a)]);
    }
    return q;
  };
  // the root, where the arm leaves the bar or the bulge: one broad stroke over its first third
  out.push({
    pts: slice(0, 0.34, 0, 0),
    w: 2.1 * body,
    k: pick(P.stroke, rr),
    a: 0.85,
    taper: true,
    stretch: false,
    edgeAlpha: false,
    role: 'arm-fibre',
  });
  for (let i = 1; i <= count; i++) {
    const r = at(CurveIndex.armFibre + 16 * k + i);
    const len = 0.22 + 0.4 * r.f32();
    const a = (1 - len) * r.f32() * 0.85;
    const mid = a + len / 2;
    const off = (r.f32() * 2 - 1) * (0.02 + 0.05 * (1 - mid));
    // out of the plane: a height and a slope along the stroke, so edge-on the arm has thickness
    const z = (r.f32() * 2 - 1) * 0.05 * (1 - mid);
    const dz = (r.f32() * 2 - 1) * 0.12 * (1 - 0.6 * mid);
    out.push({
      pts: slice(a, a + len, off, z, dz),
      w: body * (0.45 + 1.5 * (1 - mid) ** 1.5),
      k: pick(P.stroke, r),
      a: 0.8,
      taper: true,
      stretch: false,
      edgeAlpha: false,
      role: 'arm-fibre',
    });
  }
  return out.filter((c) => c.pts.length > 3);
}

/**
 * Dust as brush strokes in 3D (ADR 0087): short faint strokes along the inner edge of each arm, the
 * side the lanes lie on, each a swirl that rises and falls out of the disc plane (a height of up to
 * 0.25, a slope and a wobble in the radius), so face-on they are curls along the arm and edge-on
 * they are wisps standing above and below the midplane. More of them for a dustier galaxy.
 */
function dustWisps(
  P: Params,
  V: Variation,
  at: (i: number) => Draws,
  pick: (kind: string, r: Draws) => number,
): Curve[] {
  const dust = clamp(effectiveDust(P), 0, 1);
  const n = Math.round(P.arms * (3 + 5 * dust));
  const out: Curve[] = [];
  for (let i = 0; i < n; i++) {
    const r = at(CurveIndex.dustWisp + i);
    const k = i % P.arms;
    const R0 = 0.5 + 1.5 * r.f32();
    const span = 0.35 + 0.5 * r.f32();
    const off = (2 * Math.PI * k) / P.arms;
    // on the inner (trailing) edge of the arm, a little inside its radius
    const lead = -(0.1 + 0.16 * r.f32());
    const z0 = (r.f32() * 2 - 1) * 0.25 * Math.exp(-R0 / 2.2);
    const dz = (r.f32() * 2 - 1) * 0.12;
    const swirl = 0.05 + 0.07 * r.f32();
    const ph = r.f32() * TAU;
    const pts: Vec3[] = [];
    for (let j = 0; j <= 26; j++) {
      const s = j / 26;
      const R = (R0 + 0.55 * s) * (1 + swirl * Math.sin(TAU * 1.5 * s + ph));
      const th = armPhaseCpu(P, V, R, k) + off + lead + span * (s - 0.5) * 0.5;
      pts.push([R * Math.cos(th), R * Math.sin(th), z0 + dz * s + 0.04 * Math.sin(TAU * s + ph)]);
    }
    out.push({
      pts,
      w: 0.8 + 0.7 * r.f32(),
      k: pick(r.f32() < 0.5 ? P.stroke : 'broken', r),
      a: 0.9,
      taper: true,
      stretch: false,
      edgeAlpha: false,
      role: 'dust-wisp',
    });
  }
  return out;
}

type Pick = (kind: string, r: Draws) => number;

/**
 * The jet (ADR 0089, `lineWorld`): two lobes along the galaxy's own axis, each a twisting bundle of
 * strokes that opens from the nucleus like a cone, with a bright spine, strands ending at different
 * lengths so the tip feathers out. In 3D, so face-on it is a short bright burst and edge-on it
 * stands out of the disc with volume.
 */
function jetStrands(P: Params, at: (i: number) => Draws, pick: Pick): Curve[] {
  const head = at(CurveIndex.jet + 15);
  // the part picks' own jet: an angle in the plane and a length, here on the curves stream
  const ang = head.f32() * TAU;
  const u = head.f32();
  const tilt = 0.14;
  const d: Vec3 = [Math.sin(tilt) * Math.cos(ang), Math.sin(tilt) * Math.sin(ang), Math.cos(tilt)];
  const e1: Vec3 = [Math.cos(ang + Math.PI / 2), Math.sin(ang + Math.PI / 2), 0];
  const e2: Vec3 = [
    d[1] * e1[2] - d[2] * e1[1],
    d[2] * e1[0] - d[0] * e1[2],
    d[0] * e1[1] - d[1] * e1[0],
  ];
  const Lg = 3 + u;
  const out: Curve[] = [];
  for (let l = 0; l < 2; l++) {
    const sgn = l === 0 ? 1 : -1;
    const len = Lg * (l === 0 ? 1 : 0.65);
    const n = l === 0 ? 22 : 15;
    for (let i = 0; i <= n; i++) {
      const r = at(CurveIndex.jet + 16 * l + i);
      const spine = i === 0;
      // a third of the strands are short, bright at the root; the rest run to the tip
      const short = !spine && i % 3 === 0;
      const reach = spine ? 1 : short ? 0.18 + 0.3 * r.f32() : 0.55 + 0.45 * r.f32();
      const phase = r.f32() * TAU;
      const rad = spine ? 0 : 0.35 + 0.65 * r.f32();
      const twist = 1.2 + 1.4 * r.f32();
      const pts: Vec3[] = [];
      for (let j = 0; j <= 28; j++) {
        const t = (j / 28) * reach;
        // a cone that opens, with a slow helix and a little unevenness along the strand
        const rho = 0.05 + 0.32 * Math.pow(t, 1.05);
        const a = phase + twist * TAU * t * 0.5;
        const k = rad * rho * len * (1 + 0.12 * Math.sin(TAU * 2.3 * t + phase));
        const x = sgn * d[0] * t * len + (e1[0] * Math.cos(a) + e2[0] * Math.sin(a)) * k;
        const y = sgn * d[1] * t * len + (e1[1] * Math.cos(a) + e2[1] * Math.sin(a)) * k;
        const z = sgn * d[2] * t * len + (e1[2] * Math.cos(a) + e2[2] * Math.sin(a)) * k;
        pts.push([x, y, z]);
      }
      out.push({
        pts,
        w: spine ? 2.4 : short ? 1.4 + 0.8 * r.f32() : 1 + 0.8 * r.f32(),
        k: pick(spine ? P.stroke : r.f32() < 0.5 ? 'faint' : P.stroke, r),
        a: spine ? 1 : 0.8,
        taper: true,
        stretch: false,
        edgeAlpha: false,
        role: 'jet',
      });
    }
  }
  return out;
}

/**
 * A stellar stream (ADR 0089, `lineWorld`): a band of strands along an arc round the galaxy that
 * is narrow at the progenitor and fans out along the orbit, on a plane tilted out of the galaxy's,
 * each strand ending at its own length. The arc is the stream's own pick (the same angles the
 * pen-line stream uses), so a stream keeps its place.
 */
function streamStrands(P: Params, at: (i: number) => Draws, pick: Pick): Curve[] {
  const count = 1 + (P.streams > 0.6 ? 1 : 0);
  const out: Curve[] = [];
  for (let q = 0; q < count; q++) {
    // the stream's pick on the `parts` stream (PartIndex.streams = 20, streamTilt = 40, ADR 0085)
    const pr = new Draws(P.seed, Stream.parts, 20 + q);
    pr.f32();
    const R0 = 2.0 + 1.2 * pr.f32();
    const span = 2.0 + 1.6 * pr.f32();
    const a0 = pr.f32() * 6.28;
    const tilt = 0.35 + 0.95 * new Draws(P.seed, Stream.parts, 40 + q).f32();
    const n = 7;
    for (let i = 0; i < n; i++) {
      const r = at(CurveIndex.stream + 32 * q + i);
      const lat = (r.f32() * 2 - 1) * (i === 0 ? 0 : 1);
      const lift = (r.f32() * 2 - 1) * 0.6;
      const reach = i === 0 ? 1 : 0.6 + 0.4 * r.f32();
      const t0 = i === 0 ? 0 : 0.12 * r.f32();
      const ph = r.f32() * TAU;
      const pts: Vec3[] = [];
      for (let j = 0; j <= 40; j++) {
        const t = t0 + ((reach - t0) * j) / 40;
        const width = 0.03 + 0.3 * t * t;
        const ang = a0 + span * t;
        const R = R0 * (1 - 0.25 * t) + lat * width + 0.05 * Math.sin(TAU * 2 * t + ph);
        const y = R * Math.sin(ang);
        const z0 = lift * width + 0.04 * Math.sin(TAU * t + ph);
        // the orbit plane is the galaxy's tilted about the x axis
        pts.push([
          R * Math.cos(ang),
          y * Math.cos(tilt) - z0 * Math.sin(tilt),
          y * Math.sin(tilt) + z0 * Math.cos(tilt),
        ]);
      }
      out.push({
        pts,
        w: i === 0 ? 1.5 : 0.6 + 0.6 * r.f32(),
        k: pick(r.f32() < 0.4 ? P.stroke : 'faint', r),
        a: i === 0 ? 1 : 0.75,
        taper: true,
        stretch: false,
        edgeAlpha: false,
        role: 'stream',
      });
    }
  }
  return out;
}

/**
 * The tidal tail (ADR 0089, `lineWorld`): v21's sweep out from the disc edge as a fanning bundle,
 * lifting out of the plane as it goes, so it has width and depth where v21 drew one line.
 */
function tailStrands(at: (i: number) => Draws, pick: Pick): Curve[] {
  const a1 = at(CurveIndex.tail).f32() * 6.28;
  const out: Curve[] = [];
  for (let i = 0; i < 9; i++) {
    const r = at(CurveIndex.tailStrand + i);
    const main = i === 0;
    const lat = main ? 0 : r.f32() * 2 - 1;
    const lift = main ? 0 : r.f32() * 2 - 1;
    const reach = main ? 1 : 0.55 + 0.45 * r.f32();
    const t0 = main ? 0 : 0.1 * r.f32();
    const ph = r.f32() * TAU;
    const pts: Vec3[] = [];
    for (let j = 0; j <= 60; j++) {
      const fj = t0 + ((reach - t0) * j) / 60;
      const width = 0.04 + 0.5 * fj * fj;
      const R3 = 2.6 + 2.8 * fj + lat * width * 0.6 + 0.05 * Math.sin(TAU * 1.7 * fj + ph);
      const t3 = a1 + 1.5 * fj;
      pts.push([
        R3 * Math.cos(t3),
        R3 * Math.sin(t3) + 0.6 * fj * fj,
        0.35 * fj * fj + lift * width * 0.5,
      ]);
    }
    out.push({
      pts,
      w: main ? 1.3 : 0.6 + 0.6 * r.f32(),
      k: pick(r.f32() < 0.5 ? 'faint' : 'broken', r),
      a: main ? 1 : 0.75,
      taper: true,
      stretch: false,
      edgeAlpha: false,
      role: 'tail',
    });
  }
  return out;
}
