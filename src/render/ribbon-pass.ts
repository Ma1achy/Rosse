/**
 * The ribbon pipelines (ADR 0007): textured stroke ribbons and pen lines, pulled from buffers
 * written by compute/ribbons.wgsl, into the ink target. Shader: render/ribbon.wgsl. Premultiplied,
 * blend ONE / ONE_MINUS_SRC_ALPHA, no MSAA; six vertices per segment. Pen lines (the dust
 * hatching) are v21's overlap quads unioned per sample (ADR 0019): a coverage pass into their own
 * rgba8unorm target (one channel per sample, MAX blending), then a resolve over the ink.
 */
import ribbonWgsl from '../shaders/render/ribbon.wgsl';
import { bufferWithData, packStruct } from '../gpu/buffers';
import type { GpuAtlas } from '../marks/atlas';
import type { StructLayout } from '../marks/instance';
import { INK_FORMAT } from './sprites';

/** The `RibbonDraw` uniform of ribbon.wgsl. */
export const RIBBON_DRAW_LAYOUT: StructLayout = {
  name: 'RibbonDraw',
  size: 64,
  align: 16,
  fields: [
    { name: 'ink', type: 'vec4<f32>', offset: 0, size: 16 },
    { name: 'target_size', type: 'vec2<f32>', offset: 16, size: 8 },
    { name: 'edge', type: 'vec2<f32>', offset: 24, size: 8 },
    { name: 'px_per_unit', type: 'f32', offset: 32, size: 4 },
    { name: 'gain', type: 'f32', offset: 36, size: 4 },
    { name: 'cell', type: 'vec2<f32>', offset: 40, size: 8 },
    { name: 'max_lod', type: 'f32', offset: 48, size: 4 },
    { name: 'pad0', type: 'f32', offset: 52, size: 4 },
    { name: 'pad1', type: 'f32', offset: 56, size: 4 },
    { name: 'pad2', type: 'f32', offset: 60, size: 4 },
  ],
};

const BLEND: GPUBlendState = {
  color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
};

/** The pen lines' coverage target: one channel per sample (ADR 0019). */
export const PEN_MASK_FORMAT: GPUTextureFormat = 'rgba8unorm';

const MAX: GPUBlendState = {
  color: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
  alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
};

export class RibbonPipeline {
  readonly ribbon: GPURenderPipeline;
  readonly penMask: GPURenderPipeline;
  readonly penResolve: GPURenderPipeline;
  readonly ribbonLayout: GPUBindGroupLayout;
  readonly capsuleLayout: GPUBindGroupLayout;
  readonly resolveLayout: GPUBindGroupLayout;
  readonly sampler: GPUSampler;

  constructor(readonly device: GPUDevice) {
    const module = device.createShaderModule({ label: 'ribbon.wgsl', code: ribbonWgsl });
    const uniform: GPUBindGroupLayoutEntry = {
      binding: 0,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: { type: 'uniform' },
    };
    this.ribbonLayout = device.createBindGroupLayout({
      label: 'ribbon',
      entries: [
        uniform,
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d-array' },
        },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });
    this.capsuleLayout = device.createBindGroupLayout({
      label: 'capsule',
      entries: [
        uniform,
        { binding: 4, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });
    this.resolveLayout = device.createBindGroupLayout({
      label: 'pen resolve',
      entries: [
        uniform,
        {
          binding: 5,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d' },
        },
      ],
    });
    const make = (
      layout: GPUBindGroupLayout,
      vs: string,
      fs: string,
      label: string,
      target: GPUColorTargetState = { format: INK_FORMAT, blend: BLEND },
    ) =>
      device.createRenderPipeline({
        label,
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        vertex: { module, entryPoint: vs },
        fragment: { module, entryPoint: fs, targets: [target] },
        primitive: { topology: 'triangle-list' },
      });
    this.ribbon = make(this.ribbonLayout, 'vs_ribbon', 'fs_ribbon', 'ribbon');
    this.penMask = make(this.capsuleLayout, 'vs_capsule', 'fs_pen_mask', 'pen mask', {
      format: PEN_MASK_FORMAT,
      blend: MAX,
    });
    this.penResolve = make(this.resolveLayout, 'vs_pen_resolve', 'fs_pen_resolve', 'pen resolve');
    this.sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'repeat',
      addressModeV: 'clamp-to-edge',
    });
  }
}

