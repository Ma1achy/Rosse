/**
 * One frame on the GPU (ADR 0007, 0010): the ink layers in order into the offscreen rgba16float
 * ink target (plate × DPR, no MSAA), then the composite onto the surface.
 *
 * Tiers, as far as M1 has them: `setLayers` builds the instance buffers (view tier), `drawInk`
 * re-inks the target, and `present` composites it onto a surface (present tier). Switching
 * surface calls only `present`: nothing else is rebuilt.
 */
import {
  uploadAtlas,
  type AtlasData,
  type AtlasName,
  type GpuAtlas,
  type ImageData8,
} from '../marks/atlas';
import { CompositePass } from './composite';
import type { InkLayer } from './layers';
import { PLATE_UNITS } from './sample-scene';
import { INK_FORMAT, IndirectSpriteBatch, SpriteBatch, SpritePipeline } from './sprites';
import type { Surface } from './surface';

export interface FrameSize {
  /** plate size in CSS pixels */
  plateCss: number;
  /** device pixel ratio */
  dpr: number;
}

export class GpuRenderer {
  readonly width: number;
  readonly height: number;
  readonly pxPerUnit: number;
  readonly ink: GPUTexture;
  private readonly sprites: SpritePipeline;
  private readonly composite: CompositePass;
  private readonly atlases = new Map<AtlasName, GpuAtlas>();
  private batches: (SpriteBatch | IndirectSpriteBatch)[] = [];

  constructor(
    readonly device: GPUDevice,
    readonly size: FrameSize,
    paper: ImageData8,
  ) {
    this.width = Math.round(size.plateCss * size.dpr);
    this.height = this.width;
    this.pxPerUnit = this.width / PLATE_UNITS;
    this.ink = device.createTexture({
      label: 'ink target',
      size: [this.width, this.height],
      format: INK_FORMAT,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
    });
    this.sprites = new SpritePipeline(device);
    this.composite = new CompositePass(device, paper);
  }

  addAtlas(data: AtlasData): void {
    this.atlases.get(data.name as AtlasName)?.destroy();
    this.atlases.set(data.name as AtlasName, uploadAtlas(this.device, data));
  }

  /** View tier: instance buffers for every layer. */
  setLayers(layers: readonly InkLayer[]): void {
    this.batches.forEach((b) => {
      b.destroy();
    });
    this.batches = layers.map((l) => {
      const atlas = this.atlases.get(l.atlas);
      if (!atlas) throw new Error(`atlas ${l.atlas} not loaded`);
      const opts = {
        targetWidth: this.width,
        targetHeight: this.height,
        pxPerUnit: this.pxPerUnit,
        gain: l.gain,
      };
      return l.kind === 'gpu-sprites'
        ? new IndirectSpriteBatch(this.sprites, atlas, l.source, opts)
        : new SpriteBatch(this.sprites, atlas, l.instances, opts);
    });
  }

  /** Inks every layer, in order, into the ink target. */
  drawInk(): void {
    const encoder = this.device.createCommandEncoder({ label: 'ink' });
    const pass = encoder.beginRenderPass({
      label: 'ink',
      colorAttachments: [
        {
          view: this.ink.createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: [0, 0, 0, 0],
        },
      ],
    });
    for (const b of this.batches) b.encode(pass, this.sprites);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  /** Present tier: the ink target over `surface` into `output`. */
  present(output: GPUTextureView, format: GPUTextureFormat, surface: Surface): void {
    const encoder = this.device.createCommandEncoder({ label: 'present' });
    this.composite.encode(encoder, this.ink.createView(), output, format, surface, this.size.dpr);
    this.device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    this.batches.forEach((b) => {
      b.destroy();
    });
    this.atlases.forEach((a) => {
      a.destroy();
    });
    this.composite.destroy();
    this.ink.destroy();
  }
}
