/**
 * The CPU engine as one object with no DOM and no worker: the model and view tiers (the TypeScript
 * kernels), the rasteriser and the composite, behind the calls the page makes (draw, resize,
 * present). The page runs it in a worker (./worker.ts, ./client.ts, ADR 0071) so that a frame
 * never blocks the main thread; the profiling harness and the tests run it directly.
 */
import type { Params } from '../core/params';
import type { AtlasData, ImageData8 } from '../marks/atlas';
import type { MarkCounts } from '../model/scene';
import type { DrawingsMeta } from '../model/variation';
import { inkKey, inkLook } from '../render/ink-look';
import type { Plates } from '../render/plates';
import { SURFACES, type SurfaceName } from '../render/surface';
import { CpuRenderer } from './index';
import { CpuStippleTiers } from './stipple';

export interface CpuSize {
  plateCss: number;
  dpr: number;
}

export interface CpuDrawn {
  counts: MarkCounts;
  tiers: { model: number; view: number };
}

export interface CpuFrame {
  pixels: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

export class CpuEngineCore {
  private readonly renderer: CpuRenderer;
  private readonly tiers: CpuStippleTiers;
  private counts: MarkCounts | null = null;
  /** the key of the look the ink buffer holds; null when it is stale */
  private inked: string | null = null;

  constructor(atlases: readonly AtlasData[], paper: ImageData8, meta: DrawingsMeta, size: CpuSize) {
    this.renderer = new CpuRenderer(size, paper);
    atlases.forEach((a) => {
      this.renderer.addAtlas(a);
    });
    this.tiers = new CpuStippleTiers(meta);
  }

  get size(): CpuSize {
    return this.renderer.size;
  }

  /** The tiers these parameters and zoom need (the view only for a camera move), not yet inked. */
  draw(P: Params, zoom: number): CpuDrawn {
    const { view, work } = this.tiers.frame(P, zoom);
    if (work.view) this.renderer.setLayers(view.layers);
    this.inked = null;
    this.counts = view.counts;
    return { counts: view.counts, tiers: { ...this.tiers.tiers.runs } };
  }

  resize(size: CpuSize): void {
    this.renderer.resize(size);
    this.inked = null;
  }

  /** Inks if the plates or the palette changed, and composites onto the surface. */
  present(surface: SurfaceName, plates: Plates): CpuFrame {
    if (!this.counts) throw new Error('draw first');
    const look = inkLook(plates, surface);
    const key = inkKey(look);
    if (key !== this.inked) {
      this.renderer.drawInk(look);
      this.inked = key;
    }
    const r = this.renderer;
    return { pixels: r.present(SURFACES[surface]), width: r.width, height: r.height };
  }
}
