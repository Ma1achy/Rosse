/**
 * The galaxy model, CPU side: turns parameters and the per-galaxy variation into the small
 * description the stipple kernel samples from (ADR 0003). It is shared, unchanged, by the WebGPU
 * engine (packed into buffers for src/shaders/compute/stipple.wgsl) and the CPU engine (read
 * directly by src/fallback/kernels/stipple.ts). Every number is rounded to f32 once, here.
 *
 * Reference: the set-up at the top of `generate` (app23.js:L175–181) and the globals it reads
 * (`P`, `VAR`, `PEN`, `RMAX`).
 */
import type { Params } from '../core/params';
import type { StructLayout } from '../marks/instance';
import { dotSprite, penWeights, type DrawingsMeta, type Variation } from './variation';
import { GROUP_STRIDE, markGroups, type MarkGroup, type RingKnotPick } from './clumps';
import { packNoise, type NoiseField } from '../core/noise';
import { bulgeIndex, bulgeIsSersic, psB } from './bulge';
import { effectiveDust } from './dust';

const f = Math.fround;

/**
 * v21 parity: `RMAX` is declared twice in the reference, as 4.2 (app23.js:L121) and as 240
 * (app23.js:L857); at run time it is 240, so the truncations meant for 4.2 never fire
 * (reference notes 20.7, open question Q13). We reproduce the visible behaviour.
 */
export const RMAX = 240;

/** The most arms a galaxy has (the control's range, 0–6). */
export const MAX_ARMS = 6;
/** Spurs: round(vary · (2 + 4u) · min(1, arms)) ≤ 6, with room to spare. */
export const MAX_SPURS = 8;
/** Dust patches: round(5 · vary · u) ≤ 5. */
export const MAX_DUST = 5;
/** Knot tiles per galaxy (makeVariation, app23.js:L114). */
export const KNOT_POOL = 24;

/** Layout of the `shape` buffer (vec4<f32> entries), shared with stipple.wgsl. */
export const SHAPE = {
  /** arm k: [pitch, amp, phase, rmax] at 2k, [wig, wf, wp, 0] at 2k + 1 */
  arms: 0,
  spurs: 2 * MAX_ARMS,
  dust: 2 * MAX_ARMS + MAX_SPURS,
  size: 2 * MAX_ARMS + MAX_SPURS + MAX_DUST,
} as const;

/** Galaxy flags. */
export const GalaxyFlag = {
  armsOn: 1,
  sersic: 2,
  bulgeSersic: 4,
  bulgePeanut: 8,
  starsSmooth: 16,
  thinDisc: 32,
} as const;

/** The fields of the `Galaxy` uniform of stipple.wgsl, in order: scalars only. */
const GALAXY_FIELDS = [
  ['seed', 'u32'],
  ['n', 'u32'],
  ['arms', 'u32'],
  ['n_var_arms', 'u32'],
  ['n_spurs', 'u32'],
  ['n_dust', 'u32'],
  ['n_dot_pool', 'u32'],
  ['n_knot_pool', 'u32'],
  ['n_star_tiles', 'u32'],
  ['flags', 'u32'],
  ['key', 'u32'],
  ['n_groups', 'u32'],
  ['c_bulge', 'f32'],
  ['c_halo', 'f32'],
  ['c_bar', 'f32'],
  ['c_ring', 'f32'],
  ['tot', 'f32'],
  ['bulge_a', 'f32'],
  ['bulge_flat', 'f32'],
  ['bar_len', 'f32'],
  ['ring_r', 'f32'],
  ['thick', 'f32'],
  ['pitch', 'f32'],
  ['arm_strength', 'f32'],
  ['arm_width', 'f32'],
  ['flocc', 'f32'],
  ['arm_r0', 'f32'],
  ['arm_inner', 'f32'],
  ['patchy', 'f32'],
  ['irr', 'f32'],
  ['sersic_n', 'f32'],
  ['sersic_b', 'f32'],
  ['re', 'f32'],
  ['dust', 'f32'],
  ['star_mix', 'f32'],
  ['knots', 'f32'],
  ['sparkle', 'f32'],
  ['pen_dot', 'f32'],
  ['lop', 'f32'],
  ['lop_a', 'f32'],
  ['warp', 'f32'],
  ['warp_a', 'f32'],
  ['rmax', 'f32'],
  ['n_extra', 'u32'],
  // the drawn stars' pools (M7): small and bright `sstars` drawings after the dot pool, and the
  // variation's spike direction (app23.js:L189)
  ['n_ss_small', 'u32'],
  ['n_ss_bright', 'u32'],
  ['spike', 'f32'],
  ['pad_g', 'u32'],
] as const;

