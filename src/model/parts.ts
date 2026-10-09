/**
 * Part placement: which drawings go where (the reference's `parts(r)`, app23.js:L987–1086).
 *
 * Two halves, by tier (ADR 0010):
 *
 * - **Model tier, `describeParts`**: every random choice of `parts()` (`PartPicks`): which
 *   envelope, whole drawing, arms, bar, ring, nuclear spiral, arcs, shells, tail, trails, arrow,
 *   bubbles, jet and streams, with their spins, sizes and screen positions, and the whole
 *   drawing's type. v21 draws all of them in a fixed order from one sequential stream
 *   (`mulberry32(P.seed * 57 + 3)`), so a change to one part shifts every later one. Here every
 *   part has its own index on the `parts` stream (`PartIndex`, ADR 0004), so turning the jet on
 *   changes the jet only. The golden runner passes v21's own picks instead (`SceneOptions`
 *   `partPicks`, replayed from v21's stream by tests/golden/compare/v21-parts.ts, ADR 0021).
 * - **View tier, `vectorRows`**: the instance rows of v21 (`[x, y, tile, alpha, m0…m3, ps, warp]`,
 *   section 15 of the reference notes) for a camera: the disc matrix `discM`, the scale, the
 *   bubbles' projected positions. A few dozen rows, expanded per segment, dot and blob on the GPU
 *   by compute/vector-expand.wgsl (or its CPU twin), in the reference's `MAGNIFIED` order.
 *
 * The drawn core (a bitmap, M2) and the nuclear spiral are `coreInstances`. The stellar streams'
 * dots and knots are marks, sampled on the GPU (`stream_marks`) along `streamPolylines`.
 *
 * Left for later milestones: the sky (`skyParts`: deep field, foreground stars, companions, M7)
 * and the parts of mergers and lensed sources (M8, M9).
 */
import type { Params } from '../core/params';
import { Draws } from '../core/rng';
import { Stream } from '../core/streams';
import type { Instance } from '../marks/instance';
import {
  lineParam,
  longestLine,
  type VectorAtlas,
  type VectorLibrary,
  type VectorSheet,
} from '../marks/vector';
import type { NoiseField } from '../core/noise';
import {
  PLATE,
  UNIT_SCALE,
  chain,
  discM,
  incE,
  orient,
  perspective,
  project,
  rotationOf,
  toScreen,
  toView,
  type Camera,
  type Mat2,
} from '../view/camera';
import type { CompanionPick } from './sky';
import { smWarp, wobbleAmplitude } from '../view/warp';
import { armPhaseCpu } from './curves';
import type { DrawingsMeta, Variation } from './variation';

const DEG = Math.PI / 180;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const Rm = (t: number): Mat2 => [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t)];
const Sm = (x: number, y: number): Mat2 => [x, 0, 0, y];
/** v21's `simple(size, rot)` (app23.js:L173). */
const simple = (size: number, rot: number): Mat2 => chain(Rm(rot), Sm(size, size));
/** v21's `MODEL_SIGN` (app23.js:L7). */
const MODEL_SIGN = 1;

/** Indices on the `parts` stream, one per part. Fixed forever (ADR 0004). */
export const PartIndex = {
  env: 1,
  whole: 2,
  arms: 3,
  bar: 4,
  ring: 5,
  nuclear: 6,
  arcs: 7,
  shells: 8,
  tail: 9,
  trails: 10,
  arrow: 11,
  /** bubble i (clump i) uses index `bubbles + i` */
  bubbles: 1000,
  jet: 12,
  /** stream q uses index `streams + q` */
  streams: 20,
} as const;

/**
 * Every random choice of `parts()`, as data. Angles in radians, positions in plate px. `null` or
 * empty where the part is not drawn. v21's values are stored as v21 computes them (for example
 * `spin = r() · 6.28`), so both engines build the same rows from the same picks.
 */
