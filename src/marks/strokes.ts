/**
 * Pen strokes: the `strokes` sheet (60 strokes, each a 512 × 64 row, one texture-array layer each)
 * with its measured pen thickness and cut pieces, used to texture curve ribbons or to re-space
 * their dots and beads (reference `buildCurves`, app23.js:L802).
 *
 * `strokes.json` (assets/README.md): `kind` per row (plain, beaded, spurred, broken, dotted,
 * faint), `thick` (the ink's width in sheet pixels, 3–18), `pieces` (null, or the row's cut pieces
 * as [x, y, size, tile]: position along and across the row, size in sheet pixels, and the cell of
 * the `pieces` sheet), `src`.
 */

export interface StrokesMeta {
  kind: readonly string[];
  thick: readonly number[];
  pieces: readonly (readonly (readonly number[])[] | null)[];
  src: readonly string[];
  /** a row's size in sheet pixels (512 × 64) */
  w: number;
  h: number;
}

/** The stroke kinds `strokeIndex` is asked for. `mixed` is plain, beaded or spurred. */
export type StrokeKind =
  'mixed' | 'plain' | 'beaded' | 'spurred' | 'broken' | 'dotted' | 'faint' | (string & {});

/** The rows of each kind, in sheet order (the pools of `strokeIndex`, app23.js:L762). */
export function strokePools(kinds: readonly string[]): Map<string, number[]> {
  const pools = new Map<string, number[]>();
  kinds.forEach((k, i) => {
    let p = pools.get(k);
    if (!p) pools.set(k, (p = []));
    p.push(i);
  });
  pools.set(
    'mixed',
    kinds.flatMap((k, i) => (k === 'plain' || k === 'beaded' || k === 'spurred' ? [i] : [])),
  );
  return pools;
}

/**
 * The reference's `strokeIndex(kind, r)` (app23.js:L762): a row of that kind, picked by the uniform
 * `u` in [0, 1); every row when no row has that kind.
 */
export function strokeIndex(kind: StrokeKind, pools: Map<string, number[]>, u: number): number {
  const pool = pools.get(kind);
  if (pool?.length) return pool[Math.floor(u * pool.length)] ?? 0;
  // every row, in order
  let n = 0;
  pools.forEach((p, k) => {
    if (k !== 'mixed') n += p.length;
  });
  return Math.min(n - 1, Math.floor(u * n));
}
