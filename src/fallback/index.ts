/**
 * The CPU engine: runs when WebGPU is unavailable (ADR 0011).
 *
 * M1 has the rasteriser half: `CpuRenderer` mirrors src/render/frame.ts's GpuRenderer (layers in
 * order into a premultiplied ink buffer, then the composite onto the surface) with the software
 * rasteriser in ./raster.ts. Later milestones add the TypeScript twins of the compute kernels
 * (./kernels/, ADR 0014) and move the engine into a worker. No DOM here: the output is RGBA8
 * bytes, which the page puts on a canvas.
 */
import type { AtlasData, AtlasName, ImageData8 } from '../marks/atlas';
import type { InkLayer } from '../render/layers';
import { PLATE_UNITS } from '../render/sample-scene';
import type { Surface } from '../render/surface';
import { composite, createInkBuffer, rasteriseSprites, type InkBuffer } from './raster';

export * from './raster';

export class CpuRenderer {
  readonly width: number;
  readonly height: number;
  readonly pxPerUnit: number;
  readonly ink: InkBuffer;
  private readonly atlases = new Map<AtlasName, AtlasData>();
  private layers: readonly InkLayer[] = [];

  constructor(
    readonly size: { plateCss: number; dpr: number },
    readonly paper: ImageData8,
  ) {
    this.width = Math.round(size.plateCss * size.dpr);
    this.height = this.width;
    this.pxPerUnit = this.width / PLATE_UNITS;
    this.ink = createInkBuffer(this.width, this.height);
  }

  addAtlas(data: AtlasData): void {
    this.atlases.set(data.name as AtlasName, data);
  }

  setLayers(layers: readonly InkLayer[]): void {
    this.layers = layers;
  }

  drawInk(): void {
    this.ink.data.fill(0);
    for (const l of this.layers) {
      const atlas = this.atlases.get(l.atlas);
      if (!atlas) throw new Error(`atlas ${l.atlas} not loaded`);
      rasteriseSprites(this.ink, atlas, l.instances, { pxPerUnit: this.pxPerUnit, gain: l.gain });
    }
  }

  /** The ink over `surface`, as RGBA8 bytes (width × height × 4). */
  present(surface: Surface, out = new Uint8ClampedArray(this.width * this.height * 4)) {
    composite(this.ink, { surface, paper: this.paper, dpr: this.size.dpr }, out);
    return out;
  }
}