export interface PartPicks {
  /** the envelope: an `env` drawing and its spin on the disc (0 for a pure bulge) */
  env: { tile: number; spin: number } | null;
  /** the whole drawing and its spin on the disc (0 when it is laid flat on the sky) */
  whole: { tile: number; spin: number } | null;
  /** the drawn arms: one `arms` drawing per arm */
  arms: number[];
  /** the drawn bar */
  bar: number | null;
  /** the drawn ring */
  ring: { tile: number; spin: number } | null;
  /** the nuclear spiral: a `cores` drawing of kind 'nuclear' */
  nuclear: number | null;
  /** lensed arcs: `u` sets the size, 2·(1.6 + 0.6u)·1.2 units */
  arcs: { tile: number; u: number; spin: number }[];
  /** drawn shells */
  shells: { tile: number; spin: number } | null;
  /** the tail: a pen line at angle `ang`, 3.6 units out */
  tail: { tile: number; ang: number } | null;
  /** trails and cosmic rays, at fixed plate positions (v21 parity: they ignore the zoom) */
  trails: { tile: number; x: number; y: number; size: number; rot: number }[];
  /** the stray arrow, at a fixed plate position */
  arrow: { x: number; y: number; size: number; rot: number } | null;
  /** bubbles: a `rings` curve at clump `clump` */
  bubbles: { clump: number; tile: number; spin: number }[];
  /** the jet: its angle, and `u` setting its length, (3.6 + u)·VIEW.scale */
  jet: { ang: number; u: number } | null;
  /** the streams: a pen line bent round the galaxy */
  streams: { tile: number; R0: number; span: number; a0: number }[];
}

export const NO_PICKS: PartPicks = {
  env: null,
  whole: null,
  arms: [],
  bar: null,
  ring: null,
  nuclear: null,
  arcs: [],
  shells: null,
  tail: null,
  trails: [],
  arrow: null,
  bubbles: [],
  jet: null,
  streams: [],
};

/** The parts of a galaxy in the model tier. */
export interface PartsDesc {
  picks: PartPicks;
  /** the type the whole drawing was matched to (L999–1001), when one is drawn */
  wholeType: string | null;
  /**
   * Per stream, its pen line bent round the galaxy: points in galaxy units on the plate's axes
   * about its centre (L1074–1075: `X = cx + Rr cos(ang) · VIEW.scale`, not projected: v21 parity,
   * the streams lie in the plate, whatever the camera).
   */
  streams: [number, number][][];
}

/** One placed vector drawing: v21's row (section 15 of the reference notes). */
export interface VectorRow {
  atlas: VectorAtlas;
  tile: number;
  /** translation, plate px */
  x: number;
  y: number;
  /** tile → plate px, column-major */
  m: Mat2;
  /** pen scale (row[8]) */
  ps: number;
  /** the row's alpha (row[3]): ignored when drawn, as v21 (reference notes 20.10) */
  alpha: number;
  /** a warp (row[9]) */
  warp?: { kind: 'rewind'; dk: number; flip: boolean };
}

/** v21's `drawingFlip(w)` (app23.js:L841): unknown winding counts as Z-wise. */
export function drawingFlip(w: string | undefined): number {
  return w === 'S' ? 1 : -1;
}

/** The rewind warp's `dk` (rewindFn, app23.js:L842–843): cot(target pitch) − cot(drawn pitch). */
export function rewindDk(drawnPitch: number, targetPitch: number): number {
  const cot = (p: number) => 1 / Math.tan(clamp(p, 5, 60) * DEG);
  return clamp(cot(targetPitch) - cot(drawnPitch), -4, 4);
}

/** The rewind warp itself, in f64 (rewindFn, L844): for tests and reference only. */
export function rewind(x: number, y: number, dk: number, flip: boolean): [number, number] {
  if (flip) x = -x;
  const rr = Math.hypot(x, y);
  if (rr < 0.015) return [x, y];
  const th = Math.atan2(y, x) + dk * Math.log(rr / 0.08);
  return [rr * Math.cos(th), rr * Math.sin(th)];
}

