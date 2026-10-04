/**
 * The stipple on the GPU (ADR 0003, 0010): the model tier (compute/stipple.wgsl, re-run only when
 * the scene changes) and the view tier (compute/project.wgsl, then the three entry points of
 * compute/scan.wgsl), giving one instance list per class in a single buffer
 * (`CLASS_COUNT × cap` slots) and the indirect draw arguments per class. The sprite pass draws
 * the lists with drawIndirect: nothing is read back on the frame path. The read-back helpers at
 * the end are for tests and statistics only.
 *
 * CPU twin: src/fallback/stipple.ts.
 */
import stippleWgsl from '../shaders/compute/stipple.wgsl';
import projectWgsl from '../shaders/compute/project.wgsl';
import scanWgsl from '../shaders/compute/scan.wgsl';
import { bufferWithData } from '../gpu/buffers';
import { INSTANCE_LAYOUT } from '../marks/instance';
import { CLASS_COUNT } from '../model/classes';
import { packGalaxy } from '../model/galaxy';
import {
  STIPPLE_LAYERS,
  buildScene,
  markCounts,
  type GalaxyScene,
  type MarkCounts,
  type SceneOptions,
} from '../model/scene';
import type { Params } from '../core/params';
import type { DrawingsMeta } from '../model/variation';
import { cameraOf, packView, viewDesc, type Camera } from '../view/camera';
import { TierState, type TierWork } from './tiers';
import { SAMPLE_LAYOUT } from '../fallback/kernels/stipple';
import { BLOCK_STRIDE, blockCount, classCapacity } from '../fallback/kernels/scan';
import type { GpuSpriteLayer } from './layers';

const STORAGE = GPUBufferUsage.STORAGE;

function pipeline(device: GPUDevice, code: string, entryPoint: string, label: string) {
  const module = device.createShaderModule({ label, code });
  return device.createComputePipeline({
    label: `${label} ${entryPoint}`,
    layout: 'auto',
    compute: { module, entryPoint },
  });
}

/** Model-tier buffers, sized for one scene. */
interface ModelBuffers {
  n: number;
  cap: number;
  blocks: number;
  galaxy: GPUBuffer;
  shape: GPUBuffer;
  pool: GPUBuffer;
  dotBase: GPUBuffer;
  samples: GPUBuffer;
  view: GPUBuffer;
  scan: GPUBuffer;
  projected: GPUBuffer;
  classes: GPUBuffer;
  rank: GPUBuffer;
  blockTotals: GPUBuffer;
  blockOffsets: GPUBuffer;
  args: GPUBuffer;
  out: GPUBuffer;
  groups: {
    stipple: GPUBindGroup;
    project: GPUBindGroup;
    local: GPUBindGroup;
    blocks: GPUBindGroup;
    scatter: GPUBindGroup;
  };
}

export class GpuStipple {
  private model: ModelBuffers | null = null;
  private scene: GalaxyScene | null = null;
  /** what `frame` last built (ADR 0010) */
  readonly tiers = new TierState();

  private constructor(
    readonly device: GPUDevice,
    private readonly pipes: {
      stipple: GPUComputePipeline;
      project: GPUComputePipeline;
      local: GPUComputePipeline;
      blocks: GPUComputePipeline;
      scatter: GPUComputePipeline;
    },
  ) {}

  static create(device: GPUDevice): GpuStipple {
    const [stipple, project, local, blocks, scatter] = [
      pipeline(device, stippleWgsl, 'main', 'stipple.wgsl'),
      pipeline(device, projectWgsl, 'main', 'project.wgsl'),
      pipeline(device, scanWgsl, 'scan_local', 'scan.wgsl'),
      pipeline(device, scanWgsl, 'scan_blocks', 'scan.wgsl'),
      pipeline(device, scanWgsl, 'scatter', 'scan.wgsl'),
    ];
    return new GpuStipple(device, { stipple, project, local, blocks, scatter });
  }

  /**
   * One frame's compute work, by tier (src/render/tiers.ts): the model tier (scene description
   * and stipple samples) only when a model parameter changed or the inclination crossed an `incE`
   * bucket; the view tier (projection, culls, compaction) when the camera or zoom moved.
   */
  frame(P: Params, zoom: number, meta: DrawingsMeta, opts: SceneOptions = {}): TierWork {
    return this.tiers.run(
      { P, zoom, modelKey: JSON.stringify(opts) },
      {
        model: () => {
          this.loadScene(buildScene(P, meta, opts));
        },
        view: () => {
          this.setView(cameraOf(P, zoom));
        },
      },
    );
  }

