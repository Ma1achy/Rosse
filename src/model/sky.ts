/**
 * The sky around the galaxy: the deep field of background galaxies, foreground stars and
 * companions, placed in 3D and seen through a perspective camera. Equivalent of `buildSky` and
 * `skyParts` (app23.js:L867–920).
 *
 * The **catalogue** is the model tier (a few hundred kilobytes at most, built on the CPU, ADR 0003
 * and docs/architecture.md): up to 6,000 background galaxies, each a position in a shell round the
 * galaxy (40–240 units), a plane normal, a drawing from the pool (`whole`, `env`, `companions`,
 * `arms`), a radius, a spin, a number of arms and a bulge fraction (`buildSky`, L867–877); and up
 * to 2,500 foreground stars at a radius of about 42 units. v21 draws it from one sequential stream
 * (`mulberry32(P.seed · 1013 + 71)`) in a fixed order of 11 numbers per galaxy, so the catalogue is
 * replayable exactly: the golden runner passes v21's own (`SceneOptions.sky`,
 * tests/golden/compare/v21-sky.ts), as it passes v21's variation and part picks. The engine's own is
 * drawn from the counter-based `sky` stream, one index per galaxy (ADR 0004).
 *
 * The **view tier** (compute/sky.wgsl, CPU twin src/fallback/kernels/sky.ts) projects the
 * catalogue through the perspective camera (CAM 30), culls what is off the plate, and for each
 * galaxy that is left draws its dots (`np` = clamp(2.2 · apparent radius, 10, 150), each a point of
 * a small 3D disc and bulge) and places its drawing on the disc plane at pen scale 0.42 (`orient`,
 * `massive` galaxies shear it round a mass, L902). The companions (1–4, at about 4 units, in front
 * of or behind the galaxy) are a few rows laid out on the CPU with the placed parts.
 *
 * Weak lensing of the field (v21 `LENSWL`, L1273–1278) is M9's: the rows the sky writes carry the
 * `post` warp slot the vector expansion already has (src/model/vectors.ts `WarpKind.post`), and
 * `compute/dyn-rows.wgsl` `rows_sky` calls `weak_lens(row)`, the identity today.
 */
import type { Params } from '../core/params';
import { Draws } from '../core/rng';
import { Stream } from '../core/streams';
import type { PackedVectors, VectorAtlas } from '../marks/vector';
import { SKY_RMAX, SKY_RMIN, R_FG } from '../view/camera';
import { sheetStrides, type DynSpec } from './dynvec';
import type { DrawingsMeta } from './variation';

const f = Math.fround;

/** The sheets a background galaxy's drawing is picked from, in v21's order (`fpool`, L870). */
export const SKY_SHEETS = [
  'whole',
  'env',
  'companions',
  'arms',
] as const satisfies readonly VectorAtlas[];

/** The foreground stars' ball with `depthAuto`, galaxy units (ADR 0090). */
export const FG_NEAR = 3;
export const FG_FAR = 26;

/** The most background galaxies and foreground stars (L871, L874). */
export const SKY_BG_MAX = 6000;
export const SKY_FG_MAX = 2500;

/** `np`, the dots of a galaxy: clamp(2.2 · apparent radius, 10, 150) (L890). */
export const SKY_NP_MIN = 10;
export const SKY_NP_MAX = 150;
/** Dot slots per visible galaxy in the buffers (a galaxy's unused slots draw nothing). */
export const SKY_DOTS_PER_GALAXY = SKY_NP_MAX;

/** Floats per catalogue entry of a background galaxy: w (3), rad, n (3), spin, item, na, bulge, pad. */
export const BG_WORDS = 12;
/** Floats per foreground star: w (3), size, rot, tile, pad (2). */
export const FG_WORDS = 8;

/** A background galaxy of the catalogue (`buildSky`, L872–873). */
export interface BgGalaxy {
  /** its position, galaxy units */
  w: [number, number, number];
  /** its plane's normal */
  n: [number, number, number];
  /** the drawing, an index into the item list */
  item: number;
  rad: number;
  spin: number;
  na: number;
  bulge: number;
}

/** A foreground star (L875). */
export interface FgStar {
  w: [number, number, number];
  tile: number;
  size: number;
  rot: number;
}

/** A companion (L913–919): its position, plane normal, drawing, scale and spin. */
export interface CompanionPick {
  w: [number, number, number];
  n: [number, number, number];
  tile: number;
  /** the scale over VIEW.scale: 0.8 + 0.8 u */
  scale: number;
  spin: number;
}

export interface SkyCatalogue {
  bg: BgGalaxy[];
  fg: FgStar[];
  companions: CompanionPick[];
}