/**
 * The type a whole drawing is matched to (L999–1001): `kind` when set, else from the bulge, the
 * inclination (structure predicates: `incE` > 70 and > 78, and L1000's projected flattening, all
 * in `structureKey`), dust, flocculence, bar and arms.
 */
export function wholeTypeOf(P: Params, incl: number): string {
  if (P.kind !== 'auto') return P.kind;
  const e = incE(incl);
  // v21 used the signed cos i, so a galaxy seen from below (90°–270°) was always elongated
  // (ADR 0073); |cos i| is symmetric about 90°
  const ci = Math.abs(Math.cos(incl * DEG));
  if (P.bulge >= 0.95)
    return P.bulgeFlat * Math.max(ci, 0.05) < 0.5 || (e > 70 && P.bulgeFlat < 0.6)
      ? 'smooth:elongated'
      : 'smooth';
  if (e > 78)
    return P.dust > 0.3 ? 'edge-on:dust-lane' : P.bulge < 0.08 ? 'edge-on:thick' : 'edge-on';
  if (P.flocc > 0.5) return 'galaxy:flocculent';
  if (P.bar > 0.3) return 'galaxy:barred-spiral';
  return P.arms >= 1 ? 'galaxy:spiral' : 'smooth';
}

/** The pool of whole drawings for a type (L1002–1004), with v21's doubled spiral pool. */
export function wholePool(type: string, types: readonly string[]): number[] {
  const pool: number[] = [];
  types.forEach((t, i) => {
    if (t === type || (type === 'merger' && t === 'galaxy:merger')) pool.push(i);
  });
  // v21 parity: a spiral lists its own type twice (the pool is doubled, the odds unchanged)
  if (type === 'galaxy:spiral')
    types.forEach((t, i) => {
      if (t === 'galaxy:spiral') pool.push(i);
    });
  if (!pool.length)
    types.forEach((t, i) => {
      if (t.startsWith('galaxy')) pool.push(i);
    });
  return pool;
}

/** The arms of a pitch class (L1017–1019): tight under 14°, medium under 26°, loose. */
export function armPool(P: Params, meta: readonly [string, string, string, number][]): number[] {
  const cls = P.pitch < 14 ? 'tight' : P.pitch < 26 ? 'medium' : 'loose';
  const pool: number[] = [];
  meta.forEach((m, i) => {
    if (m[0] === cls && m[2] === 'arm' && m[3]) pool.push(i);
  });
  if (!pool.length)
    meta.forEach((m, i) => {
      if (m[2] === 'arm' && m[3]) pool.push(i);
    });
  return pool;
}

const indicesOf = (list: readonly string[] | undefined, want: string) => {
  const out: number[] = [];
  (list ?? []).forEach((k, i) => {
    if (k === want) out.push(i);
  });
  return out;
};

/** The parts the parameters draw at all (the conditions of `parts()`, without the random gates). */
export interface PartGates {
  env: boolean;
  whole: boolean;
  arms: boolean;
  bar: boolean;
  ring: boolean;
  core: boolean;
  nuclear: boolean;
  arcs: number;
  shells: boolean;
  tail: boolean;
  trails: boolean;
  /** the arrow's own test still draws (L1052) */
  arrow: boolean;
  bubbles: boolean;
  jet: boolean;
  streams: number;
}

export function partGates(P: Params, incl: number): PartGates {
  const e = incE(incl);
  const core = P.bulge > 0.03 && P.bulge < 0.97 && !(P.sersicN > 0 && P.bulge >= 0.95) && e < 80;
  return {
    env: P.envelope > 0.5,
    whole: P.whole > 0.5,
    arms: P.armStyle === 'drawn' && P.arms >= 1 && P.bulge < 0.95,
    bar: P.bar > 0.1 && P.barStyle === 'drawn',
    ring: P.ring > 0.1 && P.ringStyle === 'drawn',
    core,
    nuclear: core && !!P.nuclear,
    arcs: P.lens > 0.05 ? 1 + (P.lens > 0.6 ? 1 : 0) : 0,
    shells: P.shells > 0.05,
    tail: P.tail > 0.05,
    trails: P.trails > 0.02,
    arrow: P.field > 0.02 && P.arrow > 0.02,
    bubbles: P.bubbles > 0.02 && (P.arms >= 1 || P.irr > 0) && !P.merger,
    jet: P.jet > 0.5,
    streams: P.streams > 0.02 ? 1 + (P.streams > 0.6 ? 1 : 0) : 0,
  };
}

