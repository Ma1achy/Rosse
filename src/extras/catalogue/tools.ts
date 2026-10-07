/**
 * The catalogue browser's tools, as pure functions of a decoded catalogue: the types of v21's
 * buttons (`TYPES`, app23.js:L1797), random, find by object id or position (`findGalaxy`, L1817),
 * and the search and filter v21 does not have: any field's range, and a cone round a position.
 *
 * Thresholds are in bytes, as v21 writes them (`c.spiral[i] > 10` is a vote fraction above 10/15);
 * the same numbers, so a type picks the same galaxies. `randomOf` takes the random source as an
 * argument (v21 uses `Math.random` with up to 400,000 rejection tries): it picks uniformly among
 * every match in one scan, so it never gives up on a rare type while one exists.
 */
import type { Catalogue } from './decode';
import { fieldValue, type Field } from './fields';

type Cols = Catalogue['cols'];
type Test = (i: number, c: Cols) => boolean;

const col = (c: Cols, f: string, i: number): number => (c[f] as Uint8Array)[i] as number;

/** v21's `TYPES`, in v21's order. */
export const GALAXY_TYPES = {
  any: () => true,
  'a spiral': (i, c) => col(c, 'spiral', i) > 10 && col(c, 'feat', i) > 9,
  barred: (i, c) => col(c, 'bar', i) > 11,
  'edge-on': (i, c) => col(c, 'edge', i) > 12,
  smooth: (i, c) => col(c, 'smooth', i) > 12,
  merger: (i, c) => col(c, 'odd', i) > 9 && col(c, 'merger', i) > 9,
  ring: (i, c) => col(c, 'odd', i) > 9 && col(c, 'ring', i) > 10,
  irregular: (i, c) => col(c, 'odd', i) > 9 && col(c, 'irregular', i) > 9,
  'many arms': (i, c) =>
    col(c, 'spiral', i) > 10 && (col(c, 'amore', i) > 7 || col(c, 'a4', i) > 7),
  'tight arms': (i, c) => col(c, 'spiral', i) > 10 && col(c, 'tight', i) > 10,
  'loose arms': (i, c) => col(c, 'spiral', i) > 10 && col(c, 'loose', i) > 9,
} as const satisfies Record<string, Test>;

export type GalaxyType = keyof typeof GALAXY_TYPES;
export const GALAXY_TYPE_NAMES = Object.keys(GALAXY_TYPES) as GalaxyType[];

/** The indices of every galaxy of a type, ascending. */
export function ofType(cat: Catalogue, type: GalaxyType, limit = Infinity): number[] {
  const f: Test = GALAXY_TYPES[type];
  const out: number[] = [];
  for (let i = 0; i < cat.n && out.length < limit; i++) if (f(i, cat.cols)) out.push(i);
  return out;
}

/**
 * A galaxy of a type, uniformly among its matches (null if there are none).
 * @param rand a uniform [0, 1) source, e.g. `Math.random`
 */
export function randomOf(cat: Catalogue, type: GalaxyType, rand: () => number): number | null {
  const f: Test = GALAXY_TYPES[type];
  let count = 0;
  for (let i = 0; i < cat.n; i++) if (f(i, cat.cols)) count++;
  if (!count) return null;
  let k = Math.min(count - 1, Math.floor(rand() * count));
  for (let i = 0; i < cat.n; i++) if (f(i, cat.cols) && k-- === 0) return i;
  return null;
}

