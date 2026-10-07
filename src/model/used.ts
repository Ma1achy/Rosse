/**
 * The "used drawings" count: how many of the source drawings a galaxy is drawn with, the
 * reference's `STATS.used` ("N of the 469 drawings are in this galaxy", app23.js:L1302–1304).
 *
 * v21 adds a drawing's source name to `USED` wherever it places it (reference notes section 15):
 * every bitmap mark placed by `inst` (stipple dots, knots, sparkle stars, cores, the streams' dots
 * and knots), the stroke of every curve (L805), every placed vector drawing (L171, L1010, L1060,
 * L1067), every hatch's pen line (L1049), the streams' pen lines (L1072), the carving lines' pen
 * lines (L203), and the dots of every expanded vector drawing (L1216). Not the pieces, nor the
 * blobs of vector drawings.
 *
 * The engine counts the same sources from what it draws, on the CPU engine (the WebGPU engine
 * would need its instance buffers read back): since M7 also the drawn stars (`sstars`), the deep
 * field's galaxies, their dots, the foreground stars and the companions. One source v21 counts is
 * not counted yet: the carving lines' pen lines, whose picks the line-work does not keep.
 */
import type { Instance } from '../marks/instance';
import type { VectorRow } from './parts';
import type { DrawingsMeta } from './variation';

export interface UsedInput {
  /** the stipple's dots and the streams' dots, the vector drawings' dots (layers of `dots`) */
  dots: Iterable<number>;
  /** stipple knots and the streams' knots (layers of `knots`) */
  knots: Iterable<number>;
  stars: Iterable<number>;
  cores: readonly Instance[];
  /** each curve's stroke (a row of `strokes`) */
  strokes: Iterable<number>;
  /** the placed vector drawings */
  rows: readonly VectorRow[];
  /** pen lines used by the hatching and the streams */
  penlines: Iterable<number>;
  /** M7: vector drawings the sky and the stars place (a drawn star, a galaxy of the deep field) */
  extra?: readonly { atlas: string; tile: number }[];
  /** M7: foreground stars (layers of `fgstars`) */
  fgstars?: Iterable<number>;
}

export function usedDrawings(meta: DrawingsMeta, u: UsedInput): number {
  const used = new Set<string>();
  const add = (src: readonly string[] | undefined, tiles: Iterable<number>, sheet: string) => {
    for (const t of tiles) used.add(src?.[t] ?? `${sheet}:${String(t)}`);
  };
  add(meta.dots.src, u.dots, 'dots');
  add(meta.knots.src, u.knots, 'knots');
  add(meta.stars.src, u.stars, 'stars');
  add(
    meta.cores.src,
    u.cores.map((c) => c.layer),
    'cores',
  );
  add(meta.strokes?.src, u.strokes, 'strokes');
  for (const r of u.rows) add(meta.vectors?.[r.atlas]?.src, [r.tile], r.atlas);
  add(meta.penlines?.src, u.penlines, 'penlines');
  for (const r of u.extra ?? [])
    add(meta.vectors?.[r.atlas as keyof typeof meta.vectors]?.src, [r.tile], r.atlas);
  add(meta.fgstars?.src, u.fgstars ?? [], 'fgstars');
  return used.size;
}