/**
 * The engine's own picks: v21's rules (L987–1086), each part on its own index of the `parts`
 * stream (ADR 0004).
 */
export function ownPartPicks(P: Params, V: Variation, meta: DrawingsMeta, incl: number): PartPicks {
  const lib = meta.vectors ?? {};
  const G = partGates(P, incl);
  const at = (i: number) => new Draws(P.seed, Stream.parts, i);
  const pick = (r: Draws, pool: readonly number[]) =>
    pool[Math.floor(r.f32() * pool.length)] ?? pool[0] ?? 0;
  const n = (a: VectorAtlas) => lib[a]?.n ?? 0;
  const picks: PartPicks = {
    ...NO_PICKS,
    arms: [],
    arcs: [],
    trails: [],
    bubbles: [],
    streams: [],
  };

  if (G.env && n('env')) {
    const r = at(PartIndex.env);
    const want = P.bulge >= 0.99 || P.arms === 0 ? 'halo' : r.f32() < 0.5 ? 'halo' : 'disc';
    let cand = indicesOf(lib.env?.kind, want);
    if (!cand.length) cand = [0];
    const tile = pick(r, cand);
    picks.env = { tile, spin: P.bulge >= 0.99 ? 0 : r.f32() * 6.28 };
  }
  if (G.whole && n('whole')) {
    const r = at(PartIndex.whole);
    const types = lib.whole?.type ?? [];
    const tile = pick(r, wholePool(wholeTypeOf(P, incl), types));
    const wt = types[tile] ?? '';
    const flat = wt.startsWith('edge-on') || wt === 'smooth:elongated' || wt === 'smooth';
    picks.whole = { tile, spin: flat ? 0 : r.f32() * 6.28 };
  }
  if (G.arms && n('arms')) {
    const r = at(PartIndex.arms);
    const pool = armPool(P, lib.arms?.meta ?? []);
    const ai = pick(r, pool);
    for (let k = 0; k < P.arms; k++) picks.arms.push(r.f32() < 0.5 ? ai : pick(r, pool));
  }
  if (G.bar && n('bars')) {
    const r = at(PartIndex.bar);
    const ok: number[] = [];
    (lib.bars?.solid ?? []).forEach((s, i) => {
      if (!s) ok.push(i);
    });
    picks.bar = ok.length ? pick(r, ok) : 0;
  }
  if (G.ring && n('rings')) {
    const r = at(PartIndex.ring);
    const tile = Math.floor(r.f32() * n('rings'));
    picks.ring = { tile, spin: r.f32() * 6.28 };
  }
  if (G.nuclear) {
    const nn = indicesOf(meta.cores.kind, 'nuclear');
    if (nn.length) picks.nuclear = pick(at(PartIndex.nuclear), nn);
  }
  if (G.arcs && n('arcs')) {
    const r = at(PartIndex.arcs);
    for (let i = 0; i < G.arcs; i++) {
      const u = r.f32();
      const tile = Math.floor(r.f32() * n('arcs'));
      picks.arcs.push({ tile, u, spin: r.f32() * 6.28 });
    }
  }
  if (G.shells && n('shells')) {
    const r = at(PartIndex.shells);
    const tile = Math.floor(r.f32() * n('shells'));
    picks.shells = { tile, spin: r.f32() * 6.28 };
  }
  if (G.tail && n('penlines')) {
    const r = at(PartIndex.tail);
    const ang = r.f32() * 6.28;
    picks.tail = { tile: Math.floor(r.f32() * n('penlines')), ang };
  }
  if (G.trails && n('trails')) {
    const r = at(PartIndex.trails);
    const kinds = lib.trails?.kind ?? [];
    const long = indicesOf(kinds, 'trail');
    const cr = indicesOf(kinds, 'trail:cosmic-ray');
    if (P.trails > 0.4 && long.length) {
      const x = 400 + (r.f32() - 0.5) * 300;
      const y = 400 + (r.f32() - 0.5) * 300;
      const tile = pick(r, long);
      picks.trails.push({ tile, x, y, size: 900, rot: r.f32() * 3.14 });
    }
    for (let q = 0; q < Math.round(P.trails * 3); q++)
      if (cr.length) {
        const x = 60 + r.f32() * 680;
        const y = 60 + r.f32() * 680;
        const tile = pick(r, cr);
        const size = 40 + 30 * r.f32();
        picks.trails.push({ tile, x, y, size, rot: r.f32() * 6.28 });
      }
  }
  if (G.arrow && n('misc')) {
    const r = at(PartIndex.arrow);
    if (r.f32() < 0.25 * P.field * (0.5 + P.arrow)) {
      const x = 60 + r.f32() * 680;
      const y = 60 + r.f32() * 680;
      const size = 40 + 30 * r.f32();
      picks.arrow = { x, y, size, rot: r.f32() * 6.28 };
    }
  }
  if (G.bubbles && n('rings')) {
    const cpool = indicesOf(lib.rings?.kind, 'curve');
    V.clumps.forEach((_, i) => {
      const r = at(PartIndex.bubbles + i);
      if (r.f32() > P.bubbles * 0.6) return;
      const tile = pick(r, cpool);
      picks.bubbles.push({ clump: i, tile, spin: r.f32() * 6.28 });
    });
  }
  if (G.jet && n('misc')) {
    const r = at(PartIndex.jet);
    const ang = r.f32() * 6.28;
    picks.jet = { ang, u: r.f32() };
  }
  for (let q = 0; n('penlines') > 0 && q < G.streams; q++) {
    const r = at(PartIndex.streams + q);
    const tile = Math.floor(r.f32() * n('penlines'));
    const R0 = 2.0 + 1.2 * r.f32();
    const span = 2.0 + 1.6 * r.f32();
    picks.streams.push({ tile, R0, span, a0: r.f32() * 6.28 });
  }
  return picks;
}

