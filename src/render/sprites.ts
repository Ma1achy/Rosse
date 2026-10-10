/**
 * The sprite pipeline (ADR 0007): instanced quads for bitmap drawings into the ink target.
 * Shader: src/shaders/render/sprite.wgsl. Premultiplied, blend ONE / ONE_MINUS_SRC_ALPHA, no MSAA.
 */
import spriteWgsl from '../shaders/render/sprite.wgsl';
import { bufferWithData, packStruct } from '../gpu/buffers';
import type { GpuAtlas } from '../marks/atlas';
import { packInstances, type Instance, type StructLayout } from '../marks/instance';
import { KEY_STYLE, styleKey, withStyle, type PassStyle } from './pass-style';

/** The `Sprite` uniform of sprite.wgsl. */
export const SPRITE_UNIFORMS_LAYOUT: StructLayout = {
  name: 'Sprite',
  size: 304,
  align: 16,
  fields: [
    { name: 'ink', type: 'vec4<f32>', offset: 0, size: 16 },
    { name: 'target_size', type: 'vec2<f32>', offset: 16, size: 8 },
    { name: 'edge', type: 'vec2<f32>', offset: 24, size: 8 },
    { name: 'px_per_unit', type: 'f32', offset: 32, size: 4 },
    { name: 'gain', type: 'f32', offset: 36, size: 4 },
    { name: 'cell', type: 'f32', offset: 40, size: 4 },
    { name: 'max_lod', type: 'f32', offset: 44, size: 4 },
    { name: 'layer_base', type: 'u32', offset: 48, size: 4 },
    { name: 'layer_count', type: 'u32', offset: 52, size: 4 },
    { name: 'off', type: 'vec2<f32>', offset: 56, size: 8 },
    { name: 'tint1', type: 'vec4<f32>', offset: 64, size: 16 },
    { name: 'tint2', type: 'vec4<f32>', offset: 80, size: 16 },
    { name: 'tint3', type: 'vec4<f32>', offset: 96, size: 16 },
    { name: 'tint4', type: 'vec4<f32>', offset: 112, size: 16 },
    { name: 'tint5', type: 'vec4<f32>', offset: 128, size: 16 },
    { name: 'tint6', type: 'vec4<f32>', offset: 144, size: 16 },
    { name: 'tint7', type: 'vec4<f32>', offset: 160, size: 16 },
    { name: 'tint8', type: 'vec4<f32>', offset: 176, size: 16 },
    { name: 'tint9', type: 'vec4<f32>', offset: 192, size: 16 },
    { name: 'tint10', type: 'vec4<f32>', offset: 208, size: 16 },
    { name: 'tint11', type: 'vec4<f32>', offset: 224, size: 16 },
    { name: 'tint12', type: 'vec4<f32>', offset: 240, size: 16 },
    { name: 'tint13', type: 'vec4<f32>', offset: 256, size: 16 },
    { name: 'tint14', type: 'vec4<f32>', offset: 272, size: 16 },
    { name: 'tint15', type: 'vec4<f32>', offset: 288, size: 16 },
  ],
};

export const INK_FORMAT: GPUTextureFormat = 'rgba16float';

export class SpritePipeline {
  readonly pipeline: GPURenderPipeline;
  readonly layout: GPUBindGroupLayout;
  readonly sampler: GPUSampler;
  readonly samplerRepeat: GPUSampler;

