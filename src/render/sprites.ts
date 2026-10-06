/**
 * The sprite pipeline (ADR 0007): instanced quads for bitmap drawings into the ink target.
 * Shader: src/shaders/render/sprite.wgsl. Premultiplied, blend ONE / ONE_MINUS_SRC_ALPHA, no MSAA.
 */
import spriteWgsl from '../shaders/render/sprite.wgsl';
import { bufferWithData, packStruct } from '../gpu/buffers';
import type { GpuAtlas } from '../marks/atlas';
import { packInstances, type Instance, type StructLayout } from '../marks/instance';

/** The `Sprite` uniform of sprite.wgsl. */
export const SPRITE_UNIFORMS_LAYOUT: StructLayout = {
  name: 'Sprite',
  size: 64,
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

export interface SpriteDraw {
  bindGroup: GPUBindGroup;
  count: number;
  first: number;
}

/**
 * One layer of sprites, ready to draw: its instances on the GPU, split per texture array of the
 * atlas. With one ink, the order across arrays changes only rounding (ADR 0007).
 */
export class SpriteBatch {
  private buffers: GPUBuffer[] = [];
  readonly draws: SpriteDraw[] = [];

  constructor(
    pipe: SpritePipeline,
    atlas: GpuAtlas,
    instances: readonly Instance[],
    opts: {
      targetWidth: number;
      targetHeight: number;
      pxPerUnit: number;
      gain: number;
      ink?: readonly [number, number, number];
    },
  ) {
    const device = pipe.device;
    for (const arr of atlas.arrays) {
      const list = instances.filter((s) => s.layer >= arr.first && s.layer < arr.first + arr.count);
      if (!list.length) continue;
      const uniforms = bufferWithData(
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
        }),
        GPUBufferUsage.UNIFORM,
        `sprite uniforms ${atlas.data.name}`,
      );
      const storage = bufferWithData(
        device,
        packInstances(list),
        GPUBufferUsage.STORAGE,
        `instances ${atlas.data.name}`,
      );
      this.buffers.push(uniforms, storage);
      this.draws.push({
        bindGroup: device.createBindGroup({
          layout: pipe.layout,
          entries: [
            { binding: 0, resource: { buffer: uniforms } },
            { binding: 1, resource: { buffer: storage } },
            { binding: 2, resource: arr.view },
            {
              binding: 3,
              resource: atlas.data.repeatU ? pipe.samplerRepeat : pipe.sampler,
            },
          ],
        }),
        count: list.length,
        first: 0,
      });
    }
  }

  encode(pass: GPURenderPassEncoder, pipe: SpritePipeline): void {
    pass.setPipeline(pipe.pipeline);
    for (const d of this.draws) {
      pass.setBindGroup(0, d.bindGroup);
      pass.draw(4, d.count, 0, d.first);
    }
  }

  destroy(): void {
    this.buffers.forEach((b) => {
      b.destroy();
    });
  }
}