/** The streams' pen lines bent round the galaxy (L1072–1075), in galaxy units about the centre. */
export function streamPolylines(picks: PartPicks, penlines: VectorSheet | undefined) {
  const out: [number, number][][] = [];
  for (const s of picks.streams) {
    const rec = penlines?.vec[s.tile];
    const fl = rec ? longestLine(rec) : null;
    // v21 skips a pen line without lines (L1072); none of the 25 has none
    if (!fl) continue;
    out.push(
      lineParam(fl).map(([t, d]): [number, number] => {
        const ang = s.a0 + s.span * t;
        const Rr = s.R0 * (1 - 0.25 * t) + d * 0.35;
        return [Rr * Math.cos(ang), Rr * Math.sin(ang)];
      }),
    );
  }
  return out;
}

/** The model tier's parts: the engine's picks, or the ones given (v21's, for the golden runner). */
export function describeParts(
  P: Params,
  V: Variation,
  meta: DrawingsMeta,
  incl: number,
  given?: PartPicks,
): PartsDesc {
  const picks = given ?? ownPartPicks(P, V, meta, incl);
  const wholeType = picks.whole ? wholeTypeOf(P, incl) : null;
  return { picks, wholeType, streams: streamPolylines(picks, meta.vectors?.penlines) };
}

/**
 * The rows of the placed vector drawings for a camera (L991–1068), in the reference's `MAGNIFIED`
 * order (arms, whole, env, rings, bars, arcs, shells, trails, penlines, misc), so they are
 * expanded and inked in v21's order (render(), L1287). The dust hatching (also `penlines`) is
 * placed by the line-work (src/model/lanes.ts).
 */
