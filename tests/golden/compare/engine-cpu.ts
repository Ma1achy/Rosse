/**
 * The CPU engine for the golden runner (ADR 0011): renders a case's parameters with the TypeScript
 * kernels and the software rasteriser, in Node, and returns the ink's α as the comparison input
 * (quantised to 8 bits, as the reference's PNG captures are). Loaded by ./compare.mjs through
 * Vite's SSR loader, so it imports the engine's TypeScript sources directly.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Params } from '../../../src/core/params';
import { CpuRenderer } from '../../../src/fallback';
import { CpuStipple } from '../../../src/fallback/stipple';
import {
  atlasFromBytes,
  type AtlasData,
  type AtlasName,
  type BuiltIndex,
} from '../../../src/marks/atlas';
import {
  buildScene,
  drawingsMeta,
  type MarkCounts,
  type SceneOptions,
} from '../../../src/model/scene';
import { VECTOR_ATLASES, type VectorLibrary, type VectorSheet } from '../../../src/marks/vector';
import { cameraOf } from '../../../src/view/camera';
import { grey, type Grey } from './metrics';

export const ATLASES: AtlasName[] = ['dots', 'knots', 'stars', 'cores', 'pieces', 'strokes'];

export function loadAtlases(root: string): AtlasData[] {
  const dir = join(root, 'assets-built');
  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as BuiltIndex;
  return ATLASES.map((n) => {
    const e = index.atlases[n];
    return atlasFromBytes(n, e, new Uint8Array(readFileSync(join(dir, e.file))));
  });
}

/** Every packed vector sheet (M5). */
export function loadVectors(root: string): VectorLibrary {
  return Object.fromEntries(VECTOR_ATLASES.map((n) => [n, loadVector(root, n)])) as VectorLibrary;
}

/** A packed vector sheet (M4: the pen lines). */
export function loadVector(root: string, name: string): VectorSheet {
  const dir = join(root, 'assets-built');
  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as BuiltIndex;
  const e = index.vectors[name];
  if (!e) throw new Error(`vector sheet ${name} not packed`);
  return JSON.parse(readFileSync(join(dir, e.file), 'utf8')) as VectorSheet;
}

export function metaOf(atlases: AtlasData[], penlines?: VectorSheet, vectors?: VectorLibrary) {
  const by = (n: string) => {
    const a = atlases.find((x) => x.name === n);
    if (!a) throw new Error(`atlas ${n} missing`);
    return a;
  };
  return drawingsMeta(
    {
      dots: by('dots'),
      knots: by('knots'),
      stars: by('stars'),
      cores: by('cores'),
      strokes: by('strokes'),
    },
    penlines,
    vectors,
  );
}

/** α of a premultiplied ink buffer (RGBA f32), rounded to 8 bits. */
export function alphaOf(width: number, height: number, rgba: ArrayLike<number>): Grey {
  const g = grey(width, height);
  for (let i = 0; i < width * height; i++)
    g.data[i] = Math.round(Math.min(1, Math.max(0, rgba[i * 4 + 3] ?? 0)) * 255) / 255;
  return g;
}

export interface RenderResult {
  alpha: Grey;
  counts: MarkCounts;
  ms: number;
}

export class CpuGolden {
  readonly atlases: AtlasData[];
  readonly meta: ReturnType<typeof metaOf>;
  private readonly renderer: CpuRenderer;

  constructor(root: string) {
    this.atlases = loadAtlases(root);
    const vectors = loadVectors(root);
    this.meta = metaOf(this.atlases, vectors.penlines, vectors);
    this.renderer = new CpuRenderer(
      { plateCss: 800, dpr: 1 },
      { width: 1, height: 1, data: new Uint8Array(4) },
    );
    for (const a of this.atlases) this.renderer.addAtlas(a);
  }

  /** `zoom`: the reference's ZOOM at capture (1, or 2 for the zoom camera). */
  render(P: Params, opts: SceneOptions = {}, zoom = 1): RenderResult {
    const t0 = performance.now();
    const view = new CpuStipple(buildScene(P, this.meta, opts)).view(cameraOf(P, zoom));
    this.renderer.setLayers(view.layers);
    this.renderer.drawInk();
    const ink = this.renderer.ink;
    return {
      alpha: alphaOf(ink.width, ink.height, ink.data),
      counts: view.counts,
      ms: performance.now() - t0,
    };
  }
}
