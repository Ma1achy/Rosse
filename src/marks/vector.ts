/**
 * Vector drawings (ADR 0006): records of lines (`l`), dots (`d`) and blobs (`b`) in a unit tile
 * from −0.5 to 0.5 (assets/README.md).
 *
 * M4 read one sheet, `penlines`: its pen lines hatch the dust lanes (src/model/ribbons.ts
 * `packPen`) and their longest polylines carve the stipple (`dustLines`). From M5 every sheet (12,
 * 429 drawings) is packed once into shared segment, dot and blob buffers with a per-drawing range
 * table (`packVectors`), which compute/vector-expand.wgsl and its CPU twin
 * (src/fallback/kernels/vector.ts) expand into capsules and sprites.
 */

export interface VectorRecord {
  /** polylines, each a flat list [x0, y0, x1, y1, …] */
  l: number[][];
  /** dots [x, y, r] */
  d: number[][];
  /** blobs [cx, cy, rx, ry, θ] */
  b: number[][];
}

/** A vector sheet as packed (assets-built/vector/<name>.json), with its per-drawing metadata. */
export interface VectorSheet {
  n: number;
  src: string[];
  vec: VectorRecord[];
  /** `whole`: the galaxy type (`galaxy:spiral`, `smooth:elongated`, `edge-on:dust-lane`…) */
  type?: string[];
  /** `whole`: the drawn winding, 'S', 'Z' or '' (unknown) */
  winding?: string[];
  /** `whole`: the drawn pitch angle in degrees, or null */
  pitch?: (number | null)[];
  /** `arms`: [tightness, winding, end style, flag] */
  meta?: [string, string, string, number][];
  /** `bars`: 1 for a filled bar, 0 for an outline */
  solid?: number[];
  /** the kind of each drawing (`env`: disc or halo; `rings`: curve or drawing; `trails`…) */
  kind?: string[];
}

/** Every vector sheet, in the reference's `MAGNIFIED` order (app23.js:L1099). */
export const VECTOR_ATLASES = [
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
] as const;

export type VectorAtlas = (typeof VECTOR_ATLASES)[number];

/** The whole library, by sheet. */
export type VectorLibrary = Record<VectorAtlas, VectorSheet>;

/** Words per drawing in `PackedVectors.table`. */
export const DRAWING_WORDS = 8;

/**
 * The densification step of a warped drawing, in tile units: each segment is cut into
 * max(1, ⌈length / 0.012⌉) pieces before the warp (expandVector, app23.js:L1202).
 */
export const DENSIFY_STEP = 0.012;

/**
 * The whole library as GPU tables (ADR 0006):
 * - `table`: per drawing [seg_first, seg_n, dot_first, dot_n, blob_first, blob_n, dens_first,
 *   dens_n], a drawing's index being `first[sheet] + tile`;
 * - `segs`: per segment (ax, ay, bx, by), tile units, each polyline's segments in order;
 * - `dens`: per segment, the exclusive prefix of the densified piece counts over the whole
 *   library, and the total at the end (nSegs + 1 entries), so segment s is cut into
 *   dens[s + 1] − dens[s] pieces;
 * - `dots`: per dot (x, y, r, hash), hash = |round(997x + 131y)| (app23.js:L1215);
 * - `blobs`: per blob (cx, cy, rx, ry), (cos θ, sin θ, hash, 0), hash = |round(991 cx)| (L1217).
 * The counts and hashes are computed in f64 from the records, as v21 computes them.
 */
export interface PackedVectors {
  first: Record<VectorAtlas, number>;
  nDrawings: number;
  nSegs: number;
  nDots: number;
  nBlobs: number;
  table: Uint32Array<ArrayBuffer>;
  segs: Float32Array<ArrayBuffer>;
  dens: Uint32Array<ArrayBuffer>;
  dots: Float32Array<ArrayBuffer>;
  blobs: Float32Array<ArrayBuffer>;
}

/** The pieces a segment is cut into under a warp (app23.js:L1202). */
export function densifyCount(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / DENSIFY_STEP));
}

/** Packs every sheet of the library (missing sheets pack as empty). */
export function packVectors(lib: Partial<VectorLibrary>): PackedVectors {
  const first = {} as Record<VectorAtlas, number>;
  let n = 0;
  for (const a of VECTOR_ATLASES) {
    first[a] = n;
    n += lib[a]?.vec.length ?? 0;
  }
  const table = new Uint32Array(Math.max(1, n) * DRAWING_WORDS);
  const segs: number[] = [];
  const dens: number[] = [];
  const dots: number[] = [];
  const blobs: number[] = [];
  let densRun = 0;
  for (const a of VECTOR_ATLASES)
    (lib[a]?.vec ?? []).forEach((r, i) => {
      const o = (first[a] + i) * DRAWING_WORDS;
      table[o] = segs.length / 4;
      table[o + 6] = densRun;
      for (const fl of r.l)
        for (let k = 2; k < fl.length; k += 2) {
          const ax = fl[k - 2] ?? 0;
          const ay = fl[k - 1] ?? 0;
          const bx = fl[k] ?? 0;
          const by = fl[k + 1] ?? 0;
          segs.push(ax, ay, bx, by);
          dens.push(densRun);
          densRun += densifyCount(ax, ay, bx, by);
        }
      table[o + 1] = segs.length / 4 - (table[o] ?? 0);
      table[o + 7] = densRun - (table[o + 6] ?? 0);
      table[o + 2] = dots.length / 4;
      for (const d of r.d) {
        const x = d[0] ?? 0;
        const y = d[1] ?? 0;
        dots.push(x, y, d[2] ?? 0, Math.abs(Math.round(x * 997 + y * 131)));
      }
      table[o + 3] = r.d.length;
      table[o + 4] = blobs.length / 8;
      for (const b of r.b) {
        const t = b[4] ?? 0;
        blobs.push(
          b[0] ?? 0,
          b[1] ?? 0,
          b[2] ?? 0,
          b[3] ?? 0,
          Math.cos(t),
          Math.sin(t),
          Math.abs(Math.round((b[0] ?? 0) * 991)),
          0,
        );
      }
      table[o + 5] = r.b.length;
    });
  dens.push(densRun);
  const pad = (x: number[], k: number) => (x.length ? x : new Array<number>(k).fill(0));
  return {
    first,
    nDrawings: n,
    nSegs: segs.length / 4,
    nDots: dots.length / 4,
    nBlobs: blobs.length / 8,
    table,
    segs: new Float32Array(pad(segs, 4)),
    dens: new Uint32Array(dens),
    dots: new Float32Array(pad(dots, 4)),
    blobs: new Float32Array(pad(blobs, 8)),
  };
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
