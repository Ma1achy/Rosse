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
import { PLATE } from '../view/camera';
import { INK_FORMAT, IndirectSpriteBatch, SpriteBatch, SpritePipeline } from './sprites';
import type { Surface } from './surface';

export interface FrameSize {
  /** plate size in CSS pixels */
  plateCss: number;
  /** device pixel ratio */
  dpr: number;
}

export class GpuRenderer {
  width = 0;
  height = 0;
  pxPerUnit = 1;
  ink!: GPUTexture;
  private inkView!: GPUTextureView;
  private readonly sprites: SpritePipeline;
  private readonly composite: CompositePass;
  private readonly atlases = new Map<AtlasName, GpuAtlas>();
  private layers: readonly InkLayer[] = [];
  private batches: (SpriteBatch | IndirectSpriteBatch)[] = [];

  constructor(
    readonly device: GPUDevice,
    public size: FrameSize,
    paper: ImageData8,
  ) {
    this.sprites = new SpritePipeline(device);
    this.composite = new CompositePass(device, paper);
    this.makeTarget(size);
  }

  private makeTarget(size: FrameSize): void {
    this.size = size;
    this.width = Math.round(size.plateCss * size.dpr);
    this.height = this.width;
    this.pxPerUnit = this.width / PLATE;
    this.ink = this.device.createTexture({
      label: 'ink target',
      size: [this.width, this.height],
      format: INK_FORMAT,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
    });
    this.inkView = this.ink.createView();
  }

  /**
   * A new plate size or DPR: a new ink target and new instance batches (their uniforms hold the
   * target size); the atlases and pipelines are kept. Call drawInk() after.
   */
  resize(size: FrameSize): void {
    this.ink.destroy();
    this.makeTarget(size);
    this.setLayers(this.layers);
  }

  addAtlas(data: AtlasData): void {
    this.atlases.get(data.name as AtlasName)?.destroy();
    this.atlases.set(data.name as AtlasName, uploadAtlas(this.device, data));
  }

  /** View tier: instance buffers for every layer. */
  setLayers(layers: readonly InkLayer[]): void {
    this.layers = layers;
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
          view: this.inkView,
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
    this.composite.encode(
      encoder,
      this.inkView,
      output,
      format,
      surface,
      this.size.plateCss,
      this.size.dpr,
    );
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