interface DrawOpts {
  targetWidth: number;
  targetHeight: number;
  pxPerUnit: number;
  gain: number;
  ink?: readonly [number, number, number];
}

function drawUniforms(
  device: GPUDevice,
  opts: DrawOpts,
  atlas: GpuAtlas | null,
  label: string,
): GPUBuffer {
  return bufferWithData(
    device,
    packStruct(RIBBON_DRAW_LAYOUT, {
      ink: [...(opts.ink ?? [1, 1, 1]), 1],
      target_size: [opts.targetWidth, opts.targetHeight],
      edge: atlas?.data.edge ?? [0.12, 0.55],
      px_per_unit: opts.pxPerUnit,
      gain: opts.gain,
      cell: [atlas?.cellWidth ?? 1, atlas?.cellHeight ?? 1],
      max_lod: atlas?.maxLod ?? 0,
      pad0: 0,
      pad1: 0,
      pad2: 0,
    }),
    GPUBufferUsage.UNIFORM,
    label,
  );
}

/** One layer of textured ribbon segments (the strokes atlas must fit one texture array). */
export class RibbonBatch {
  private readonly uniforms: GPUBuffer;
  private readonly group: GPUBindGroup;

  constructor(
    private readonly pipe: RibbonPipeline,
    atlas: GpuAtlas,
    buffer: GPUBuffer,
    readonly count: number,
    opts: DrawOpts,
  ) {
    const arr = atlas.arrays[0];
    if (!arr || atlas.arrays.length !== 1) throw new Error('strokes must fit one texture array');
    this.uniforms = drawUniforms(pipe.device, opts, atlas, 'ribbon uniforms');
    this.group = pipe.device.createBindGroup({
      layout: pipe.ribbonLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniforms } },
        { binding: 1, resource: { buffer } },
        { binding: 2, resource: arr.view },
        { binding: 3, resource: pipe.sampler },
      ],
    });
  }

  encode(pass: GPURenderPassEncoder): void {
    if (!this.count) return;
    pass.setPipeline(this.pipe.ribbon);
    pass.setBindGroup(0, this.group);
    pass.draw(this.count * 6);
  }

  destroy(): void {
    this.uniforms.destroy();
  }
}

/**
 * One layer of pen lines (ADR 0019): `prepass` unions its quads per sample into the layer's own
 * coverage target, outside the ink pass; `encode` resolves that coverage over the ink.
 */
export class CapsuleBatch {
  private readonly uniforms: GPUBuffer;
  private readonly group: GPUBindGroup;
  private readonly mask: GPUTexture;
  private readonly maskView: GPUTextureView;
  private readonly resolveGroup: GPUBindGroup;

  constructor(
    private readonly pipe: RibbonPipeline,
    buffer: GPUBuffer,
    readonly count: number,
    opts: DrawOpts,
  ) {
    const d = pipe.device;
    this.uniforms = drawUniforms(d, opts, null, 'pen-line uniforms');
    this.group = d.createBindGroup({
      layout: pipe.capsuleLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniforms } },
        { binding: 4, resource: { buffer } },
      ],
    });
    this.mask = d.createTexture({
      label: 'pen-line coverage',
      size: [Math.max(1, opts.targetWidth), Math.max(1, opts.targetHeight)],
      format: PEN_MASK_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.maskView = this.mask.createView();
    this.resolveGroup = d.createBindGroup({
      layout: pipe.resolveLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniforms } },
        { binding: 5, resource: this.maskView },
      ],
    });
  }

  prepass(encoder: GPUCommandEncoder): void {
    const pass = encoder.beginRenderPass({
      label: 'pen-line coverage',
      colorAttachments: [
        { view: this.maskView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
      ],
    });
    if (this.count) {
      pass.setPipeline(this.pipe.penMask);
      pass.setBindGroup(0, this.group);
      pass.draw(this.count * 6);
    }
    pass.end();
  }

  encode(pass: GPURenderPassEncoder): void {
    if (!this.count) return;
    pass.setPipeline(this.pipe.penResolve);
    pass.setBindGroup(0, this.resolveGroup);
    pass.draw(3);
  }

  destroy(): void {
    this.uniforms.destroy();
    this.mask.destroy();
  }
}