  /** The model tier's sample buffer (tests: it must survive a camera move). */
  get samplesBuffer(): GPUBuffer | null {
    return this.model?.samples ?? null;
  }

  /** The scene the model tier holds. */
  get current(): GalaxyScene | null {
    return this.scene;
  }

  /** Model tier: uploads the scene description and samples the stipple. */
  setScene(scene: GalaxyScene): void {
    this.tiers.invalidate();
    this.loadScene(scene);
  }

  private loadScene(scene: GalaxyScene): void {
    this.destroyModel();
    this.scene = scene;
    const d = this.device;
    const G = scene.galaxy;
    const n = G.g.n ?? 0;
    const cap = classCapacity(n);
    const blocks = blockCount(n);
    const buf = (size: number, usage: number, label: string) =>
      d.createBuffer({ label, size: Math.max(16, size), usage });
    const galaxy = bufferWithData(d, packGalaxy(G.g), GPUBufferUsage.UNIFORM, 'galaxy');
    const shape = bufferWithData(d, G.shape, STORAGE, 'galaxy shape');
    const pool = bufferWithData(d, G.pool, STORAGE, 'galaxy pools');
    const dotBase = bufferWithData(d, G.dotBase, STORAGE, 'dot sizes');
    const samples = buf(n * SAMPLE_LAYOUT.size, STORAGE | GPUBufferUsage.COPY_SRC, 'samples');
    const view = buf(64, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'view');
    const scan = bufferWithData(
      d,
      new Uint32Array([n, cap, blocks, 0]),
      GPUBufferUsage.UNIFORM,
      'scan',
    );
    const projected = buf(n * INSTANCE_LAYOUT.size, STORAGE | GPUBufferUsage.COPY_SRC, 'projected');
    const classes = buf(n * 4, STORAGE | GPUBufferUsage.COPY_SRC, 'classes');
    const rank = buf(n * 4, STORAGE, 'rank');
    const blockTotals = buf(blocks * 8, STORAGE, 'block totals');
    const blockOffsets = buf(blocks * BLOCK_STRIDE * 4, STORAGE, 'block offsets');
    const args = buf(
      CLASS_COUNT * 16,
      STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_SRC,
      'stipple draw args',
    );
    const out = buf(
      CLASS_COUNT * cap * INSTANCE_LAYOUT.size,
      STORAGE | GPUBufferUsage.COPY_SRC,
      'stipple instances',
    );
    const group = (p: GPUComputePipeline, entries: [number, GPUBuffer][]) =>
      d.createBindGroup({
        layout: p.getBindGroupLayout(0),
        entries: entries.map(([binding, buffer]) => ({ binding, resource: { buffer } })),
      });
    const P = this.pipes;
    this.model = {
      n,
      cap,
      blocks,
      galaxy,
      shape,
      pool,
      dotBase,
      samples,
      view,
      scan,
      projected,
      classes,
      rank,
      blockTotals,
      blockOffsets,
      args,
      out,
      groups: {
        stipple: group(P.stipple, [
          [0, galaxy],
          [1, shape],
          [2, pool],
          [3, dotBase],
          [4, samples],
        ]),
        project: group(P.project, [
          [0, view],
          [1, samples],
          [2, projected],
          [3, classes],
        ]),
        local: group(P.local, [
          [0, scan],
          [1, classes],
          [2, rank],
          [3, blockTotals],
        ]),
        blocks: group(P.blocks, [
          [0, scan],
          [3, blockTotals],
          [4, blockOffsets],
          [5, args],
        ]),
        scatter: group(P.scatter, [
          [0, scan],
          [1, classes],
          [2, rank],
          [4, blockOffsets],
          [6, projected],
          [7, out],
        ]),
      },
    };
    const enc = d.createCommandEncoder({ label: 'stipple model' });
    const pass = enc.beginComputePass({ label: 'stipple' });
    pass.setPipeline(P.stipple);
    pass.setBindGroup(0, this.model.groups.stipple);
    pass.dispatchWorkgroups(Math.ceil(n / 64) || 1);
    pass.end();
    d.queue.submit([enc.finish()]);
  }

