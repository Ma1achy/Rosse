/**
 * One frame on the GPU (ADR 0007, 0010): the ink layers in order into the offscreen rgba16float
 * ink target (plate × DPR, no MSAA), then the composite onto the surface.
 *
 * Tiers: `setLayers` builds the instance buffers (view tier), `drawInk` re-inks the target with the
 * passes of a plates mode (src/render/plates.ts), and `present` composites it onto a surface
 * (both present tier). Switching surface on the `ink` plate calls only `present`; switching plates
 * calls `drawInk` and `present` and builds a few uniform buffers: no compute pass and no instance
 * buffer is rebuilt.
 */
import {
  uploadAtlas,
  type AtlasData,
  type AtlasName,
  type GpuAtlas,
  type ImageData8,
} from '../marks/atlas';
import type { GpuProfiler } from '../gpu/profile';
import { CompositePass } from './composite';
import type { PassStyle } from './pass-style';
import { DEFAULT_LOOK, platePasses, type InkLook, type Plates } from './plates';
import type { InkLayer } from './layers';
import { CapsuleBatch, RibbonBatch, RibbonPipeline } from './ribbon-pass';
import { PLATE } from '../view/camera';
import { INK_FORMAT, IndirectSpriteBatch, SpriteBatch, SpritePipeline } from './sprites';
import type { Surface } from './surface';