export function vectorRows(
  P: Params,
  V: Variation,
  meta: DrawingsMeta,
  parts: PartsDesc,
  cam: Camera,
  companions: readonly CompanionPick[] = [],
): VectorRow[] {
  const lib: Partial<VectorLibrary> = meta.vectors ?? {};
  const pk = parts.picks;
  const sc = UNIT_SCALE * cam.zoom;
  const cx = PLATE / 2;
  const cy = PLATE / 2;
  const D = discM(cam);
  const pa = cam.pa * DEG;
  // |cos i|, not v21's signed ci() (ADR 0073): the flattening is symmetric about 90°
  const ci = Math.abs(Math.cos(cam.incl * DEG));
  const by: Record<string, VectorRow[]> = {};
  const add = (atlas: VectorAtlas, row: Omit<VectorRow, 'atlas'>) => {
    (by[atlas] ??= []).push({ atlas, ...row });
  };
  const centre = { x: cx, y: cy, alpha: 1, ps: 1 };

  if (pk.env) {
    const big = 2 * 3.6 * sc;
    const m =
      P.bulge >= 0.99
        ? chain(Rm(pa), Sm(1, Math.max(P.bulgeFlat, ci)), Sm(big, big))
        : chain(D, Rm(pk.env.spin), Sm(big, big));
    add('env', { ...centre, tile: pk.env.tile, m });
  }
  if (pk.whole) {
    const wi = pk.whole.tile;
    const W = lib.whole;
    const wt = W?.type?.[wi] ?? '';
    const size = 2 * 3.3 * sc;
    const pitch = W?.pitch?.[wi];
    if (wt.startsWith('edge-on') || wt === 'smooth:elongated')
      add('whole', { ...centre, tile: wi, m: chain(Rm(pa), Sm(size, size)) });
    else if (wt === 'smooth')
      add('whole', {
        ...centre,
        tile: wi,
        m: chain(Rm(pa), Sm(size, size * Math.max(P.bulgeFlat, ci))),
      });
    else if (P.rewind && pitch && P.arms >= 1)
      // the drawing's spiral rewound to the model's pitch (L1008–1011)
      add('whole', {
        ...centre,
        tile: wi,
        m: chain(D, Rm(pk.whole.spin), Sm(size, size)),
        warp: { kind: 'rewind', dk: rewindDk(pitch, P.pitch), flip: W.winding?.[wi] === 'Z' },
      });
    else
      add('whole', {
        ...centre,
        tile: wi,
        m: chain(
          D,
          Sm(drawingFlip(W?.winding?.[wi]) * MODEL_SIGN, 1),
          Rm(pk.whole.spin),
          Sm(size, size),
        ),
      });
  }
  if (pk.arms.length) {
    const asz = (2 * 2.6 * sc) / 0.95;
    pk.arms.forEach((aj, k) => {
      const flip = drawingFlip(lib.arms?.meta?.[aj]?.[1]) * MODEL_SIGN;
      add('arms', {
        ...centre,
        tile: aj,
        m: chain(D, Rm((2 * Math.PI * k) / P.arms + 0.3), Sm(flip, 1), Sm(asz, asz)),
      });
    });
  }
  if (pk.bar !== null) {
    const bs = (2 * P.barLen * sc) / 0.92;
    add('bars', { ...centre, tile: pk.bar, m: chain(D, Sm(bs, bs)) });
  }
  if (pk.ring) {
    const rs = 2 * P.ringR * sc * 1.04;
    add('rings', {
      ...centre,
      alpha: 0.55,
      tile: pk.ring.tile,
      m: chain(D, Rm(pk.ring.spin), Sm(rs, rs)),
    });
  }
  for (const a of pk.arcs) {
    const s3 = 2 * (1.6 + 0.6 * a.u) * sc * 1.2;
    add('arcs', { ...centre, tile: a.tile, m: chain(Rm(a.spin), Sm(s3, s3)) });
  }
  if (pk.shells) {
    const s4 = 2 * 2.8 * sc;
    add('shells', { ...centre, tile: pk.shells.tile, m: chain(Rm(pk.shells.spin), Sm(s4, s4)) });
  }
  if (pk.tail) {
    const a = pk.tail.ang;
    add('penlines', {
      ...centre,
      x: cx + Math.cos(a) * 3.6 * sc,
      y: cy + Math.sin(a) * 3.6 * sc,
      tile: pk.tail.tile,
      m: simple(1.3 * sc, a + 0.4),
    });
  }
  // v21 parity: trails, cosmic rays and the arrow sit at fixed plate positions and sizes, whatever
  // the zoom (reference notes 20.15)
  for (const t of pk.trails)
    add('trails', { ...centre, x: t.x, y: t.y, tile: t.tile, m: simple(t.size, t.rot) });
  // the sky's companions (skyParts, app23.js:L913–919): placed in 3D, seen through the perspective
  // camera, in front of or behind the galaxy (both are drawn with the parts' line ink here: the ink
  // does not show the order)
  if (companions.length) {
    const R = rotationOf(cam);
    for (const c of companions) {
      const v = toView(c.w, R);
      const k = perspective(v[2]);
      const q = toScreen(v, k, R, sc);
      add('companions', {
        x: q[0],
        y: q[1],
        alpha: 1,
        ps: 1,
        tile: c.tile,
        m: orient(c.n, sc * c.scale * k, c.spin, 0.35, cam, R),
      });
    }
  }
  if (pk.arrow) {
    const a = pk.arrow;
    add('misc', { ...centre, x: a.x, y: a.y, tile: 1, ps: 0.5, m: simple(a.size, a.rot) });
  }
  if (pk.bubbles.length) {
    const nArms = Math.max(1, P.arms);
    for (const b of pk.bubbles) {
      const cl = V.clumps[b.clump];
      if (!cl) continue;
      const k = b.clump % nArms;
      const th0 = P.irr > 0 ? cl.t * 6.28 : armPhaseCpu(P, V, cl.R, k) + (2 * Math.PI * k) / nArms;
      const R0 = P.irr > 0 ? cl.R * 0.7 : cl.R;
      const [x, y] = project([R0 * Math.cos(th0), R0 * Math.sin(th0), 0], cam);
      const bs = Math.max(14, cl.s * 3.6 * sc);
      add('rings', { x, y, alpha: 1, ps: 0.6, tile: b.tile, m: chain(D, Rm(b.spin), Sm(bs, bs)) });
    }
  }
  if (pk.jet) {
    const ja = pk.jet.ang;
    const jl = (3.6 + 1.0 * pk.jet.u) * sc;
    for (const s2 of [1, -1]) {
      const len = s2 > 0 ? jl : jl * 0.65;
      add('misc', {
        x: cx + Math.cos(ja) * s2 * len * 0.5,
        y: cy + Math.sin(ja) * s2 * len * 0.5,
        alpha: 1,
        ps: 1.1,
        tile: 0,
        m: chain(Rm(ja + (s2 < 0 ? Math.PI : 0)), Sm(len, len * 0.28)),
      });
    }
  }
  const order: VectorAtlas[] = [
    'arms',
    'whole',
    'env',
    'rings',
    'bars',
    'arcs',
    'shells',
    'trails',
    'penlines',
    'companions',
    'misc',
    'sstars',
  ];
  return order.flatMap((a) => by[a] ?? []);
}