/** The drawings background galaxies are picked from: [sheet, tile] in v21's order. */
export function skyItems(lib: PackedVectors, meta: DrawingsMeta): number[] {
  const out: number[] = [];
  for (const sheet of SKY_SHEETS) {
    const n = meta.vectors?.[sheet]?.n ?? 0;
    for (let i = 0; i < n; i++) out.push(lib.first[sheet] + i);
  }
  return out;
}

/** How many background galaxies, foreground stars and companions the parameters ask for. */
export function skyCounts(P: Params): { bg: number; fg: number; companions: number } {
  return {
    bg: P.field > 0.02 ? Math.min(SKY_BG_MAX, Math.round((P.field * 26) / 0.0145)) : 0,
    fg:
      P.fgstars > 0.02
        ? Math.min(SKY_FG_MAX, Math.round((P.fgstars * 7 * (P.depthAuto > 0 ? 4 : 1)) / 0.021))
        : 0,
    companions: P.companions > 0.05 ? Math.round(1 + 3 * P.companions) : 0,
  };
}

const unit3 = (r: Draws): [number, number, number] => {
  const z = f(f(2 * r.f32()) - 1);
  const t = f(r.f32() * f(6.28318));
  const q = f(Math.sqrt(f(1 - f(z * z))));
  return [f(q * f(Math.cos(t))), f(q * f(Math.sin(t))), z];
};

/** The engine's own catalogue, from the counter-based `sky` stream (one index per entry). */
export function ownCatalogue(
  P: Params,
  nItems: number,
  nTiles: { fgstars: number; companions: number },
  key: number,
): SkyCatalogue {
  const c = skyCounts(P);
  const cube = (x: number) => x * x * x;
  const bg: BgGalaxy[] = [];
  for (let b = 0; b < c.bg; b++) {
    const r = new Draws(key, Stream.sky, b);
    const u = unit3(r);
    const R = f(Math.cbrt(cube(SKY_RMIN) + r.f32() * (cube(SKY_RMAX) - cube(SKY_RMIN))));
    const n = unit3(r);
    const item = Math.min(nItems - 1, Math.floor(r.f32() * nItems));
    const rad = f(1.4 + f(3.2 * f(Math.pow(r.f32(), 1.4))));
    const spin = f(r.f32() * f(6.28));
    const na = 2 + (r.f32() < 0.3 ? 1 : 0);
    const bulge = f(0.15 + f(0.35 * r.f32()));
    bg.push({ w: [f(u[0] * R), f(u[1] * R), f(u[2] * R)], n, item, rad, spin, na, bulge });
  }
  const fg: FgStar[] = [];
  for (let i = 0; i < c.fg; i++) {
    const r = new Draws(key, Stream.sky, (1 << 24) + i);
    const u = unit3(r);
    // v21 parity: the radius factor is drawn afresh for each coordinate (`unit3(r).map(x · R_FG ·
    // (0.85 + 0.3 r()))`, app23.js:L875), so the stars lie in a thick shell, not on a sphere
    let fx = f(R_FG * f(0.85 + f(0.3 * r.f32())));
    let fy = f(R_FG * f(0.85 + f(0.3 * r.f32())));
    let fz = f(R_FG * f(0.85 + f(0.3 * r.f32())));
    if (P.depthAuto > 0) {
      // a shell of v21's radius lies outside the camera's cone, so the slider drew nothing: with
      // `depthAuto` the stars fill a ball round the galaxy, near enough to be seen (ADR 0090)
      fx = fy = fz = f(FG_NEAR + f(f(FG_FAR - FG_NEAR) * Math.cbrt(f(0.05 + 0.95 * r.f32()))));
    }
    const tile = Math.floor(r.f32() * nTiles.fgstars);
    const size = f(16 + f(26 * r.f32()));
    const rot = f(f(r.f32() - 0.5) * f(0.6));
    fg.push({ w: [f(u[0] * fx), f(u[1] * fy), f(u[2] * fz)], tile, size, rot });
  }
  const companions: CompanionPick[] = [];
  for (let i = 0; i < c.companions; i++) {
    const r = new Draws(key, Stream.sky, (2 << 24) + i);
    const u = unit3(r);
    const rad = f(3.4 + f(1.2 * r.f32()));
    const n = unit3(r);
    const tile = Math.min(nTiles.companions - 1, Math.floor(r.f32() * nTiles.companions));
    const scale = f(0.8 + f(0.8 * r.f32()));
    const spin = f(r.f32() * f(6.28));
    companions.push({
      w: [f(u[0] * rad), f(u[1] * rad), f(f(u[2] * rad) * f(0.7))],
      n,
      tile,
      scale,
      spin,
    });
  }
  return { bg, fg, companions };
}