/** A layer ready to draw. */
interface Batch {
  /** the population the colour plate inks it as */
  pop: NonNullable<InkLayer['pop']>;
  /** work outside the ink pass, before this layer (the pen lines' coverage, ADR 0019) */
  prepass?(encoder: GPUCommandEncoder, style: PassStyle): void;
  encode(pass: GPURenderPassEncoder, style: PassStyle): void;
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
  /** Timestamps around the render passes (M10; the profiling harness sets it, the page never does). */
  profiler: GpuProfiler | null = null;
  /** the plates the ink target was last printed with, and what the composite is told */
  private plates: Plates = 'ink';

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
    // the batches' uniforms hold the target size
    this.dropBatches();
    this.makeTarget(size);
    this.setLayers(this.layers);
  }

  addAtlas(data: AtlasData): void {
    this.atlases.get(data.name as AtlasName)?.destroy();
    // batches hold the atlas they were built with
    this.dropBatches();
    this.atlases.set(data.name as AtlasName, uploadAtlas(this.device, data));
  }

  /** the key of each batch in `batches` (null: never reused), see `layerKey` */
  private keys: (string | null)[] = [];
  private readonly ids = new WeakMap<object, number>();
  private nextId = 1;
  /** how many batches the last `setLayers` made new and how many it kept (statistics, tests) */
  readonly batchStats = { built: 0, kept: 0 };

  private idOf(o: object | undefined): number {
    if (!o) return 0;
    let id = this.ids.get(o);
    if (id === undefined) {
      id = this.nextId++;
      this.ids.set(o, id);
    }
    return id;
  }

  /**
   * What a layer's batch is built from: its kind, population, gain and the identity of every GPU
   * buffer it draws (and the offsets and counts into them). Two layers with one key give one
   * batch, so a camera move that leaves the model tier's buffers in place builds none: the
   * uniforms and bind groups of the last view are the next view's. A CPU instance list is the
   * array itself, so a new array (the cores, placed for the view) is a new batch.
   */
  private layerKey(l: InkLayer): string | null {
    const base = `${l.kind}|${l.pop ?? 'line'}|${String(l.gain)}`;
    switch (l.kind) {
      case 'gpu-sprites': {
        const s = l.source;
        return `${base}|${l.atlas}|${String(this.idOf(s.buffer))}|${String(s.offset)}|${String(s.size)}|${String(this.idOf(s.indirect))}|${String(s.indirectOffset)}`;
      }
      case 'gpu-ribbons':
        return `${base}|${String(this.idOf(l.buffer))}|${String(l.count)}`;
      case 'gpu-capsules':
        return [
          base,
          String(this.idOf(l.buffer)),
          String(l.count),
          String(this.idOf(l.indirect)),
          ...(l.more ?? []).map(
            (m) =>
              `${String(this.idOf(m.buffer))}/${String(m.count)}/${String(this.idOf(m.indirect))}`,
          ),
        ].join('|');
      case 'sprites':
        return `${base}|${l.atlas}|${String(this.idOf(l.instances))}`;
      default:
        return null;
    }
  }

  private dropBatches(): void {
    this.batches.forEach((b) => {
      b.destroy();
    });
    this.batches = [];
    this.keys = [];
  }

  /**
   * View tier: instance buffers for every layer. A layer whose key (`layerKey`) is that of a batch
   * already built keeps it, with its uniforms and bind groups; only new layers are built.
   */
  setLayers(layers: readonly InkLayer[]): void {
    this.layers = layers;
    const reusable = new Map<string, Batch[]>();
    this.batches.forEach((b, i) => {
      const k = this.keys[i] ?? null;
      if (k === null) {
        b.destroy();
        return;
      }
      const list = reusable.get(k) ?? [];
      list.push(b);
      reusable.set(k, list);
    });
    this.batchStats.built = 0;
    this.batchStats.kept = 0;
    const keys: (string | null)[] = [];
    this.batches = layers.map((l): Batch => {
      const key = this.layerKey(l);
      keys.push(key);
      const kept = key === null ? undefined : reusable.get(key)?.shift();
      if (kept) {
        this.batchStats.kept++;
        return kept;
      }
      this.batchStats.built++;
      return this.makeBatch(l);
    });
    this.keys = keys;
    reusable.forEach((list) => {
      list.forEach((b) => {
        b.destroy();
      });
    });
  }

  private makeBatch(l: InkLayer): Batch {
    const opts = {
      targetWidth: this.width,
      targetHeight: this.height,
      pxPerUnit: this.pxPerUnit,
      gain: l.gain,
    };
    const pop = l.pop ?? 'line';
    if (l.kind === 'gpu-capsules')
      return {
        pop,
        ...new CapsuleBatch(
          this.ribbons,
          [{ buffer: l.buffer, count: l.count, indirect: l.indirect }, ...(l.more ?? [])],
          opts,
        ).bind(),
      };
    if (l.kind === 'capsules' || l.kind === 'ribbons')
      throw new Error('the WebGPU engine draws GPU ribbon buffers only');
    const atlas = this.atlases.get(l.atlas);
    if (!atlas) throw new Error(`atlas ${l.atlas} not loaded`);
    if (l.kind === 'gpu-ribbons')
      return { pop, ...new RibbonBatch(this.ribbons, atlas, l.buffer, l.count, opts).bind() };
    const sprites = this.sprites;
    const b =
      l.kind === 'gpu-sprites'
        ? new IndirectSpriteBatch(sprites, atlas, l.source, opts)
        : new SpriteBatch(sprites, atlas, l.instances, opts);
    return {
      pop,
      encode: (pass, style) => {
        b.encode(pass, sprites, style);
      },
      destroy: () => {
        b.destroy();
      },
    };
  }

  /**
   * Inks every layer, in order, into the ink target, once per pass of the plates (the reference's
   * scene(), app23.js:L1302–1307). The default is the key ink on Paper, one pass. A layer with a
   * prepass (the pen lines) ends the ink pass, runs its own, and the ink pass resumes (load) for
   * it and the layers after it.
   */
  drawInk(look: InkLook = DEFAULT_LOOK): void {
    this.plates = look.plates;
    const encoder = this.device.createCommandEncoder({ label: 'ink' });
    let cleared = false;
    const begin = () => {
      const ts = this.profiler?.span('present: ink');
      const pass = encoder.beginRenderPass({
        label: 'ink',
        ...(ts ? { timestampWrites: ts } : {}),
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
    for (const p of platePasses(look.plates, look.palette))
      for (const b of this.batches) {
        const style = { ink: p.inkOf(b.pop), gain: p.gain, off: p.off };
        if (b.prepass) {
          pass?.end();
          pass = null;
          b.prepass(encoder, style);
        }
        pass ??= begin();
        b.encode(pass, style);
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
      this.plates,
      this.profiler?.span('present: composite'),
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
    this.ribbons.destroy();
    this.ink.destroy();
  }
}