/** The index of a DR7 object id, or -1. The ids are ascending, so this is a binary search. */
export function indexOfObjid(cat: Catalogue, id: bigint): number {
  let lo = 0;
  let hi = cat.n - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = cat.objid[mid] as bigint;
    if (v === id) return mid;
    if (v < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** The galaxy nearest a position (degrees), by v21's flat metric (RA scaled by cos Dec). */
export function nearest(
  cat: Catalogue,
  ra: number,
  dec: number,
): { index: number; arcsec: number } | null {
  let best = -1;
  let bd = 1e9;
  const cd = Math.cos((dec * Math.PI) / 180);
  for (let k = 0; k < cat.n; k++) {
    const dx = ((cat.ra[k] as number) - ra) * cd;
    const dy = (cat.dec[k] as number) - dec;
    const d = dx * dx + dy * dy;
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  return best < 0 ? null : { index: best, arcsec: Math.sqrt(bd) * 3600 };
}

/** v21's reach for a position: within one arcminute. */
export const FIND_RADIUS_ARCSEC = 60;

export type FindResult =
  | { kind: 'galaxy'; index: number }
  | { kind: 'none'; message: string }
  | { kind: 'help'; message: string };

/** v21's `findGalaxy(text)`: a DR7 object id (15 to 20 digits), or "RA, Dec" in degrees. */
export function find(cat: Catalogue, text: string): FindResult {
  const t = text.trim();
  const m = t.match(/^(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)$/);
  if (/^\d{15,20}$/.test(t)) {
    const i = indexOfObjid(cat, BigInt(t));
    return i >= 0
      ? { kind: 'galaxy', index: i }
      : { kind: 'none', message: 'No Galaxy Zoo 2 galaxy with that DR7 objid.' };
  }
  if (m) {
    const n = nearest(cat, +(m[1] as string), +(m[2] as string));
    return n && n.arcsec < FIND_RADIUS_ARCSEC
      ? { kind: 'galaxy', index: n.index }
      : { kind: 'none', message: 'No Galaxy Zoo 2 galaxy within 1 arcminute of that position.' };
  }
  return {
    kind: 'help',
    message: 'Type a DR7 objid, or RA and Dec in degrees, like 185.72, 15.82.',
  };
}

/** A range on one field, in the field's own units (fractions for votes; see ./fields.ts). */
export interface Criterion {
  field: Field;
  /** Inclusive lower bound. */
  min?: number;
  /** Inclusive upper bound. */
  max?: number;
}

export interface Query {
  /** A type of v21's buttons the galaxy must be. */
  type?: GalaxyType;
  /** Every criterion must hold. A galaxy with no value for the field (q, conc, ... missing) fails it. */
  where?: Criterion[];
  /** A cone: within `radiusArcsec` of (ra, dec), degrees. */
  cone?: { ra: number; dec: number; radiusArcsec: number };
  /** Skip this many matches (paging), then return at most `limit`. */
  offset?: number;
  limit?: number;
}

export interface QueryResult {
  /** The matching indices on this page, ascending. */
  indices: Uint32Array;
  /** How many galaxies match in all. */
  total: number;
}

/** Filter the catalogue: type, field ranges and a cone, with paging. One scan of 240k rows. */
export function filter(cat: Catalogue, q: Query): QueryResult {
  const test: Test | null = q.type ? GALAXY_TYPES[q.type] : null;
  const where = q.where ?? [];
  const cone = q.cone;
  const cd = cone ? Math.cos((cone.dec * Math.PI) / 180) : 1;
  const r2 = cone ? (cone.radiusArcsec / 3600) ** 2 : 0;
  const offset = q.offset ?? 0;
  const limit = q.limit ?? 100;
  const page: number[] = [];
  let total = 0;
  scan: for (let i = 0; i < cat.n; i++) {
    if (test && !test(i, cat.cols)) continue;
    if (cone) {
      const dx = ((cat.ra[i] as number) - cone.ra) * cd;
      const dy = (cat.dec[i] as number) - cone.dec;
      if (dx * dx + dy * dy > r2) continue;
    }
    for (const c of where) {
      const v = fieldValue(cat, c.field, i);
      if (
        v === undefined ||
        (c.min !== undefined && v < c.min) ||
        (c.max !== undefined && v > c.max)
      )
        continue scan;
    }
    if (total >= offset && page.length < limit) page.push(i);
    total++;
  }
  return { indices: Uint32Array.from(page), total };
}
