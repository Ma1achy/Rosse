/**
 * The CPU engine as one object with no DOM and no worker: the model and view tiers (the TypeScript
 * kernels, a merger's integration and the shells' simulation included), the rasteriser and the
 * composite, behind the calls the page makes (draw, resize, present). The page runs it in a
 * worker (./worker.ts, ./client.ts, ADR 0071) so that a frame, and above all a merger's
 * integration, never blocks the main thread; the profiling harness and the tests run it directly.
 */
import type { Params } from '../core/params';
import type { AtlasData, ImageData8 } from '../marks/atlas';
import { buildShellScene } from '../model/shells';
import type { MarkCounts } from '../model/scene';
import type { DrawingsMeta } from '../model/variation';
import { inkKey, inkLook } from '../render/ink-look';
import type { InkLayer } from '../render/layers';
import { pageModelKey } from '../render/page-key';
import type { Plates } from '../render/plates';
import { SURFACES, type SurfaceName } from '../render/surface';
import { CpuRenderer } from './index';
import { CpuMerger } from './merger';
import { CpuShellScene } from './shells';
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
  private readonly stipple: CpuStippleTiers;
  private counts: MarkCounts | null = null;
  private layers: readonly InkLayer[] = [];
  /** the key of the look the ink buffer holds; null when it is stale */
  private inked: string | null = null;
  /** the merger (or the shells) built for these parameters, and what they were keyed on */
  private merger: { key: string; m: CpuMerger } | null = null;
  private shells: { key: string; s: CpuShellScene } | null = null;
  /** tier runs of the merger and the shells (the stipple's are `stipple.tiers`) */
  private readonly pageRuns = { model: 0, view: 0 };
  /** what the ink layers are now: the stipple's, the stipple's with shells, or the merger's */
  private mode: 'stipple' | 'shells' | 'merger' = 'stipple';

  constructor(
    atlases: readonly AtlasData[],
    paper: ImageData8,
    private readonly meta: DrawingsMeta,
    size: CpuSize,
  ) {
    this.renderer = new CpuRenderer(size, paper);
    atlases.forEach((a) => {
      this.renderer.addAtlas(a);
    });
    this.stipple = new CpuStippleTiers(meta);
  }

  get size(): CpuSize {
    return this.renderer.size;
  }

  /** The ink layers of the last draw (the SVG export's input). */
  get inkLayers(): readonly InkLayer[] {
    return this.layers;
  }

  /** The tiers these parameters and zoom need (the view only for a camera move), not yet inked. */
  draw(P: Params, zoom: number): CpuDrawn {
    const r = this.renderer;
    if (P.merger) {
      const key = pageModelKey(P);
      if (this.merger?.key !== key) {
        this.merger = { key, m: new CpuMerger({ ...P }, this.meta) };
        this.pageRuns.model++;
      }
      const m = this.merger.m;
      // the camera and the moment are the view tier's: they are set on the built scene
      Object.assign(m.scene.P, { az: P.az, incl: P.incl, pa: P.pa, winding: P.winding });
      const v = m.view(zoom, P.mTime);
      this.pageRuns.view++;
      r.setLayers(v.layers);
      this.layers = v.layers;
      this.counts = v.counts;
      this.mode = 'merger';
    } else {
      const { view, work } = this.stipple.frame(P, zoom);
      let shellsView: { layers: InkLayer[]; dots: number } | null = null;
      if (P.shellsOn && this.stipple.stipple) {
        const key = pageModelKey(P);
        if (this.shells?.key !== key) {
          this.shells = {
            key,
            s: new CpuShellScene(
              buildShellScene(P, this.meta, this.stipple.stipple.scene.variation),
            ),
          };
          this.pageRuns.model++;
        }
        shellsView = this.shells.s.view(zoom);
        this.pageRuns.view++;
      }
      if (work.view || shellsView || this.mode !== 'stipple') {
        this.layers = shellsView ? [...view.layers, ...shellsView.layers] : view.layers;
        r.setLayers(this.layers);
      }
      this.counts = shellsView
        ? { ...view.counts, dots: view.counts.dots + shellsView.dots }
        : view.counts;
      this.mode = shellsView ? 'shells' : 'stipple';
    }
    this.inked = null;
    return {
      counts: this.counts,
      tiers: {
        model: this.stipple.tiers.runs.model + this.pageRuns.model,
        view: this.stipple.tiers.runs.view + this.pageRuns.view,
      },
    };
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