export type GalaxyField = (typeof GALAXY_FIELDS)[number][0];

/** The `Galaxy` uniform of stipple.wgsl. */
export const GALAXY_LAYOUT: StructLayout = {
  name: 'Galaxy',
  size: GALAXY_FIELDS.length * 4,
  align: 4,
  fields: GALAXY_FIELDS.map(([name, type], i) => ({ name, type, offset: i * 4, size: 4 })),
};

/** The scalar part of the description, named as GALAXY_LAYOUT. */
export type GalaxyScalars = Record<GalaxyField, number>;

export interface GalaxyDesc {
  g: GalaxyScalars;
  /** SHAPE.size vec4s: arms, spurs, dust patches */
  shape: Float32Array<ArrayBuffer>;
  /**
   * knot pool (24), dot pool, then the drawn stars' pools (M7): the small `sstars` drawings and the
   * bright ones (outline kind) of `generate`'s `rstar`. A small drawing's high bit marks an
   * asterisk (its spin scatters more, app23.js:L189).
   */
  pool: Uint32Array<ArrayBuffer>;
  /** per dot tile: the quad size at k = 1 (dotSprite, app23.js:L81) */
  dotBase: Float32Array<ArrayBuffer>;
  /** ring knots and clumps (./clumps.ts), GROUP_LAYOUT; their marks follow the stipple's samples */
  groups: ArrayBuffer;
  /** the same, unpacked */
  groupList: MarkGroup[];
  /** the noise field (src/core/noise.ts): hashed for every salt unless a comparison gives tables */
  noise: NoiseField;
}

/** One ring-knot cluster or clump: the `Group` struct of stipple.wgsl. */
export const GROUP_LAYOUT: StructLayout = {
  name: 'Group',
  size: 32,
  align: 16,
  fields: [
    { name: 'c', type: 'vec3<f32>', offset: 0, size: 12 },
    { name: 's', type: 'f32', offset: 12, size: 4 },
    { name: 'first', type: 'u32', offset: 16, size: 4 },
    { name: 'count', type: 'u32', offset: 20, size: 4 },
    { name: 'rstars', type: 'u32', offset: 24, size: 4 },
    { name: 'tag', type: 'u32', offset: 28, size: 4 },
  ],
};
export const GROUP_WORDS = GROUP_LAYOUT.size / 4;

/** Packs the groups; `first` is each group's first extra sample. Returns the buffer and the total. */
export function packGroups(groups: readonly MarkGroup[]): { buf: ArrayBuffer; total: number } {
  const buf = new ArrayBuffer(Math.max(1, groups.length) * GROUP_LAYOUT.size);
  const fl = new Float32Array(buf);
  const u = new Uint32Array(buf);
  let first = 0;
  groups.forEach((g, i) => {
    const o = i * GROUP_WORDS;
    fl[o] = g.c[0];
    fl[o + 1] = g.c[1];
    fl[o + 2] = g.c[2];
    fl[o + 3] = g.s;
    u[o + 4] = first;
    u[o + 5] = Math.min(g.count, GROUP_STRIDE - 8);
    u[o + 6] = Math.min(g.rstars, 8);
    u[o + 7] = (g.kind & 0xff) | (g.id << 8);
    first += (u[o + 5] ?? 0) + (u[o + 6] ?? 0);
  });
  return { buf, total: first };
}

/**
 * An upper bound on the drawn stars (`rstar` samples) the proposals and the groups can make, with a
 * margin of 8 standard deviations: the capacity of the drawn stars' rows (src/model/dynvec.ts). A
 * star beyond it is dropped, in sample order, so the cut is deterministic.
 */