  /** View tier: projection, culls and compaction for a camera. */
  setView(cam: Camera): void {
    const m = this.model;
    if (!m || !this.scene) throw new Error('setScene first');
    const d = this.device;
    d.queue.writeBuffer(
      m.view,
      0,
      packView(viewDesc(cam, this.scene.galaxy.g.dust ?? 0, m.n, m.cap)),
    );
    const enc = d.createCommandEncoder({ label: 'stipple view' });
    const pass = enc.beginComputePass({ label: 'project + compact' });
    const P = this.pipes;
    pass.setPipeline(P.project);
    pass.setBindGroup(0, m.groups.project);
    pass.dispatchWorkgroups(Math.ceil(m.n / 64) || 1);
    pass.setPipeline(P.local);
    pass.setBindGroup(0, m.groups.local);
    pass.dispatchWorkgroups(m.blocks);
    pass.setPipeline(P.blocks);
    pass.setBindGroup(0, m.groups.blocks);
    pass.dispatchWorkgroups(1);
    pass.setPipeline(P.scatter);
    pass.setBindGroup(0, m.groups.scatter);
    pass.dispatchWorkgroups(Math.ceil(m.n / 64) || 1);
    pass.end();
    d.queue.submit([enc.finish()]);
  }

  /** The drawn classes as indirect sprite layers, in draw order. */
  layers(): GpuSpriteLayer[] {
    const m = this.model;
    if (!m) return [];
    const bytes = m.cap * INSTANCE_LAYOUT.size;
    return STIPPLE_LAYERS.map((l) => ({
      kind: 'gpu-sprites',
      atlas: l.atlas,
      gain: 1,
      source: {
        buffer: m.out,
        offset: l.cls * bytes,
        size: bytes,
        indirect: m.args,
        indirectOffset: l.cls * 16,
      },
    }));
  }

  /** Test and statistics only: copies a buffer back. */
  private async read(src: GPUBuffer, size: number): Promise<ArrayBuffer> {
    const d = this.device;
    const dst = d.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = d.createCommandEncoder();
    enc.copyBufferToBuffer(src, 0, dst, 0, size);
    d.queue.submit([enc.finish()]);
    await dst.mapAsync(GPUMapMode.READ);
    const copy = dst.getMappedRange().slice(0);
    dst.unmap();
    dst.destroy();
    return copy;
  }

  async readCounts(): Promise<{ perClass: Uint32Array; counts: MarkCounts }> {
    const m = this.need();
    const a = new Uint32Array(await this.read(m.args, CLASS_COUNT * 16));
    const perClass = new Uint32Array(CLASS_COUNT);
    for (let c = 0; c < CLASS_COUNT; c++) perClass[c] = a[c * 4 + 1] ?? 0;
    return { perClass, counts: markCounts(perClass) };
  }

  async readSamples(): Promise<ArrayBuffer> {
    const m = this.need();
    return this.read(m.samples, m.n * SAMPLE_LAYOUT.size);
  }

  async readProjected(): Promise<{ classes: Uint32Array; instances: ArrayBuffer }> {
    const m = this.need();
    const classes = new Uint32Array(await this.read(m.classes, m.n * 4));
    return { classes, instances: await this.read(m.projected, m.n * INSTANCE_LAYOUT.size) };
  }

  async readInstances(): Promise<{ out: ArrayBuffer; cap: number }> {
    const m = this.need();
    return { out: await this.read(m.out, CLASS_COUNT * m.cap * INSTANCE_LAYOUT.size), cap: m.cap };
  }

  private need(): ModelBuffers {
    if (!this.model) throw new Error('setScene first');
    return this.model;
  }

  private destroyModel(): void {
    const m = this.model;
    if (!m) return;
    for (const b of [
      m.galaxy,
      m.shape,
      m.pool,
      m.dotBase,
      m.samples,
      m.view,
      m.scan,
      m.projected,
      m.classes,
      m.rank,
      m.blockTotals,
      m.blockOffsets,
      m.args,
      m.out,
    ])
      b.destroy();
    this.model = null;
  }

  destroy(): void {
    this.tiers.invalidate();
    this.destroyModel();
  }
}
