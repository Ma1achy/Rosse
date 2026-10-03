/**
 * The composite pass (ADR 0007): the ink target over Paper or Chalkboard into the output
 * (the canvas, or a texture in tests). Shader: src/shaders/render/composite.wgsl; CPU twin:
 * `composite` in src/fallback/raster.ts. Switching surface only rebuilds this pass's uniforms.
 */
import compositeWgsl from '../shaders/render/composite.wgsl';
import { packStruct } from '../gpu/buffers';
import type { ImageData8 } from '../marks/atlas';
import type { StructLayout } from '../marks/instance';
import { texelPerPx, type Surface } from './surface';

/** The `Composite` uniform of composite.wgsl. */
export const COMPOSITE_UNIFORMS_LAYOUT: StructLayout = {
  name: 'Composite',
  size: 48,
  align: 16,
  fields: [
    { name: 'field', type: 'vec4<f32>', offset: 0, size: 16 },
    { name: 'ink', type: 'vec4<f32>', offset: 16, size: 16 },
    { name: 'paper_size', type: 'vec2<f32>', offset: 32, size: 8 },
    { name: 'texel_per_px', type: 'f32', offset: 40, size: 4 },
    { name: 'blend_mode', type: 'u32', offset: 44, size: 4 },
  ],
};

export class CompositePass {
  private readonly pipelines = new Map<GPUTextureFormat, GPURenderPipeline>();
  private readonly layout: GPUBindGroupLayout;
  private readonly module: GPUShaderModule;
  private readonly paperTexture: GPUTexture;
  private readonly uniforms: GPUBuffer;

  constructor(
    readonly device: GPUDevice,
    readonly paper: ImageData8,
  ) {
    this.module = device.createShaderModule({ label: 'composite.wgsl', code: compositeWgsl });
    this.layout = device.createBindGroupLayout({
      label: 'composite',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'unfilterable-float' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'unfilterable-float' },
        },
      ],
    });
    this.paperTexture = device.createTexture({
      label: 'paper',
      size: [paper.width, paper.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture: this.paperTexture },
      paper.data,
      { bytesPerRow: paper.width * 4 },
      [paper.width, paper.height],
    );
    this.uniforms = device.createBuffer({
      label: 'composite uniforms',
      size: COMPOSITE_UNIFORMS_LAYOUT.size,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  private pipeline(format: GPUTextureFormat): GPURenderPipeline {
    let p = this.pipelines.get(format);
    if (!p) {
      p = this.device.createRenderPipeline({
        label: `composite ${format}`,
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
        vertex: { module: this.module, entryPoint: 'vs' },
        fragment: { module: this.module, entryPoint: 'fs', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      });
      this.pipelines.set(format, p);
    }
    return p;
  }

  /** Records the composite of `ink` onto `surface` into `output`. */
  encode(
    encoder: GPUCommandEncoder,
    ink: GPUTextureView,
    output: GPUTextureView,
    outputFormat: GPUTextureFormat,
    surface: Surface,
    dpr: number,
  ): void {
    this.device.queue.writeBuffer(
      this.uniforms,
      0,
      packStruct(COMPOSITE_UNIFORMS_LAYOUT, {
        field: [...surface.field, 1],
        ink: [...surface.palette.ink, 1],
        paper_size: [this.paper.width, this.paper.height],
        texel_per_px: texelPerPx(this.paper.width, dpr),
        blend_mode: surface.blend === 'overlay' ? 0 : 1,
      }),
    );
    const bindGroup = this.device.createBindGroup({
      layout: this.layout,
      entries: [
        { binding: 0, resource: { buffer: this.uniforms } },
        { binding: 1, resource: ink },
        { binding: 2, resource: this.paperTexture.createView() },
      ],
    });
    const pass = encoder.beginRenderPass({
      label: 'composite',
      colorAttachments: [
        { view: output, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
      ],
    });
    pass.setPipeline(this.pipeline(outputFormat));
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  destroy(): void {
    this.paperTexture.destroy();
    this.uniforms.destroy();
  }
}
