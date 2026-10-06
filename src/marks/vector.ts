/**
 * Vector drawings (ADR 0006): records of lines (`l`), dots (`d`) and blobs (`b`) in a unit tile
 * from −0.5 to 0.5 (assets/README.md). M4 reads one sheet, `penlines`, on the CPU: its pen lines
 * hatch the dust lanes (packed as capsule segments for the GPU in src/model/ribbons.ts) and their
 * longest polylines carve the stipple (`dustLines`). The general packing of every sheet into
 * shared segment, dot and blob buffers, with GPU expansion, is M5.
 */

export interface VectorRecord {
  /** polylines, each a flat list [x0, y0, x1, y1, …] */
  l: number[][];
  /** dots [x, y, r] */
  d: number[][];
  /** blobs [cx, cy, rx, ry, θ] */
  b: number[][];
}

/** A vector sheet as packed (assets-built/vector/<name>.json). */
export interface VectorSheet {
  n: number;
  src: string[];
  vec: VectorRecord[];
}

/** The reference's `longestLine(v)` (app23.js:L847): the polyline of a record with the longest path. */
export function longestLine(v: VectorRecord): number[] | null {
  let best: number[] | null = null;
  let bl = 0;
  for (const fl of v.l) {
    let L = 0;
    for (let i = 2; i < fl.length; i += 2)
      L += Math.hypot((fl[i] ?? 0) - (fl[i - 2] ?? 0), (fl[i + 1] ?? 0) - (fl[i - 1] ?? 0));
    if (L > bl) {
      bl = L;
      best = fl;
    }
  }
  return best;
}

/**
 * The reference's `lineParam(fl)` (app23.js:L848–851): the points of a polyline as (s, d), with s
 * the x position normalised to 0–1 and d the offset from the mean y, sorted by s.
 */
export function lineParam(fl: readonly number[]): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < fl.length; i += 2) pts.push([fl[i] ?? 0, fl[i + 1] ?? 0]);
  const xs = pts.map((p) => p[0]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const ym = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  return pts
    .map((p): [number, number] => [(p[0] - x0) / Math.max(1e-6, x1 - x0), p[1] - ym])
    .sort((a, b) => a[0] - b[0]);
}
