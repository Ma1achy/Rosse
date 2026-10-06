/**
 * The galaxy on the GPU (ADR 0003, 0010): the model tier (compute/stipple.wgsl, re-run only when
 * the scene changes: the proposals, then the ring knots' and clumps' marks) and the view tier
 * (compute/ribbons.wgsl `project_points`, compute/project.wgsl with the dust culls, the three entry
 * points of compute/scan.wgsl, then the rest of ribbons.wgsl), giving one instance list per class
 * in a single buffer (`CLASS_COUNT × cap` slots), the indirect draw arguments per class, and the
 * line-work's ribbons, capsules and pieces (./ribbons.ts). The ink passes draw them with direct or
 * indirect draws: nothing is read back on the frame path. The read-back helpers at the end are for
 * tests and statistics only.
 *
 * CPU twin: src/fallback/stipple.ts.
 */
import stippleWgsl from '../shaders/compute/stipple.wgsl';
import projectWgsl from '../shaders/compute/project.wgsl';
import scanWgsl from '../shaders/compute/scan.wgsl';
import { bufferWithData } from '../gpu/buffers';
import { INSTANCE_LAYOUT, packInstances } from '../marks/instance';
import { CLASS_COUNT } from '../model/classes';
import { packGalaxy, sampleCount } from '../model/galaxy';
import { cullsUniform } from '../model/ribbons';
import { packStruct } from '../gpu/buffers';
import { CULLS_LAYOUT } from '../fallback/kernels/project';
import { GpuRibbons } from './ribbons';
import { GpuTide } from './tide';
import { GpuVectors } from './vectors';
import { hatchRows, vectorView } from '../model/vectors';
import { coreInstances } from '../model/parts';
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
import { INSTANCE_LAYOUT as INSTANCE } from '../marks/instance';
import { BLOCK_STRIDE, blockCount, classCapacity } from '../fallback/kernels/scan';
import type { GpuSpriteLayer, InkLayer } from './layers';

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
  groupsBuf: GPUBuffer;
  noise: GPUBuffer;
  samples: GPUBuffer;
  view: GPUBuffer;
  culls: GPUBuffer;
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
    extra: GPUBindGroup;
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
  /** the drawings' metadata the model tier was built with (part of its key) */
  private meta: DrawingsMeta | null = null;
  /**
   * A merging galaxy (M8): the tidal map's buffer and which galaxy this is. Its marks are carried
   * by the tides after the single-galaxy kernels have made them (compute/tide-apply.wgsl).
   */
  private tide: { buffer: GPUBuffer; g: 0 | 1; r2: number } | null = null;
  /** the drawn core, warped on the GPU when there are tides: its instance and draw arguments */
  private core: { inst: GPUBuffer; args: GPUBuffer; count: number } | null = null;

  private constructor(
    readonly device: GPUDevice,
    private readonly pipes: {
      stipple: GPUComputePipeline;
      extra: GPUComputePipeline;
      project: GPUComputePipeline;
      local: GPUComputePipeline;
      blocks: GPUComputePipeline;
      scatter: GPUComputePipeline;
    },
    /** the line-work (M4) */
    readonly ribbons: GpuRibbons,
    /** the placed vector drawings and the streams' marks (M5) */
    readonly vectors: GpuVectors,
    /** a merging galaxy's tides (M8) */
    private readonly tideApply: GpuTide,
  ) {}

  static create(device: GPUDevice): GpuStipple {
    const [stipple, extra, project, local, blocks, scatter] = [
      pipeline(device, stippleWgsl, 'main', 'stipple.wgsl'),
      pipeline(device, stippleWgsl, 'extra', 'stipple.wgsl'),
      pipeline(device, projectWgsl, 'main', 'project.wgsl'),
      pipeline(device, scanWgsl, 'scan_local', 'scan.wgsl'),
      pipeline(device, scanWgsl, 'scan_blocks', 'scan.wgsl'),
      pipeline(device, scanWgsl, 'scatter', 'scan.wgsl'),
    ];
    return new GpuStipple(
      device,
      { stipple, extra, project, local, blocks, scatter },
      GpuRibbons.create(device),
      GpuVectors.create(device),
      GpuTide.create(device),
    );
  }

  /**
   * A merging galaxy: carry its marks by the tidal map in `buffer` (galaxy `g`). Call before
   * `setScene`; `null` makes this a single galaxy again. R2 (the plate px the map's grid spans) is
   * the view's: `setTideR2`.
   */
  setTide(buffer: GPUBuffer | null, g: 0 | 1 = 0): void {
    this.tide = buffer ? { buffer, g, r2: this.tide?.r2 ?? 1 } : null;
    this.tiers.invalidate();
    this.tideApply.reset();
  }

  /** The plate px the tidal grid spans for the next view (2 · 4.2 · s0, app23.js:L1243). */
  setTideR2(r2: number): void {
    if (this.tide) this.tide.r2 = r2;
  }

  /**
   * One frame's compute work, by tier (src/render/tiers.ts): the model tier (scene description
   * and stipple samples) only when a model parameter changed or the structure signature changes
   * (`structureKey`, ADR 0017); the view tier (projection, culls, compaction) when the camera or
   * zoom moved.
   */
  frame(P: Params, zoom: number, meta: DrawingsMeta, opts: SceneOptions = {}): TierWork {
    // other drawings (a reload of the atlases) are another model
    if (meta !== this.meta) this.tiers.invalidate();
    return this.tiers.run(
      { P, zoom, modelKey: JSON.stringify(opts) },
      {
        model: () => {
          this.loadScene(buildScene(P, meta, opts));
          this.meta = meta;
        },
        view: () => {
          this.runView(cameraOf(P, zoom));
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
    this.meta = null;
    this.loadScene(scene);
  }

  private loadScene(scene: GalaxyScene): void {
    this.destroyModel();
    this.scene = scene;
    const d = this.device;
    const G = scene.galaxy;
    // every sample: the proposals, then the ring knots' and clumps' marks
    const n = sampleCount(G);
    const nExtra = G.g.n_extra;
    const cap = classCapacity(n);
    const blocks = blockCount(n);
    const buf = (size: number, usage: number, label: string) =>
      d.createBuffer({ label, size: Math.max(16, size), usage });
    // COPY_SRC: the tier tests read the model buffers back (never on the frame path)
    const SRC = GPUBufferUsage.COPY_SRC;
    const galaxy = bufferWithData(d, packGalaxy(G.g), GPUBufferUsage.UNIFORM | SRC, 'galaxy');
    const shape = bufferWithData(d, G.shape, STORAGE | SRC, 'galaxy shape');
    const pool = bufferWithData(d, G.pool, STORAGE | SRC, 'galaxy pools');
    const dotBase = bufferWithData(d, G.dotBase, STORAGE | SRC, 'dot sizes');
    const groupsBuf = bufferWithData(d, G.groups, STORAGE | SRC, 'ring knots and clumps');
    const noise = bufferWithData(d, G.noise.u, STORAGE | SRC, 'noise field');
    const samples = buf(n * SAMPLE_LAYOUT.size, STORAGE | GPUBufferUsage.COPY_SRC, 'samples');
    const view = buf(64, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'view');
    const culls = buf(CULLS_LAYOUT.size, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'culls');
    this.ribbons.load(scene.ribbons, view, pool, dotBase, noise);
    this.vectors.load(scene.vectors, pool, dotBase, noise, this.tide?.buffer);
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
      groupsBuf,
      noise,
      samples,
      view,
      culls,
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
          [30, noise],
        ]),
        extra: group(P.extra, [
          [0, galaxy],
          [2, pool],
          [3, dotBase],
          [4, samples],
          [5, groupsBuf],
        ]),
        project: group(P.project, [
          [0, view],
          [1, samples],
          [2, projected],
          [3, classes],
          [4, culls],
          [5, this.ribbons.points],
          [6, this.ribbons.carve],
          [30, noise],
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
    pass.dispatchWorkgroups(Math.ceil(G.g.n / 64) || 1);
    if (nExtra) {
      pass.setPipeline(P.extra);
      pass.setBindGroup(0, this.model.groups.extra);
      pass.dispatchWorkgroups(Math.ceil(nExtra / 64));
    }
    pass.end();
    d.queue.submit([enc.finish()]);
  }

  /** View tier: projection, culls and compaction for a camera. */
  setView(cam: Camera): void {
    // a view `frame` did not choose: its record of the last view no longer holds
    this.tiers.invalidate();
    this.runView(cam);
  }

  private runView(cam: Camera): void {
    const m = this.model;
    if (!m || !this.scene) throw new Error('setScene first');
    const d = this.device;
    const { P: params, galaxy } = this.scene;
    d.queue.writeBuffer(m.view, 0, packView(viewDesc(cam, galaxy.g.dust, m.n, m.cap)));
    d.queue.writeBuffer(
      m.culls,
      0,
      packStruct(CULLS_LAYOUT, cullsUniform(this.scene.ribbons, cam, params, galaxy.g.key)),
    );
    this.ribbons.setView(cam, params, galaxy.g.n_dot_pool);
    const { variation, meta } = this.scene;
    this.vectors.setView(
      vectorView(
        this.scene.vectors,
        params,
        variation,
        meta,
        cam,
        galaxy.g.key,
        galaxy.g.n_dot_pool,
        this.tide?.r2 ?? 0,
        this.tide ? hatchRows(this.scene.ribbons, cam) : [],
      ),
    );
    this.camera = cam;
    const enc = d.createCommandEncoder({ label: 'stipple view' });
    const pass = enc.beginComputePass({ label: 'project + compact' });
    const P = this.pipes;
    this.ribbons.encodeProject(pass);
    pass.setPipeline(P.project);
    pass.setBindGroup(0, m.groups.project);
    pass.dispatchWorkgroups(Math.ceil(m.n / 64) || 1);
    // a merging galaxy: the stipple's marks carried by the tides, before the compaction reads them
    const T = this.tide;
    if (T)
      this.tideApply.encode(pass, T.buffer, {
        key: 'projected',
        entry: 'warp_instances',
        buffer: m.projected,
        n: m.n,
        g: T.g,
        r2: T.r2,
      });
    pass.setPipeline(P.local);
    pass.setBindGroup(0, m.groups.local);
    pass.dispatchWorkgroups(m.blocks);
    pass.setPipeline(P.blocks);
    pass.setBindGroup(0, m.groups.blocks);
    pass.dispatchWorkgroups(1);
    pass.setPipeline(P.scatter);
    pass.setBindGroup(0, m.groups.scatter);
    pass.dispatchWorkgroups(Math.ceil(m.n / 64) || 1);
    this.ribbons.encodeExpand(pass);
    if (T) {
      this.ribbons.encodeTide(pass, this.tideApply, T.buffer, T.g, T.r2);
      this.warpCore(pass, T);
    }
    this.vectors.encode(pass);
    pass.end();
    d.queue.submit([enc.finish()]);
  }

  /** the camera of the last view (the cores are placed for it) */
  private camera: Camera | null = null;

  /**
   * The drawn core and nuclear spiral of a merging galaxy: placed on the CPU for the view as ever,
   * then carried by the tides on the GPU (v21: `inst(L.cores, …)`, app23.js:L1028, goes through SM).
   */
  private warpCore(
    pass: GPUComputePassEncoder,
    T: { buffer: GPUBuffer; g: 0 | 1; r2: number },
  ): void {
    if (!this.scene || !this.camera) return;
    const { P, meta, galaxy, vectors } = this.scene;
    const cores = coreInstances(P, meta, this.camera, galaxy.noise, vectors.parts.picks.nuclear);
    const d = this.device;
    if (!this.core) {
      this.core = {
        inst: d.createBuffer({
          label: 'merging core',
          size: 2 * INSTANCE.size,
          usage: STORAGE | GPUBufferUsage.COPY_DST,
        }),
        args: d.createBuffer({
          label: 'merging core args',
          size: 16,
          usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
        }),
        count: 0,
      };
    }
    this.core.count = cores.length;
    d.queue.writeBuffer(this.core.inst, 0, packInstances(cores));
    d.queue.writeBuffer(this.core.args, 0, new Uint32Array([4, cores.length, 0, 0]));
    this.tideApply.encode(pass, T.buffer, {
      key: 'core',
      entry: 'warp_instances',
      buffer: this.core.inst,
      n: cores.length,
      g: T.g,
      r2: T.r2,
    });
  }

  /**
   * Every ink layer of the galaxy, in the reference's order (scene(), app23.js:L1289–1301): the
   * stroke ribbons, the vector drawings (the hatching's, then the placed parts': lines, dots,
   * blobs; line ink), the pieces (young), the stipple's old, disc and young dots, the streams' dots
   * and knots (old), knots (hii), sparkle stars (young), then the drawn core and nuclear spiral
   * (old; placed on the CPU for the last view).
   */
  inkLayers(): InkLayer[] {
    if (!this.model || !this.scene || !this.camera) return [];
    const line = this.ribbons.layers();
    const pieces = line.filter((l) => 'atlas' in l && l.atlas === 'pieces');
    const stipple = this.layers();
    const { P, meta, galaxy, vectors } = this.scene;
    const cores = this.tide
      ? []
      : coreInstances(P, meta, this.camera, galaxy.noise, vectors.parts.picks.nuclear);
    const tided: InkLayer[] =
      this.tide && this.core?.count
        ? [
            {
              kind: 'gpu-sprites',
              atlas: 'cores',
              gain: 1,
              source: {
                buffer: this.core.inst,
                offset: 0,
                size: Math.max(16, this.core.count * INSTANCE.size),
                indirect: this.core.args,
                indirectOffset: 0,
              },
            },
          ]
        : [];
    return [
      ...line.filter((l) => !pieces.includes(l)),
      ...this.vectors.layers(),
      ...pieces,
      ...stipple.slice(0, 3),
      ...this.vectors.streamLayers(),
      ...stipple.slice(3),
      ...(cores.length
        ? [{ kind: 'sprites', atlas: 'cores', gain: 1, instances: cores } as InkLayer]
        : []),
      ...tided,
    ];
  }

  /** The line-work's layers (ribbons, hatching, pieces), drawn before the stipple. */
  lineLayers(): InkLayer[] {
    return this.model ? this.ribbons.layers() : [];
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
    const R = this.scene?.ribbons;
    return {
      perClass,
      counts: {
        ...markCounts(perClass),
        curves: R?.nCurves ?? 0,
        pieces: await this.ribbons.readPieceCount(),
        ribbonSegments: R?.nSegs ?? 0,
        hatches: R?.nHatch ?? 0,
        ...(await this.vectorCounts()),
      },
    };
  }

  /** The placed drawings' counts (a read-back of the compactions' draw arguments). */
  private async vectorCounts(): Promise<Partial<MarkCounts>> {
    const D = this.scene?.vectors;
    if (!D) return {};
    const v = await this.vectors.readCounts();
    return {
      drawings: D.nInst,
      vectorCaps: v.nCaps,
      vectorDots: D.nDots,
      vectorBlobs: D.nBlobs,
      streamDots: v.nSdots,
      streamKnots: v.nSknots,
    };
  }

  /** Test only: every model-tier buffer (galaxy uniform, shape, pools, dot sizes, samples). */
  async readModel(): Promise<
    Record<'galaxy' | 'shape' | 'pool' | 'dotBase' | 'samples', ArrayBuffer>
  > {
    const m = this.need();
    return {
      galaxy: await this.read(m.galaxy, m.galaxy.size),
      shape: await this.read(m.shape, m.shape.size),
      pool: await this.read(m.pool, m.pool.size),
      dotBase: await this.read(m.dotBase, m.dotBase.size),
      samples: await this.read(m.samples, m.n * SAMPLE_LAYOUT.size),
    };
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
      m.groupsBuf,
      m.noise,
      m.samples,
      m.view,
      m.culls,
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
    this.ribbons.destroy();
    this.vectors.unload();
    this.core?.inst.destroy();
    this.core?.args.destroy();
    this.core = null;
    this.model = null;
  }

  destroy(): void {
    this.tiers.invalidate();
    this.destroyModel();
    this.vectors.destroy();
  }
}
