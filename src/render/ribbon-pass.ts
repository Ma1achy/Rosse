/**
 * The ribbon pipelines (ADR 0007): textured stroke ribbons and pen-line capsules, pulled from
 * buffers written by compute/ribbons.wgsl, into the ink target. Shader: render/ribbon.wgsl.
 * Premultiplied, blend ONE / ONE_MINUS_SRC_ALPHA, no MSAA; six vertices per segment.
 */
import ribbonWgsl from '../shaders/render/ribbon.wgsl';
import { bufferWithData, packStruct } from '../gpu/buffers';
import type { GpuAtlas } from '../marks/atlas';
import type { StructLayout } from '../marks/instance';
import { INK_FORMAT } from './sprites';
import { KEY_STYLE, styleKey, withStyle, type PassStyle } from './pass-style';

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
    { name: 'off', type: 'vec2<f32>', offset: 56, size: 8 },
  ],
};

const BLEND: GPUBlendState = {
  color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
};

export class RibbonPipeline {
  readonly ribbon: GPURenderPipeline;
  readonly capsule: GPURenderPipeline;
  readonly ribbonLayout: GPUBindGroupLayout;
  readonly capsuleLayout: GPUBindGroupLayout;
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
    const make = (layout: GPUBindGroupLayout, vs: string, fs: string, label: string) =>
      device.createRenderPipeline({
        label,
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        vertex: { module, entryPoint: vs },
        fragment: { module, entryPoint: fs, targets: [{ format: INK_FORMAT, blend: BLEND }] },
        primitive: { topology: 'triangle-list' },
      });
    this.ribbon = make(this.ribbonLayout, 'vs_ribbon', 'fs_ribbon', 'ribbon');
    this.capsule = make(this.capsuleLayout, 'vs_capsule', 'fs_capsule', 'capsule');
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
  off?: readonly [number, number];
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
      off: opts.off ?? [0, 0],
    }),
    GPUBufferUsage.UNIFORM,
    label,
  );
}

/**
 * The uniforms and bind group of a layer for one pass of the plates (ink, gain, offset): made on
 * first use and kept, so switching plates builds a few uniform buffers and no instance data.
 */
class PassGroups<G> {
  private readonly made = new Map<string, { uniforms: GPUBuffer; group: G }>();

  constructor(
    private readonly opts: DrawOpts,
    private readonly build: (opts: DrawOpts) => { uniforms: GPUBuffer; group: G },
  ) {}

  get(style: PassStyle): G {
    const key = styleKey(style);
    let e = this.made.get(key);
    if (!e) {
      e = this.build(withStyle(this.opts, style));
      this.made.set(key, e);
    }
    return e.group;
  }

  destroy(): void {
    this.made.forEach((e) => {
      e.uniforms.destroy();
    });
    this.made.clear();
  }
}

/** One layer of textured ribbon segments (the strokes atlas must fit one texture array). */
export class RibbonBatch {
  private readonly groups: PassGroups<GPUBindGroup>;

  constructor(
    private readonly pipe: RibbonPipeline,
    atlas: GpuAtlas,
    buffer: GPUBuffer,
    readonly count: number,
    opts: DrawOpts,
  ) {
    const arr = atlas.arrays[0];
    if (!arr || atlas.arrays.length !== 1) throw new Error('strokes must fit one texture array');
    this.groups = new PassGroups(opts, (o) => {
      const uniforms = drawUniforms(pipe.device, o, atlas, 'ribbon uniforms');
      const group = pipe.device.createBindGroup({
        layout: pipe.ribbonLayout,
        entries: [
          { binding: 0, resource: { buffer: uniforms } },
          { binding: 1, resource: { buffer } },
          { binding: 2, resource: arr.view },
          { binding: 3, resource: pipe.sampler },
        ],
      });
      return { uniforms, group };
    });
  }

  /** The batch as the frame's `Batch` methods (its pop is the caller's). */
  bind() {
    return {
      encode: (pass: GPURenderPassEncoder, style: PassStyle) => {
        this.encode(pass, style);
      },
      destroy: () => {
        this.destroy();
      },
    };
  }

  encode(pass: GPURenderPassEncoder, style: PassStyle = KEY_STYLE): void {
    if (!this.count) return;
    pass.setPipeline(this.pipe.ribbon);
    pass.setBindGroup(0, this.groups.get(style));
    pass.draw(this.count * 6);
  }

  destroy(): void {
    this.groups.destroy();
  }
}

/**
 * One layer of pen-line capsules: `count` of them, or, with `indirect`, as many as its draw
 * arguments [6·n, 1, 0, 0] say (a compaction's output, `count` being the buffer's capacity).
 */
export class CapsuleBatch {
  private readonly groups: PassGroups<GPUBindGroup>;

  constructor(
    private readonly pipe: RibbonPipeline,
    buffer: GPUBuffer,
    readonly count: number,
    opts: DrawOpts,
    private readonly indirect?: GPUBuffer,
  ) {
    this.groups = new PassGroups(opts, (o) => {
      const uniforms = drawUniforms(pipe.device, o, null, 'capsule uniforms');
      const group = pipe.device.createBindGroup({
        layout: pipe.capsuleLayout,
        entries: [
          { binding: 0, resource: { buffer: uniforms } },
          { binding: 4, resource: { buffer } },
        ],
      });
      return { uniforms, group };
    });
  }

  /** The batch as the frame's `Batch` methods (its pop is the caller's). */
  bind() {
    return {
      encode: (pass: GPURenderPassEncoder, style: PassStyle) => {
        this.encode(pass, style);
      },
      destroy: () => {
        this.destroy();
      },
    };
  }

  encode(pass: GPURenderPassEncoder, style: PassStyle = KEY_STYLE): void {
    if (!this.count) return;
    pass.setPipeline(this.pipe.capsule);
    pass.setBindGroup(0, this.groups.get(style));
    if (this.indirect) pass.drawIndirect(this.indirect, 0);
    else pass.draw(this.count * 6);
  }

  destroy(): void {
    this.groups.destroy();
  }
}