/** GLSL smoothstep. */
export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** The drawn core fades out over `incE` 66–80 instead of vanishing at 80 (ADR 0073). */
export const CORE_FADE = [66, 80] as const;
/** The core's style (line to dotted) is swapped over `incE` 66–74, centred on v21's 70. */
export const CORE_STYLE = [66, 74] as const;

/** The drawn core's alpha factor at an inclination: 1 up to 66°, 0 from 80° (smoothstep). */
export function coreFade(e: number): number {
  return 1 - smoothstep(CORE_FADE[0], CORE_FADE[1], e);
}

/** The weight of the dotted core drawing over the line one: 1 when the style is always dotted. */
export function coreDottedMix(P: Params, e: number): number {
  return P.stipple > 0.5 && P.lines < 0.5 ? 1 : smoothstep(CORE_STYLE[0], CORE_STYLE[1], e);
}

/**
 * The drawn core (app23.js:L1028–1035): for a bulge between 0.03 and 0.97, not a Sérsic galaxy,
 * and not edge-on past 80°. The core drawing is picked by bulge strength among the `core` kind,
 * preferring the dotted style for stipple-heavy or steep views, scaled by bulge size and flattened
 * by max(bulgeFlat, |cos incl|), at alpha 0.9. With `nuclear`, the nuclear spiral (a `cores`
 * drawing of that kind, picked by the parts) laid on the disc at 0.9 of the core's size.
 *
 * Deviations from v21 (ADR 0073): the flattening uses |cos i| (v21's signed `ci()` squashed a core
 * seen from below), and the core fades out over `incE` 66–80 (`coreFade`) instead of vanishing at
 * 80°, while the line drawing hands over to the dotted one with complementary alphas over 66–74
 * (`coreDottedMix`) instead of swapping at 70°. The alternate drawing is emitted whenever the
 * styles differ and `incE` < 80, at alpha 0 outside the overlap, so the instance count (at most
 * core, alternate and nuclear: 3) does not change with the camera inside a structure bucket.
 */