/** The model tier's sky. */
export interface SkyDesc {
  catalogue: SkyCatalogue;
  /** the drawings a galaxy's `item` indexes: library drawing indices, with their arms flag in bit 31 */
  items: Uint32Array<ArrayBuffer>;
  /** the catalogue as the kernels read it */
  bgBuf: Float32Array<ArrayBuffer>;
  fgBuf: Float32Array<ArrayBuffer>;
  nBg: number;
  nFg: number;
  /** the deep field's drawings: rows (3 per visible galaxy at most) and their slots */
  spec: DynSpec;
  /** the most galaxies the buffers of one view hold */
  visCap: number;
  /** shears the drawings round a mass (`massive`, L879): a bulge, a lens, a merger, a Sérsic galaxy */
  massive: boolean;
  /** foreground star tiles in the atlas */
  fgTiles: number;
}

/** The arms flag of an item: its drawing is an `arms` drawing, copied `na` times round the centre. */
export const ARMS_FLAG = 0x80000000;

/** Rows per galaxy: an `arms` drawing is copied up to 3 times (`na`), the others once (L903). */
export const SKY_ROWS_PER_GALAXY = 3;

/**
 * The most galaxies one view holds, for the buffers. At the deep field's strongest (field 1,
 * 1,793 galaxies) a view shows 449 at most, at the smallest zoom (0.15), a quarter of them, and 37
 * at zoom 1 (measured over four orientations, docs/milestones/m7); 35% and 32 more leave a wide
 * margin. A galaxy beyond the capacity is dropped in catalogue order, so the cut is deterministic.
 */
export function visibleCapacity(nBg: number): number {
  return Math.min(nBg, Math.ceil(nBg * 0.35) + 32);
}

/** The catalogue as the kernels read it: BG_WORDS floats per galaxy. */
export function packBg(bg: readonly BgGalaxy[]): Float32Array<ArrayBuffer> {
  const out = new Float32Array(Math.max(1, bg.length) * BG_WORDS);
  bg.forEach((g, i) => {
    const o = i * BG_WORDS;
    out.set(g.w.map(f), o);
    out[o + 3] = f(g.rad);
    out.set(g.n.map(f), o + 4);
    out[o + 7] = f(g.spin);
    new Uint32Array(out.buffer)[o + 8] = g.item;
    out[o + 9] = g.na;
    out[o + 10] = f(g.bulge);
  });
  return out;
}

export function packFg(fg: readonly FgStar[]): Float32Array<ArrayBuffer> {
  const out = new Float32Array(Math.max(1, fg.length) * FG_WORDS);
  fg.forEach((g, i) => {
    const o = i * FG_WORDS;
    out.set(g.w.map(f), o);
    out[o + 3] = f(g.size);
    out[o + 4] = f(g.rot);
    new Uint32Array(out.buffer)[o + 5] = g.tile;
  });
  return out;
}

/**
 * The sky of the parameters: the catalogue (the engine's own or `given`, v21's for the golden
 * runner), and the capacities of one view. null when nothing is asked for.
 */
export function describeSky(
  P: Params,
  meta: DrawingsMeta,
  lib: PackedVectors,
  fgTiles: number,
  key: number,
  given?: SkyCatalogue,
): SkyDesc | null {
  const c = skyCounts(P);
  if (!c.bg && !c.fg && !c.companions) return null;
  const items = skyItems(lib, meta);
  // without the foreground stars' sheet (or the drawings) there is nothing to draw of them
  if (!fgTiles) c.fg = 0;
  if (!items.length) c.bg = 0;
  const armsFirst = lib.first.arms;
  const armsEnd = armsFirst + (meta.vectors?.arms?.n ?? 0);
  const itemWords = Uint32Array.from(
    items.map((d) => (d >= armsFirst && d < armsEnd ? (d | ARMS_FLAG) >>> 0 : d)),
  );
  const cat: SkyCatalogue = given
    ? {
        bg: items.length ? given.bg : [],
        fg: fgTiles ? given.fg : [],
        companions: given.companions,
      }
    : ownCatalogue(
        { ...P, field: c.bg ? P.field : 0, fgstars: c.fg ? P.fgstars : 0 },
        Math.max(1, items.length),
        { fgstars: fgTiles, companions: meta.vectors?.companions?.n ?? 0 },
        key,
      );
  const strides = sheetStrides(lib, SKY_SHEETS);
  const visCap = visibleCapacity(cat.bg.length);
  return {
    catalogue: cat,
    items: itemWords.length ? itemWords : new Uint32Array(1),
    bgBuf: packBg(cat.bg),
    fgBuf: packFg(cat.fg),
    nBg: cat.bg.length,
    nFg: cat.fg.length,
    spec: { rows: visCap * SKY_ROWS_PER_GALAXY, ...strides },
    visCap,
    massive: P.bulge > 0.5 || !!P.lensOn || !!P.merger || P.sersicN > 0,
    fgTiles,
  };
}
