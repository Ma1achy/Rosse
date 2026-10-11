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
import breatheWgsl from '../shaders/compute/breathe.wgsl';
import starMarksWgsl from '../shaders/compute/star-marks.wgsl';
import { bufferWithData } from '../gpu/buffers';
import { GpuResources } from '../gpu/pool';
import type { GpuProfiler } from '../gpu/profile';
import { INSTANCE_LAYOUT, packInstances } from '../marks/instance';
import { CLASS_COUNT, Cls } from '../model/classes';
import { packGalaxy, sampleCount } from '../model/galaxy';
import { cullsUniform } from '../model/ribbons';
import { packStruct } from '../gpu/buffers';
import { CULLS_LAYOUT } from '../fallback/kernels/project';
import { GpuRibbons } from './ribbons';
import { GpuTide } from './tide';
import { GpuVectors } from './vectors';
import { GpuStarSet } from './star-set';
import { GpuSky } from './sky';
import { GpuLens } from './lens';
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
import { ZOOM_MAX, cameraOf, packView, perspOf, viewDesc, type Camera } from '../view/camera';
import { TierState, type TierWork } from './tiers';
import { SAMPLE_LAYOUT } from '../fallback/kernels/stipple';
import { STAR_JOB_LAYOUT, STAR_UNIFORM_LAYOUT, packStarJobs, starJobs } from '../model/stars';
import { wobbleAmplitude } from '../view/warp';
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
  /** the stipple's samples */
  n: number;
  /** the largest number of slots the compaction sees: the samples and the stars' marks at the top zoom */
  nTot: number;
  cap: number;
  blocks: number;
  /** the marks of a star or an artefact (M7): their jobs and uniform, and the pass that makes them */
  starJobs: GPUBuffer;
  starU: GPUBuffer;
  starGroup: GPUBindGroup | null;
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
  /** the breathing room's own compaction of the bright drawn stars (compute/breathe.wgsl) */
  room: {
    uniform: GPUBuffer;
    scan: GPUBuffer;
    keys: GPUBuffer;
    rank: GPUBuffer;
    totals: GPUBuffer;
    offsets: GPUBuffer;
    args: GPUBuffer;
    out: GPUBuffer;
    blocks: number;
    on: boolean;
    groups: {
      keys: GPUBindGroup;
      local: GPUBindGroup;
      blocks: GPUBindGroup;
      scatter: GPUBindGroup;
      clear: GPUBindGroup;
    };
  };
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
  /** a merger's discs, for the overlay star's dimming (ADR 0086); set by the merger engine each view */
  occluder: ((sx: number, sy: number, depth: number) => number) | null = null;
  /** the lens (M9), made when a lensed scene is first loaded; its sources are sampled by `scratch` */
  private lens: GpuLens | null = null;
  private scratch: GpuStipple | null = null;
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
      brightKeys: GPUComputePipeline;
      clear: GPUComputePipeline;
      starMarks: GPUComputePipeline;
    },
    /** the line-work (M4) */
    readonly ribbons: GpuRibbons,
    /** the placed vector drawings and the streams' marks (M5) */
    readonly vectors: GpuVectors,
    /** the drawn stars (M7) */
    readonly stars: GpuStarSet,
    /** the deep field, the foreground stars (M7) */
    readonly sky: GpuSky,
    /** a merging galaxy's tides (M8) */
    private readonly tideApply: GpuTide,
    /** the model tier's buffers: pooled scratch and shared uploads (M10) */
    readonly res: GpuResources,
  ) {}

  static create(device: GPUDevice): GpuStipple {
    const [stipple, extra, project, local, blocks, scatter, brightKeys, clear, starMarks] = [
      pipeline(device, stippleWgsl, 'main', 'stipple.wgsl'),
      pipeline(device, stippleWgsl, 'extra', 'stipple.wgsl'),
      pipeline(device, projectWgsl, 'main', 'project.wgsl'),
      pipeline(device, scanWgsl, 'scan_local', 'scan.wgsl'),
      pipeline(device, scanWgsl, 'scan_blocks', 'scan.wgsl'),
      pipeline(device, scanWgsl, 'scatter', 'scan.wgsl'),
      pipeline(device, breatheWgsl, 'bright_keys', 'breathe.wgsl'),
      pipeline(device, breatheWgsl, 'clear', 'breathe.wgsl'),
      pipeline(device, starMarksWgsl, 'star_marks', 'star-marks.wgsl'),
    ];
    const res = new GpuResources(device);
    return new GpuStipple(
      device,
      { stipple, extra, project, local, blocks, scatter, brightKeys, clear, starMarks },
      GpuRibbons.create(device, res),
      GpuVectors.create(device, res),
      GpuStarSet.create(device),
      GpuSky.create(device),
      GpuTide.create(device),
      res,
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
          this.runView(cameraOf(P, zoom), P.mTime);
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
    // the marks of a star or an artefact follow the samples in the compaction's buffers
    const nTot = n + scene.starSlots;
    const cap = classCapacity(nTot);
    const blocks = blockCount(nTot);
    // at least one element of every array, whatever n: a binding smaller than its WGSL type's
    // minimum (one element) is invalid, and would take the line-work's view pass down with it
    // when a scene has no stipple samples (QA D1)
    const res = this.res;
    const buf = (size: number, usage: number, label: string) =>
      res.scratch(Math.max(64, size), usage, label);
    const n1 = Math.max(1, n);
    // COPY_SRC: the tier tests read the model buffers back (never on the frame path)
    const SRC = GPUBufferUsage.COPY_SRC;
    const galaxy = res.data(packGalaxy(G.g), GPUBufferUsage.UNIFORM | SRC, 'galaxy');
    const shape = res.data(G.shape, STORAGE | SRC, 'galaxy shape');
    const pool = res.data(G.pool, STORAGE | SRC, 'galaxy pools');
    const dotBase = res.data(G.dotBase, STORAGE | SRC, 'dot sizes');
    const groupsBuf = res.data(G.groups, STORAGE | SRC, 'ring knots and clumps');
    const noise = res.data(G.noise.u, STORAGE | SRC, 'noise field');
    const samples = buf(n1 * SAMPLE_LAYOUT.size, STORAGE | GPUBufferUsage.COPY_SRC, 'samples');
    const view = buf(64, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'view');
    const culls = buf(CULLS_LAYOUT.size, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'culls');
    this.ribbons.load(scene.ribbons, view, pool, dotBase, noise);
    this.vectors.load(scene.vectors, pool, dotBase, noise, this.tide?.buffer);
    // rewritten each view (the sample count, M7's star slots): a scratch buffer, not a shared upload
    const scan = res.init(new Uint32Array([n, cap, blocks, 0]), GPUBufferUsage.UNIFORM, 'scan');
    const projected = buf(
      nTot * INSTANCE_LAYOUT.size,
      STORAGE | GPUBufferUsage.COPY_SRC,
      'projected',
    );
    const classes = buf(nTot * 4, STORAGE | GPUBufferUsage.COPY_SRC, 'classes');
    const rank = buf(nTot * 4, STORAGE, 'rank');
    const jobCap = scene.stars
      ? starJobs(scene.stars, scene.P, { ...cameraOf(scene.P), zoom: ZOOM_MAX }, scene.home).jobs
          .length
      : 0;
    const starJobsBuf = buf(
      jobCap * STAR_JOB_LAYOUT.size,
      STORAGE | GPUBufferUsage.COPY_DST,
      'star jobs',
    );
    const starU = buf(
      STAR_UNIFORM_LAYOUT.size,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      'star uniform',
    );
    const blockTotals = buf(blocks * 8, STORAGE, 'block totals');
    const blockOffsets = buf(blocks * BLOCK_STRIDE * 4, STORAGE, 'block offsets');
    const args = buf(
      CLASS_COUNT * 16,
      STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_SRC,
      'stipple draw args',
    );
    const out = buf(
      CLASS_COUNT * Math.max(1, cap) * INSTANCE_LAYOUT.size,
      STORAGE | GPUBufferUsage.COPY_SRC,
      'stipple instances',
    );
    // the breathing room: its own compaction of the bright drawn stars of the proposals
    const nMain = G.g.n;
    const capR = classCapacity(nMain);
    const blocksR = blockCount(nMain);
    const room = {
      uniform: bufferWithData(d, new Uint32Array([nMain, 0, 0, 0]), GPUBufferUsage.UNIFORM, 'room'),
      scan: bufferWithData(
        d,
        new Uint32Array([nMain, capR, blocksR, 0]),
        GPUBufferUsage.UNIFORM,
        'room scan',
      ),
      keys: buf(nMain * 4, STORAGE, 'room keys'),
      rank: buf(nMain * 4, STORAGE, 'room rank'),
      totals: buf(blocksR * 8, STORAGE, 'room block totals'),
      offsets: buf(blocksR * BLOCK_STRIDE * 4, STORAGE, 'room block offsets'),
      args: buf(CLASS_COUNT * 16, STORAGE, 'room args'),
      out: buf(capR * INSTANCE_LAYOUT.size, STORAGE, 'bright drawn stars'),
      blocks: blocksR,
      on: G.g.star_mix > 0.01 && nMain > 0,
    };
    const group = (p: GPUComputePipeline, entries: [number, GPUBuffer][]) =>
      d.createBindGroup({
        layout: p.getBindGroupLayout(0),
        entries: entries.map(([binding, buffer]) => ({ binding, resource: { buffer } })),
      });
    const P = this.pipes;
    this.model = {
      n,
      nTot,
      cap,
      blocks,
      starJobs: starJobsBuf,
      starU,
      starGroup: scene.stars
        ? group(P.starMarks, [
            [0, starU],
            [1, starJobsBuf],
            [2, pool],
            [3, dotBase],
            [4, projected],
            [5, classes],
            [30, noise],
          ])
        : null,
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
      room: {
        ...room,
        groups: {
          keys: group(P.brightKeys, [
            [0, room.uniform],
            [1, samples],
            [2, classes],
            [4, room.keys],
          ]),
          local: group(P.local, [
            [0, room.scan],
            [1, room.keys],
            [2, room.rank],
            [3, room.totals],
          ]),
          blocks: group(P.blocks, [
            [0, room.scan],
            [3, room.totals],
            [4, room.offsets],
            [5, room.args],
          ]),
          scatter: group(P.scatter, [
            [0, room.scan],
            [1, room.keys],
            [2, room.rank],
            [4, room.offsets],
            [6, projected],
            [7, room.out],
          ]),
          clear: group(P.clear, [
            [0, room.uniform],
            [2, classes],
            [3, projected],
            [5, room.out],
            [6, room.args],
          ]),
        },
      },
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
    this.stars.load(
      scene.P,
      scene.vectors.lib,
      scene.rstars,
      pool,
      dotBase,
      noise,
      out,
      args,
      Cls.rstar,
      cap,
    );
    this.sky.load(
      scene.P,
      scene.sky,
      scene.vectors.lib,
      view,
      pool,
      dotBase,
      noise,
      G.g.key,
      G.g.n_dot_pool,
    );
    const enc = d.createCommandEncoder({ label: 'stipple model' });
    const ts = this.profiler?.span('model: stipple');
    const pass = enc.beginComputePass({ label: 'stipple', ...(ts ? { timestampWrites: ts } : {}) });
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
    if (scene.lens) {
      this.lens ??= GpuLens.create(d, {
        run: (src, cam) => {
          const sc = (this.scratch ??= GpuStipple.create(d));
          sc.setScene(src);
          sc.setView(cam);
          const sm = sc.need();
          return { n: sm.n, projected: sm.projected, classes: sm.classes };
        },
      });
      this.lens.load(scene, scene.meta, { pool, dotBase, noise });
    } else this.lens?.destroy();
  }

  /** View tier: projection, culls and compaction for a camera. */
  setView(cam: Camera, mTime?: number): void {
    // a view `frame` did not choose: its record of the last view no longer holds
    this.tiers.invalidate();
    this.runView(cam, mTime);
  }

  private runView(cam: Camera, mTime?: number): void {
    const m = this.model;
    if (!m || !this.scene) throw new Error('setScene first');
    const d = this.device;
    const { P: params, galaxy } = this.scene;
    this.stars.setView(params, galaxy.g.key, galaxy.g.n_dot_pool);
    this.sky.setView(params, cam);
    // the marks of a star or an artefact for this view, after the samples (M7)
    const sj = this.scene.stars
      ? starJobs(
          this.scene.stars,
          params,
          cam,
          this.scene.home,
          galaxy.g.dust,
          this.occluder ?? undefined,
        )
      : null;
    const nStar = sj?.nSlots ?? 0;
    const nTot = m.n + nStar;
    this.nStarSlots = nStar;
    if (nTot > m.nTot) throw new Error('star marks beyond their capacity');
    d.queue.writeBuffer(
      m.view,
      0,
      packView(viewDesc(cam, galaxy.g.dust, m.n, m.cap, perspOf(params))),
    );
    d.queue.writeBuffer(m.scan, 0, new Uint32Array([nTot, m.cap, blockCount(nTot), 0]));
    if (sj && nStar) {
      d.queue.writeBuffer(m.starJobs, 0, packStarJobs(sj.jobs));
      d.queue.writeBuffer(
        m.starU,
        0,
        packStruct(STAR_UNIFORM_LAYOUT, {
          n_jobs: sj.jobs.length,
          n_slots: nStar,
          key: galaxy.g.key,
          n_dot_pool: galaxy.g.n_dot_pool,
          pen_dot: galaxy.g.pen_dot,
          wobble: wobbleAmplitude(params.distort),
          out_base: m.n,
          pad0: 0,
          pad1: 0,
          pad2: 0,
          pad3: 0,
          pad4: 0,
        }),
      );
    }
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
    // the quasar's flare follows the moment of the timeline, a view input (mTime)
    if (this.scene.lens && this.lens?.loaded) this.lens.setView(cam, mTime ?? params.mTime);
    const enc = d.createCommandEncoder({ label: 'stipple view' });
    const ts = this.profiler?.span('view: project, scan, expand');
    const pass = enc.beginComputePass({
      label: 'project + compact',
      ...(ts ? { timestampWrites: ts } : {}),
    });
    const P = this.pipes;
    this.ribbons.encodeProject(pass);
    pass.setPipeline(P.project);
    pass.setBindGroup(0, m.groups.project);
    pass.dispatchWorkgroups(Math.ceil(m.n / 64) || 1);
    if (m.starGroup && nStar) {
      // the marks of a star or an artefact, after the samples
      pass.setPipeline(P.starMarks);
      pass.setBindGroup(0, m.starGroup);
      pass.dispatchWorkgroups(Math.ceil(nStar / 64));
    }
    if (m.room.on) {
      // the breathing room round bright drawn stars: their own compaction, then the clearing
      const r = m.room;
      pass.setPipeline(P.brightKeys);
      pass.setBindGroup(0, r.groups.keys);
      pass.dispatchWorkgroups(Math.ceil(galaxy.g.n / 64));
      pass.setPipeline(P.local);
      pass.setBindGroup(0, r.groups.local);
      pass.dispatchWorkgroups(r.blocks);
      pass.setPipeline(P.blocks);
      pass.setBindGroup(0, r.groups.blocks);
      pass.dispatchWorkgroups(1);
      pass.setPipeline(P.scatter);
      pass.setBindGroup(0, r.groups.scatter);
      pass.dispatchWorkgroups(Math.ceil(galaxy.g.n / 64));
      pass.setPipeline(P.clear);
      pass.setBindGroup(0, r.groups.clear);
      pass.dispatchWorkgroups(Math.ceil(galaxy.g.n / 64));
    }
    // a merging galaxy: the stipple's marks carried by the tides, before the compaction reads them
    // (after the breathing room, which v21 clears before the warp)
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
    pass.dispatchWorkgroups(blockCount(nTot));
    pass.setPipeline(P.blocks);
    pass.setBindGroup(0, m.groups.blocks);
    pass.dispatchWorkgroups(1);
    pass.setPipeline(P.scatter);
    pass.setBindGroup(0, m.groups.scatter);
    pass.dispatchWorkgroups(Math.ceil(nTot / 64) || 1);
    this.ribbons.encodeExpand(pass);
    if (T) {
      this.ribbons.encodeTide(pass, this.tideApply, T.buffer, T.g, T.r2);
      this.warpCore(pass, T);
    }
    this.vectors.encode(pass);
    this.stars.encode(pass);
    this.sky.encode(pass);
    if (this.scene.lens && this.lens?.loaded) this.lens.encode(pass);
    pass.end();
    d.queue.submit([enc.finish()]);
  }

  /** Timestamps around the compute passes (M10; the profiling harness sets it, the page never does). */
  profiler: GpuProfiler | null = null;

  /** the camera of the last view (the cores are placed for it) */
  private camera: Camera | null = null;
  /** the star marks' slots of the last view */
  private nStarSlots = 0;

  /** The camera of the last view tier that ran (the SVG export lays the placed drawings out for it). */
  get lastCamera(): Camera | null {
    return this.camera;
  }

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
          // the core, its alternate style and the nuclear spiral (ADR 0073)
          size: 3 * INSTANCE.size,
          usage: STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        }),
        args: d.createBuffer({
          label: 'merging core args',
          size: 16,
          usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
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
    const LL = this.scene.lens && this.lens?.loaded ? this.lens.layers() : null;
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
    // v21 expands the hatching and the placed drawings into one line buffer: their pen-line
    // quads are one layer, one union per sample (ADR 0019)
    const placed = this.vectors.layers();
    const hatch = line.find((l) => l.kind === 'gpu-capsules');
    const parts = placed.find((l) => l.kind === 'gpu-capsules');
    const merged: InkLayer[] = [];
    if (hatch?.kind === 'gpu-capsules' && parts?.kind === 'gpu-capsules')
      merged.push({
        ...hatch,
        more: [
          {
            buffer: parts.buffer,
            count: parts.count,
            ...(parts.indirect ? { indirect: parts.indirect } : {}),
          },
        ],
      });
    else if (hatch ?? parts) merged.push((hatch ?? parts) as InkLayer);
    // the drawn core: last (v21), or with coreAuto first, under the disc's marks (ADR 0092)
    const coreLayer: InkLayer[] = cores.length
      ? [{ kind: 'sprites', atlas: 'cores', gain: 1, pop: 'old', instances: cores }]
      : [];
    const coreBehind = P.coreAuto > 0;
    return [
      ...this.sky.background(),
      ...(coreBehind ? [...coreLayer, ...tided] : []),
      ...line.filter((l) => !pieces.includes(l) && l !== hatch),
      ...merged,
      ...(LL?.line ?? []),
      ...placed.filter((l) => l !== parts),
      ...this.stars.layers(),
      ...(LL?.vectors ?? []),
      ...pieces,
      ...(LL?.pieces ?? []),
      ...stipple.slice(0, 3),
      ...(LL?.dots ?? []),
      ...this.vectors.streamLayers(),
      ...stipple.slice(3, 4),
      ...(LL?.knots ?? []),
      ...stipple.slice(4),
      ...(LL?.stars ?? []),
      ...(coreBehind ? [] : coreLayer),
      ...(LL?.cores ?? []),
      ...this.sky.foreground(),
      ...(coreBehind ? [] : tided),
    ];
  }

  /**
   * A merger's sky host (no galaxy): the sky's background, which goes under the merger, and every
   * other layer (trails, arrow, overlay stars, foreground stars), which go over it.
   */
  hostLayers(): { back: InkLayer[]; front: InkLayer[] } {
    const back = this.sky.background();
    return { back, front: this.inkLayers().slice(back.length) };
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
      pop: l.pop,
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
    const dst = this.res.pool.acquire(size, GPUBufferUsage.MAP_READ, 'readback', { zero: false });
    const enc = d.createCommandEncoder();
    enc.copyBufferToBuffer(src, 0, dst, 0, size);
    d.queue.submit([enc.finish()]);
    await dst.mapAsync(GPUMapMode.READ, 0, size);
    const copy = dst.getMappedRange(0, size).slice(0);
    dst.unmap();
    this.res.release(dst);
    return copy;
  }

  /**
   * The lens's layers alone, in the stipple's order (a merger carries a host's lens over its own
   * marks, app23.js:L1724).
   */
  lensLayers(): InkLayer[] {
    const LL = this.scene?.lens && this.lens?.loaded ? this.lens.layers() : null;
    return LL
      ? [...LL.line, ...LL.vectors, ...LL.pieces, ...LL.dots, ...LL.knots, ...LL.stars, ...LL.cores]
      : [];
  }

  /** The lens's instances per class (a read-back); empty without a lens. */
  async lensCounts(): Promise<number[]> {
    return this.scene?.lens && this.lens?.loaded ? this.lens.readCounts() : [];
  }

  /** `withLens: false` counts the galaxy's own marks alone (the stipple kernels' tests). */
  async readCounts(withLens = true): Promise<{ perClass: Uint32Array; counts: MarkCounts }> {
    const m = this.need();
    const a = new Uint32Array(await this.read(m.args, CLASS_COUNT * 16));
    const perClass = new Uint32Array(CLASS_COUNT);
    for (let c = 0; c < CLASS_COUNT; c++) perClass[c] = a[c * 4 + 1] ?? 0;
    const R = this.scene?.ribbons;
    // the lens's marks join the galaxy's, as v21 appends them to the same rows (M9)
    const lensCounts =
      withLens && this.scene?.lens && this.lens?.loaded ? await this.lens.readCounts() : [];
    const total = Uint32Array.from(perClass, (n, c) => n + (lensCounts[c] ?? 0));
    return {
      perClass: total,
      counts: {
        ...markCounts(total),
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

  /** Test only: the marks of stars and artefacts of the last view, class and instance per slot. */
  async readStarMarks(): Promise<{ classes: Uint32Array; instances: Float32Array; n: number }> {
    const m = this.need();
    const k = this.nStarSlots;
    if (!k) return { classes: new Uint32Array(0), instances: new Float32Array(0), n: 0 };
    const ib = INSTANCE_LAYOUT.size;
    const classes = new Uint32Array(await this.readAt(m.classes, m.n * 4, Math.max(1, k) * 4));
    const instances = new Float32Array(
      await this.readAt(m.projected, m.n * ib, Math.max(1, k) * ib),
    );
    return { classes, instances, n: k };
  }

  private async readAt(src: GPUBuffer, offset: number, size: number): Promise<ArrayBuffer> {
    const d = this.device;
    const bytes = Math.max(16, Math.ceil(size / 4) * 4);
    const dst = d.createBuffer({
      size: bytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const enc = d.createCommandEncoder();
    enc.copyBufferToBuffer(src, offset, dst, 0, bytes);
    d.queue.submit([enc.finish()]);
    await dst.mapAsync(GPUMapMode.READ);
    const copy = dst.getMappedRange().slice(0);
    dst.unmap();
    dst.destroy();
    return copy;
  }

  async readInstances(): Promise<{ out: ArrayBuffer; cap: number }> {
    const m = this.need();
    return { out: await this.read(m.out, CLASS_COUNT * m.cap * INSTANCE_LAYOUT.size), cap: m.cap };
  }

  /** The lens of the scene, when it has one (tests). */
  get lensTier(): GpuLens | null {
    return this.lens;
  }

  /** Samples, projected instances and classes of the last view: what the lens gathers its marks from. */
  get sampleBuffers(): { n: number; projected: GPUBuffer; classes: GPUBuffer } {
    const m = this.need();
    return { n: m.n, projected: m.projected, classes: m.classes };
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
      m.starJobs,
      m.starU,
      m.room.uniform,
      m.room.scan,
      m.room.keys,
      m.room.rank,
      m.room.totals,
      m.room.offsets,
      m.room.args,
      m.room.out,
    ])
      this.res.release(b);
    this.stars.unload();
    this.sky.unload();
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
    this.stars.destroy();
    this.sky.destroy();
    this.res.destroy();
    this.lens?.destroy();
    this.scratch?.destroy();
  }
}