export function coreInstances(
  P: Params,
  meta: DrawingsMeta,
  cam: Camera,
  field?: NoiseField | null,
  nuclear?: number | null,
): Instance[] {
  const e = incE(cam.incl);
  // a star or an artefact has no galaxy, so no core (render(), app23.js:L1230 empties them)
  if (P.subject !== 'galaxy') return [];
  if (!(P.bulge > 0.03 && P.bulge < 0.97) || (P.sersicN > 0 && P.bulge >= 0.95) || e >= 80)
    return [];
  const n = meta.cores.kind.filter((k) => k === 'core').length;
  if (n < 1) return [];
  const start = Math.min(n - 1, Math.floor(Math.pow(P.bulge, 0.6) * n));
  const styled = (want: string) => {
    for (let k = 0; k < n; k++) {
      const j = (start + k) % n;
      if (meta.cores.style[j] === want) return j;
    }
    return start;
  };
  const sc = UNIT_SCALE * cam.zoom;
  const s = sc * (0.32 + 0.8 * P.bulgeSize * Math.sqrt(P.bulge));
  const ci = Math.abs(Math.cos((cam.incl * Math.PI) / 180));
  const a = (cam.pa * Math.PI) / 180;
  const sy = s * Math.max(P.bulgeFlat, ci);
  // chain(Rm(pa), Sm(s, sy))
  const c = Math.cos(a);
  const sn = Math.sin(a);
  // a bitmap mark's centre goes through the hand wobble (inst, app23.js:L171)
  const [x, y] = smWarp(PLATE / 2, PLATE / 2, wobbleAmplitude(P.distort), field);
  const m: Instance['m'] = [c * s, sn * s, -sn * sy, c * sy];
  const alpha = 0.9 * coreFade(e);
  const dotted = coreDottedMix(P, e);
  const iLine = styled('line');
  const iDot = styled('dotted');
  const out: Instance[] = [];
  if (iLine === iDot) out.push({ x, y, layer: iLine, alpha, m });
  else if (P.stipple > 0.5 && P.lines < 0.5) out.push({ x, y, layer: iDot, alpha, m });
  else {
    out.push({ x, y, layer: iLine, alpha: alpha * (1 - dotted), m });
    out.push({ x, y, layer: iDot, alpha: alpha * dotted, m });
  }
  if (nuclear !== undefined && nuclear !== null && P.nuclear)
    out.push({ x, y, layer: nuclear, alpha, m: chain(discM(cam), Sm(s * 0.9, s * 0.9)) });
  return out;
}
