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
import { CapsuleBatch, RibbonBatch, RibbonPipeline } from './ribbon-pass';
import { PLATE } from '../view/camera';
import { INK_FORMAT, IndirectSpriteBatch, SpriteBatch, SpritePipeline } from './sprites';
import type { Surface } from './surface';

/** A layer ready to draw. */
interface Batch {
  /** work outside the ink pass, before this layer (the pen lines' coverage, ADR 0019) */
  prepass?(encoder: GPUCommandEncoder): void;
  encode(pass: GPURenderPassEncoder): void;
  destroy(): void;
}

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
  private readonly ribbons: RibbonPipeline;
  private readonly composite: CompositePass;
  private readonly atlases = new Map<AtlasName, GpuAtlas>();
  private layers: readonly InkLayer[] = [];
  private batches: Batch[] = [];

  constructor(
    readonly device: GPUDevice,
    public size: FrameSize,
    paper: ImageData8,
  ) {
    this.sprites = new SpritePipeline(device);
    this.ribbons = new RibbonPipeline(device);
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
    this.batches = layers.map((l): Batch => {
      const opts = {
        targetWidth: this.width,
        targetHeight: this.height,
        pxPerUnit: this.pxPerUnit,
        gain: l.gain,
      };
      if (l.kind === 'gpu-capsules')
        return new CapsuleBatch(
          this.ribbons,
          [{ buffer: l.buffer, count: l.count, indirect: l.indirect }, ...(l.more ?? [])],
          opts,
        );
      if (l.kind === 'capsules' || l.kind === 'ribbons')
        throw new Error('the WebGPU engine draws GPU ribbon buffers only');
      const atlas = this.atlases.get(l.atlas);
      if (!atlas) throw new Error(`atlas ${l.atlas} not loaded`);
      if (l.kind === 'gpu-ribbons')
        return new RibbonBatch(this.ribbons, atlas, l.buffer, l.count, opts);
      const sprites = this.sprites;
      const b =
        l.kind === 'gpu-sprites'
          ? new IndirectSpriteBatch(sprites, atlas, l.source, opts)
          : new SpriteBatch(sprites, atlas, l.instances, opts);
      return {
        encode: (pass) => {
          b.encode(pass, sprites);
        },
        destroy: () => {
          b.destroy();
        },
      };
    });
  }

  /**
   * Inks every layer, in order, into the ink target. A layer with a prepass (the pen lines) ends
   * the ink pass, runs its own, and the ink pass resumes (load) for it and the layers after it.
   */
  drawInk(): void {
    const encoder = this.device.createCommandEncoder({ label: 'ink' });
    let cleared = false;
    const begin = () => {
      const pass = encoder.beginRenderPass({
        label: 'ink',
        colorAttachments: [
          {
            view: this.inkView,
            loadOp: cleared ? 'load' : 'clear',
            storeOp: 'store',
            clearValue: [0, 0, 0, 0],
          },
        ],
      });
      cleared = true;
      return pass;
    };
    let pass: GPURenderPassEncoder | null = null;
    for (const b of this.batches) {
      if (b.prepass) {
        pass?.end();
        pass = null;
        b.prepass(encoder);
      }
      pass ??= begin();
      b.encode(pass);
    }
    (pass ?? begin()).end();
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
