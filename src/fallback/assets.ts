/**
 * The CPU engine's inputs, loaded from the packed assets: atlases, paper and the drawings'
 * metadata. Used by the worker, which has no access to what the page loaded.
 */
import { BuiltAssets, type AtlasData, type AtlasName, type ImageData8 } from '../marks/atlas';
import { VECTOR_ATLASES, type VectorLibrary } from '../marks/vector';
import { drawingsMeta } from '../model/scene';
import type { DrawingsMeta } from '../model/variation';

export const CPU_ATLASES: AtlasName[] = ['dots', 'knots', 'stars', 'cores', 'pieces', 'strokes'];

export async function loadCpuAssets(
  base: string,
): Promise<{ atlases: AtlasData[]; paper: ImageData8; meta: DrawingsMeta }> {
  const assets = await BuiltAssets.load(base);
  const [atlases, paper, sheets] = await Promise.all([
    Promise.all(CPU_ATLASES.map((n) => assets.atlas(n))),
    assets.paper(),
    Promise.all(VECTOR_ATLASES.map((n) => assets.vector(n))),
  ]);
  const vectors = Object.fromEntries(VECTOR_ATLASES.map((n, i) => [n, sheets[i]])) as VectorLibrary;
  const by = (n: AtlasName) => {
    const a = atlases.find((x) => x.name === n);
    if (!a) throw new Error(`atlas ${n} missing`);
    return a;
  };
  return {
    atlases,
    paper,
    meta: drawingsMeta(
      {
        dots: by('dots'),
        knots: by('knots'),
        stars: by('stars'),
        cores: by('cores'),
        strokes: by('strokes'),
      },
      vectors.penlines,
      vectors,
    ),
  };
}
