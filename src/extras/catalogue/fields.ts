/**
 * Byte to value, field by field, as `decode_gz2_catalogue.py` documents and v21 (`catVotes`,
 * `catExtra`, `showCat`, app23.js:L1784–1792) uses:
 *
 *   vote fractions (smooth ... acant):  byte / 15        (0 to 17: above 1 is rounding headroom)
 *   q (axis ratio b/a):                 (byte - 1) / 254, 0 = missing (v21 uses 0.8)
 *   pa (position angle, degrees):       byte / 255 * 180
 *   wind (Galaxy Zoo 1 winding):        signed byte / 127 (|w| > 0.25 is a winding sense)
 *   nvotes:                             byte (volunteers, capped at 255)
 *   conc: byte / 60 + 1   r90: byte / 4   gr: byte / 170 - 0.3   z: byte / 800
 *   fdev: (byte - 1) / 254                (0 = missing for conc, r90, gr, z, fdev)
 */
import type { Extras, Votes } from '../from-votes';
import { catalogueSeed } from '../from-votes';
import type { Catalogue } from './decode';

/** The columns that are not vote fractions. */
export const MEASURE_FIELDS = [
  'q',
  'pa',
  'wind',
  'nvotes',
  'conc',
  'r90',
  'gr',
  'z',
  'fdev',
] as const;
export type MeasureField = (typeof MEASURE_FIELDS)[number];

/** The vote columns, in storage order (they are the first 30). */
export const VOTE_FIELDS = [
  'smooth',
  'feat',
  'star',
  'edge',
  'bar',
  'spiral',
  'b0',
  'b1',
  'b2',
  'b3',
  'odd',
  'ring',
  'lens',
  'disturbed',
  'irregular',
  'other',
  'merger',
  'dust',
  'bround',
  'bboxy',
  'bnone',
  'tight',
  'medium',
  'loose',
  'a1',
  'a2',
  'a3',
  'a4',
  'amore',
  'acant',
] as const;
export type VoteField = (typeof VOTE_FIELDS)[number];

export type Field = VoteField | MeasureField;

/** The value of one field of one galaxy, or undefined where the catalogue has none (0 = missing). */
export function fieldValue(cat: Catalogue, field: Field, i: number): number | undefined {
  const b = (cat.cols[field] as Uint8Array)[i] as number;
  switch (field) {
    case 'q':
    case 'fdev':
      return b ? (b - 1) / 254 : undefined;
    case 'pa':
      return (b / 255) * 180;
    case 'wind':
      return ((b << 24) >> 24) / 127;
    case 'nvotes':
      return b;
    case 'conc':
      return b ? b / 60 + 1 : undefined;
    case 'r90':
      return b ? b / 4 : undefined;
    case 'gr':
      return b ? b / 170 - 0.3 : undefined;
    case 'z':
      return b ? b / 800 : undefined;
    default:
      return b / 15;
  }
}

/** v21's `catVotes(i)`: every vote field as a fraction. */
export function votesAt(cat: Catalogue, i: number): Votes {
  const v: Record<string, number> = {};
  for (const f of VOTE_FIELDS) v[f] = ((cat.cols[f] as Uint8Array)[i] as number) / 15;
  return v as unknown as Votes;
}

/** v21's `catExtra(i)`: the measurements the catalogue has (a missing one is left out). */
export function extrasAt(cat: Catalogue, i: number): Extras {
  const c = cat.cols;
  const o: Extras = {};
  if ((c.conc as Uint8Array)[i]) o.conc = fieldValue(cat, 'conc', i) as number;
  if ((c.r90 as Uint8Array)[i]) o.r90 = fieldValue(cat, 'r90', i) as number;
  if ((c.gr as Uint8Array)[i]) o.gr = fieldValue(cat, 'gr', i) as number;
  if ((c.z as Uint8Array)[i]) o.z = fieldValue(cat, 'z', i) as number;
  if ((c.fdev as Uint8Array)[i]) o.fdev = fieldValue(cat, 'fdev', i) as number;
  return o;
}

/** Everything v21's `showCat(i)` hands to `fromVotes` and `describe`, for one galaxy. */
export interface CatalogueGalaxy {
  index: number;
  /** The DR7 object id, as the decimal string v21 shows. */
  objid: string;
  ra: number;
  dec: number;
  votes: Votes;
  /** Volunteers, capped at 255. */
  n: number;
  /** Axis ratio (0.8 where the catalogue has none, as v21). */
  q: number;
  /** Position angle in degrees. */
  pa: number;
  /** Winding, or 0 where |w| is not above 0.25 (`g.wind` of `showCat`). */
  wind: number;
  /** The winding sense `fromVotes` takes: -1, 0 or 1. */
  windSign: number;
  extras: Extras;
  /** The drawing's seed, from the object id. */
  seed: number;
}

/** v21's `showCat(i)` up to the call of `fromVotes` (app23.js:L1788–1790). */
export function galaxyAt(cat: Catalogue, i: number): CatalogueGalaxy {
  if (!(i >= 0 && i < cat.n && Number.isInteger(i))) throw new RangeError(`no galaxy ${String(i)}`);
  const qb = (cat.cols.q as Uint8Array)[i] as number;
  const w = ((((cat.cols.wind as Uint8Array)[i] as number) << 24) >> 24) / 127;
  const strong = Math.abs(w) > 0.25;
  const id = cat.objid[i] as bigint;
  return {
    index: i,
    objid: id.toString(),
    ra: cat.ra[i] as number,
    dec: cat.dec[i] as number,
    votes: votesAt(cat, i),
    n: (cat.cols.nvotes as Uint8Array)[i] as number,
    q: qb ? (qb - 1) / 254 : 0.8,
    pa: (((cat.cols.pa as Uint8Array)[i] as number) / 255) * 180,
    wind: strong ? w : 0,
    windSign: strong ? Math.sign(w) : 0,
    extras: extrasAt(cat, i),
    seed: catalogueSeed(id),
  };
}
