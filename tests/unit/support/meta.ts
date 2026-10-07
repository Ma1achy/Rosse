/**
 * The drawings' metadata with everything the engine draws from: the strokes sheet (M4), the pen
 * lines and every vector sheet (M5), read from assets-built/ (`npm test` packs it first).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { atlasFromBytes, type BuiltIndex } from '../../../src/marks/atlas';
import { VECTOR_ATLASES, type VectorLibrary, type VectorSheet } from '../../../src/marks/vector';
import { drawingsMeta } from '../../../src/model/scene';

export const ROOT = resolve(import.meta.dirname, '../../..');
const BUILT = resolve(ROOT, 'assets-built');
const index = JSON.parse(readFileSync(resolve(BUILT, 'index.json'), 'utf8')) as BuiltIndex;
const atlas = (n: 'dots' | 'knots' | 'stars' | 'cores' | 'strokes') =>
  atlasFromBytes(
    n,
    index.atlases[n],
    new Uint8Array(readFileSync(resolve(BUILT, index.atlases[n].file))),
  );

export const VECTORS = Object.fromEntries(
  VECTOR_ATLASES.map((n) => [
    n,
    JSON.parse(readFileSync(resolve(BUILT, index.vectors[n]?.file ?? ''), 'utf8')) as VectorSheet,
  ]),
) as VectorLibrary;

export const ATLASES = {
  dots: atlas('dots'),
  knots: atlas('knots'),
  stars: atlas('stars'),
  cores: atlas('cores'),
  strokes: atlas('strokes'),
};

/** The full metadata: strokes, pen lines, every vector sheet. */
export const FULL_META = drawingsMeta(ATLASES, VECTORS.penlines, VECTORS);
