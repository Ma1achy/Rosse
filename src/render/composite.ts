/**
 * The composite pass (ADR 0007): the ink target over Paper or Chalkboard into the output
 * (the canvas, or a texture in tests). Shader: src/shaders/render/composite.wgsl; CPU twin:
 * `composite` in src/fallback/raster.ts. Switching surface only rebuilds this pass's uniforms.
 */
import compositeWgsl from '../shaders/render/composite.wgsl';
import { packStruct } from '../gpu/buffers';
import type { ImageData8 } from '../marks/atlas';
import type { StructLayout } from '../marks/instance';
import { compositeInk, type Plates } from './plates';
import { texelPerPx, type Surface } from './surface';

/** The `Composite` uniform of composite.wgsl. */
export const COMPOSITE_UNIFORMS_LAYOUT: StructLayout = {
  name: 'Composite',
  size: 112,
  align: 16,
  fields: [
    { name: 'field', type: 'vec4<f32>', offset: 0, size: 16 },
    { name: 'ink', type: 'vec4<f32>', offset: 16, size: 16 },
    { name: 'shadow0', type: 'vec4<f32>', offset: 32, size: 16 },
    { name: 'shadow1', type: 'vec4<f32>', offset: 48, size: 16 },
    { name: 'shadow_geom', type: 'vec4<f32>', offset: 64, size: 16 },
    { name: 'paper_size', type: 'vec2<f32>', offset: 80, size: 8 },
    { name: 'texel_per_px', type: 'f32', offset: 88, size: 4 },
    { name: 'blend_mode', type: 'u32', offset: 92, size: 4 },
    { name: 'plate_css', type: 'f32', offset: 96, size: 4 },
    { name: 'dpr', type: 'f32', offset: 100, size: 4 },
  ],
};

/** The uniform values for a surface at a plate size and DPR. */
export function compositeUniforms(
  surface: Surface,
  paper: { width: number; height: number },
  plateCss: number,
  dpr: number,
  plates: Plates = 'ink',
): ArrayBuffer {
  if (surface.shadows.length > 2) throw new Error('at most two inset shadows');
  const [s0, s1] = surface.shadows;
  return packStruct(COMPOSITE_UNIFORMS_LAYOUT, {
    field: [...surface.field, 1],
    // the key ink on the `ink` plate; white on the coloured plates, whose target holds the colours
    ink: [...compositeInk(plates, surface.palette), 1],
    shadow0: s0 ? s0.rgba : [0, 0, 0, 0],
    shadow1: s1 ? s1.rgba : [0, 0, 0, 0],
    shadow_geom: [s0?.spread ?? 0, (s0?.blur ?? 0) / 2, s1?.spread ?? 0, (s1?.blur ?? 0) / 2],
    paper_size: [paper.width, paper.height],
    texel_per_px: texelPerPx(paper.width, dpr),
    blend_mode: surface.blend === 'multiply' ? 0 : 1,
    plate_css: plateCss,
    dpr,
  });
}

export class CompositePass {
  private readonly pipelines = new Map<GPUTextureFormat, GPURenderPipeline>();
  private readonly layout: GPUBindGroupLayout;
  private readonly module: GPUShaderModule;
  private readonly paperTexture: GPUTexture;
  /**
   * One uniform buffer per (surface, plate size, DPR), written once, so two composites recorded
   * into one submit never share a buffer; and one bind group per ink view. Keyed on the Surface
   * object itself, so a surface built at run time gets its own entry.
   */
  private readonly bindings = new WeakMap<
    Surface,
    Map<string, { uniforms: GPUBuffer; groups: WeakMap<GPUTextureView, GPUBindGroup> }>
  >();
  private readonly buffers: GPUBuffer[] = [];
  private readonly paperView: GPUTextureView;

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
    this.paperView = this.paperTexture.createView();
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
    plateCss: number,
    dpr: number,
    plates: Plates = 'ink',
  ): void {
    const key = `${String(plateCss)}|${String(dpr)}|${plates}`;
    let perSurface = this.bindings.get(surface);
    if (!perSurface) {
      perSurface = new Map();
      this.bindings.set(surface, perSurface);
    }
    let entry = perSurface.get(key);
    if (!entry) {
      const data = compositeUniforms(surface, this.paper, plateCss, dpr, plates);
      const uniforms = this.device.createBuffer({
        label: `composite uniforms ${surface.name} ${key}`,
        size: data.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(uniforms, 0, data);
      this.buffers.push(uniforms);
      entry = { uniforms, groups: new WeakMap() };
      perSurface.set(key, entry);
    }
    let bindGroup = entry.groups.get(ink);
    if (!bindGroup) {
      bindGroup = this.device.createBindGroup({
        layout: this.layout,
        entries: [
          { binding: 0, resource: { buffer: entry.uniforms } },
          { binding: 1, resource: ink },
          { binding: 2, resource: this.paperView },
        ],
      });
      entry.groups.set(ink, bindGroup);
    }
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
    this.buffers.forEach((b) => {
      b.destroy();
    });
    this.buffers.length = 0;
  }
}