  constructor(readonly device: GPUDevice) {
    const module = device.createShaderModule({ label: 'sprite.wgsl', code: spriteWgsl });
    this.layout = device.createBindGroupLayout({
      label: 'sprite',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d-array' },
        },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });
    this.pipeline = device.createRenderPipeline({
      label: 'sprite',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
      vertex: { module, entryPoint: 'vs' },
      fragment: {
        module,
        entryPoint: 'fs',
        targets: [
          {
            format: INK_FORMAT,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-strip' },
    });
    const common: GPUSamplerDescriptor = {
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeV: 'clamp-to-edge',
    };
    this.sampler = device.createSampler({ ...common, addressModeU: 'clamp-to-edge' });
    this.samplerRepeat = device.createSampler({ ...common, addressModeU: 'repeat' });
  }
}

interface SpriteOpts {
  targetWidth: number;
  targetHeight: number;
  pxPerUnit: number;
  gain: number;
  ink?: readonly [number, number, number];
  off?: readonly [number, number];
  tints?: readonly (readonly [number, number, number])[];
}

function spriteUniforms(
  device: GPUDevice,
  atlas: GpuAtlas,
  arr: { first: number; count: number },
  opts: SpriteOpts,
  label: string,
): GPUBuffer {
  return bufferWithData(
    device,
    packStruct(SPRITE_UNIFORMS_LAYOUT, {
      ink: [...(opts.ink ?? [1, 1, 1]), 1],
      target_size: [opts.targetWidth, opts.targetHeight],
      edge: atlas.data.edge,
      px_per_unit: opts.pxPerUnit,
      gain: opts.gain,
      cell: atlas.cellWidth,
      max_lod: atlas.maxLod,
      layer_base: arr.first,
      layer_count: arr.count,
      off: opts.off ?? [0, 0],
      ...Object.fromEntries(
        Array.from({ length: 15 }, (_, k) => k + 1).map((k) => [
          `tint${String(k)}`,
          [...(opts.tints?.[k - 1] ?? opts.ink ?? [1, 1, 1]), 1],
        ]),
      ),
    }),
    GPUBufferUsage.UNIFORM,
    label,
  );
}

export interface SpriteDraw {
  bindGroup: GPUBindGroup;
  count: number;
  first: number;
}

/**
 * One layer of sprites, ready to draw: its instances on the GPU, split per texture array of the
 * atlas. With one ink, the order across arrays changes only rounding (ADR 0007). The uniforms
 * (ink, gain, offset) belong to a pass of the plates and are made per style, on first use.
 */
export class SpriteBatch {
  private buffers: GPUBuffer[] = [];
  /** per texture array: its instance count and storage buffer */
  private readonly arrays: {
    arr: GpuAtlas['arrays'][number];
    count: number;
    storage: GPUBuffer;
  }[] = [];
  private readonly styled = new Map<string, SpriteDraw[]>();

  constructor(
    private readonly pipe: SpritePipeline,
    private readonly atlas: GpuAtlas,
    instances: readonly Instance[],
    private readonly opts: SpriteOpts,
  ) {
    for (const arr of atlas.arrays) {
      const list = instances.filter((s) => s.layer >= arr.first && s.layer < arr.first + arr.count);
      if (!list.length) continue;
      const storage = bufferWithData(
        pipe.device,
        packInstances(list),
        GPUBufferUsage.STORAGE,
        `instances ${atlas.data.name}`,
      );
      this.buffers.push(storage);
      this.arrays.push({ arr, count: list.length, storage });
    }
  }

  /** The draws of one pass of the plates. */
  get draws(): SpriteDraw[] {
    return this.drawsFor(KEY_STYLE);
  }

  private drawsFor(style: PassStyle): SpriteDraw[] {
    const key = styleKey(style);
    let draws = this.styled.get(key);
    if (draws) return draws;
    const { pipe, atlas } = this;
    const opts = withStyle(this.opts, style);
    draws = this.arrays.map(({ arr, count, storage }) => {
      const uniforms = spriteUniforms(
        pipe.device,
        atlas,
        arr,
        opts,
        `sprite uniforms ${atlas.data.name}`,
      );
      this.buffers.push(uniforms);
      return {
        bindGroup: pipe.device.createBindGroup({
          layout: pipe.layout,
          entries: [
            { binding: 0, resource: { buffer: uniforms } },
            { binding: 1, resource: { buffer: storage } },
            { binding: 2, resource: arr.view },
            { binding: 3, resource: atlas.data.repeatU ? pipe.samplerRepeat : pipe.sampler },
          ],
        }),
        count,
        first: 0,
      };
    });
    this.styled.set(key, draws);
    return draws;
  }

  encode(pass: GPURenderPassEncoder, pipe: SpritePipeline, style: PassStyle = KEY_STYLE): void {
    pass.setPipeline(pipe.pipeline);
    for (const d of this.drawsFor(style)) {
      pass.setBindGroup(0, d.bindGroup);
      pass.draw(4, d.count, 0, d.first);
    }
  }

  destroy(): void {
    this.buffers.forEach((b) => {
      b.destroy();
    });
    this.buffers = [];
    this.styled.clear();
  }
}

/** Instances written by a compute pass, drawn with an indirect count (no read-back, ADR 0003). */
export interface GpuInstances {
  buffer: GPUBuffer;
  /** byte offset of the first instance (a multiple of 256) */
  offset: number;
  /** bytes available from `offset` */
  size: number;
  /** indirect draw arguments [4, count, 0, 0] */
  indirect: GPUBuffer;
  indirectOffset: number;
}

/**
 * One layer of GPU-written sprites. An atlas split over several texture arrays is drawn once per
 * array from the same instances; the vertex stage skips instances of other arrays.
 */
export class IndirectSpriteBatch {
  private buffers: GPUBuffer[] = [];
  private readonly styled = new Map<string, GPUBindGroup[]>();

  constructor(
    private readonly pipe: SpritePipeline,
    private readonly atlas: GpuAtlas,
    readonly source: GpuInstances,
    private readonly opts: SpriteOpts,
  ) {}

  private groupsFor(style: PassStyle): GPUBindGroup[] {
    const key = styleKey(style);
    let groups = this.styled.get(key);
    if (groups) return groups;
    const { pipe, atlas, source } = this;
    const opts = withStyle(this.opts, style);
    groups = atlas.arrays.map((arr) => {
      const uniforms = spriteUniforms(
        pipe.device,
        atlas,
        arr,
        opts,
        `sprite uniforms ${atlas.data.name} (indirect)`,
      );
      this.buffers.push(uniforms);
      return pipe.device.createBindGroup({
        layout: pipe.layout,
        entries: [
          { binding: 0, resource: { buffer: uniforms } },
          {
            binding: 1,
            resource: { buffer: source.buffer, offset: source.offset, size: source.size },
          },
          { binding: 2, resource: arr.view },
          { binding: 3, resource: atlas.data.repeatU ? pipe.samplerRepeat : pipe.sampler },
        ],
      });
    });
    this.styled.set(key, groups);
    return groups;
  }

  encode(pass: GPURenderPassEncoder, pipe: SpritePipeline, style: PassStyle = KEY_STYLE): void {
    pass.setPipeline(pipe.pipeline);
    for (const g of this.groupsFor(style)) {
      pass.setBindGroup(0, g);
      pass.drawIndirect(this.source.indirect, this.source.indirectOffset);
    }
  }

  destroy(): void {
    this.buffers.forEach((b) => {
      b.destroy();
    });
    this.buffers = [];
    this.styled.clear();
  }
}