export function rstarBound(G: GalaxyDesc): number {
  const g = G.g;
  let extras = 0;
  for (const grp of G.groupList) extras += Math.min(grp.rstars, 8);
  if (!(g.star_mix > 0.01)) return extras;
  const sm = g.star_mix;
  const w = (a: number, b: number) => (g.tot > 0 ? Math.max(0, b - a) / g.tot : 0);
  const wBulge = w(0, g.c_bulge);
  const wBar = w(g.c_halo, g.c_bar);
  const wRing = w(g.c_bar, g.c_ring);
  const wDisc = w(g.c_ring, g.tot);
  const armsOn = (g.flags & GalaxyFlag.armsOn) !== 0;
  const sersic = (g.flags & GalaxyFlag.sersic) !== 0;
  let p = wBulge * (sersic ? 0.09 * sm : 0.34 * sm * 0.4);
  p += 0.34 * sm * (wBar * 0.85 + wRing * 1.6 + wDisc * (armsOn ? 1.35 : 0.85));
  p = Math.min(1, Math.max(0, p));
  const mean = g.n * p;
  return Math.min(g.n, Math.ceil(mean + 8 * Math.sqrt(mean) + 32)) + extras;
}

/** Every sample the stipple buffer holds: the proposals, then the ring knots' and clumps' marks. */
export function sampleCount(G: GalaxyDesc): number {
  return G.g.n + G.g.n_extra;
}

/** Number of stipple proposals: `round(stars · stipple · (1 + 0.28 · starMix))` (app23.js:L176). */
export function proposalCount(P: Params): number {
  const n = Math.round(P.stars * P.stipple * (1 + 0.28 * (P.starMix || 0)));
  // a thin disc draws half as many stars again: they are denser in the plane (ADR 0083)
  return P.thinAuto > 0 ? Math.round(n * 1.5) : n;
}

/**
 * `opts.key`: the placement key (the seed by default), which keys the stipple's sampling and the
 * groups' own draws; `opts.ringKnots`: v21's ring-knot clusters (ADR 0018).
 */
export function describeGalaxy(
  P: Params,
  V: Variation,
  meta: DrawingsMeta,
  opts: { key?: number; ringKnots?: readonly RingKnotPick[] } = {},
): GalaxyDesc {
  const key = (opts.key ?? P.seed) >>> 0;
  const wb = P.bulge;
  const wh = P.halo * 0.25;
  const wbar = P.bar * 0.4 * (1 - P.bulge);
  const wring = P.ring * 0.34 * (1 - P.bulge);
  const wd = Math.max(0, 1 - wb - wh - wbar - wring);
  const armsOn = P.arms >= 1 && P.bulge < 0.98;
  const sersic = P.sersicN > 0 && P.bulge >= 0.95;
  const bulgeSersic = bulgeIsSersic(P);
  const nB = bulgeSersic ? bulgeIndex(P) : P.sersicN;
  const barred = P.bar > 0.05;
  const penDot = penWeights(P.pen).dot;
  const nVar = Math.min(MAX_ARMS, V.arms.length);

  const g: GalaxyScalars = {
    seed: P.seed >>> 0,
    n: proposalCount(P),
    arms: Math.min(MAX_ARMS, Math.max(0, Math.floor(P.arms))),
    n_var_arms: nVar,
    n_spurs: Math.min(MAX_SPURS, V.spurs.length),
    n_dust: Math.min(MAX_DUST, V.dust.length),
    n_dot_pool: V.dotPool.length,
    n_knot_pool: KNOT_POOL,
    n_star_tiles: meta.stars.count,
    flags:
      (armsOn ? GalaxyFlag.armsOn : 0) |
      (sersic ? GalaxyFlag.sersic : 0) |
      (bulgeSersic ? GalaxyFlag.bulgeSersic : 0) |
      (bulgeSersic && barred ? GalaxyFlag.bulgePeanut : 0) |
      (P.starsAuto > 0 ? GalaxyFlag.starsSmooth : 0) |
      (P.thinAuto > 0 ? GalaxyFlag.thinDisc : 0),
    key,
    n_groups: 0,
    c_bulge: f(wb),
    c_halo: f(wb + wh),
    c_bar: f(wb + wh + wbar),
    c_ring: f(wb + wh + wbar + wring),
    tot: f(wb + wh + wbar + wring + wd),
    bulge_a: f(0.22 * P.bulgeSize),
    bulge_flat: f(P.bulgeFlat),
    bar_len: f(P.barLen),
    ring_r: f(P.ringR),
    thick: f(P.thick),
    pitch: f(P.pitch),
    arm_strength: f(P.armStrength),
    arm_width: f(P.armWidth),
    flocc: f(P.flocc),
    arm_r0: f(barred ? Math.max(0.2, P.barLen) : 0.25),
    arm_inner: f(barred ? P.barLen : 0.3),
    patchy: f(P.patchy),
    irr: f(P.irr),
    sersic_n: f(nB),
    sersic_b: f(bulgeSersic ? psB(nB) : 2 * P.sersicN - 1 / 3),
    re: f(P.re),
    dust: f(effectiveDust(P)),
    star_mix: f(P.starMix || 0),
    knots: f(P.knots),
    sparkle: f(P.sparkle),
    pen_dot: f(penDot),
    lop: f(V.lop),
    lop_a: f(V.lopA),
    warp: f(V.warp),
    warp_a: f(V.warpA),
    rmax: f(RMAX),
    n_extra: 0,
    n_ss_small: 0,
    n_ss_bright: 0,
    spike: f(V.spike),
    pad_g: 0,
  };
  const groupList = markGroups(P, V, key, opts.ringKnots);
  const packed = packGroups(groupList);
  g.n_groups = groupList.length;
  g.n_extra = packed.total;

  const shape = new Float32Array(SHAPE.size * 4);
  V.arms.slice(0, MAX_ARMS).forEach((a, k) => {
    shape.set([a.pitch, a.amp, a.phase, a.rmax, a.wig, a.wf, a.wp, 0], (SHAPE.arms + 2 * k) * 4);
  });
  V.spurs.slice(0, MAX_SPURS).forEach((s, i) => {
    shape.set([s.k, s.R0, s.len, s.pk], (SHAPE.spurs + i) * 4);
  });
  V.dust.slice(0, MAX_DUST).forEach((d, i) => {
    shape.set([d.R, d.th, d.s, 0], (SHAPE.dust + i) * 4);
  });

  const ss = starPools(meta, false);
  g.n_ss_small = ss.small.length;
  g.n_ss_bright = ss.bright.length;
  const pool = new Uint32Array(KNOT_POOL + V.dotPool.length + ss.small.length + ss.bright.length);
  pool.set(V.knotPool.slice(0, KNOT_POOL), 0);
  pool.set(V.dotPool, KNOT_POOL);
  pool.set(ss.small, KNOT_POOL + V.dotPool.length);
  pool.set(ss.bright, KNOT_POOL + V.dotPool.length + ss.small.length);

  const dotBase = new Float32Array(meta.dots.size.map((s) => dotSprite(s, penDot, 1)));
  return { g, shape, pool, dotBase, groups: packed.buf, groupList, noise: packNoise() };
}

/** High bit of a small drawn-star tile in the pool: an asterisk. */
export const STAR_ASTERISK = 0x80000000;

/**
 * The `sstars` drawings split into small and bright (generate, app23.js:L181–182: bright are the
 * `outline` kind; starSprites, L401: `outline` and `burst`). Entries are tile indices, a small
 * asterisk's with `STAR_ASTERISK`.
 */
export function starPools(
  meta: DrawingsMeta,
  sprites: boolean,
): { small: number[]; bright: number[] } {
  const kinds = meta.vectors?.sstars?.kind ?? [];
  const small: number[] = [];
  const bright: number[] = [];
  kinds.forEach((k, i) => {
    if (k === 'outline' || (sprites && k === 'burst')) bright.push(i);
    else small.push(k === 'asterisk' ? (i | STAR_ASTERISK) >>> 0 : i);
  });
  return { small, bright };
}

/** The Galaxy uniform as bytes. */
export function packGalaxy(g: GalaxyScalars): ArrayBuffer {
  const buf = new ArrayBuffer(GALAXY_LAYOUT.size);
  const u = new Uint32Array(buf);
  const fl = new Float32Array(buf);
  for (const field of GALAXY_LAYOUT.fields) {
    const v = g[field.name as GalaxyField];
    if (field.type === 'u32') u[field.offset / 4] = v;
    else fl[field.offset / 4] = v;
  }
  return buf;
}
