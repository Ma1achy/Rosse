/**
 * The lens on the GPU (ADR 0003, 0008, 0010, 0050): the lens tier (compute/lens-grid.wgsl and
 * lens-bin.wgsl, rebuilt when the lens changes, not when the camera moves) and the view tier
 * (compute/lens-query.wgsl, re-run on every camera move, because the sources' offsets follow the
 * camera: their images and what is made of them).
 *
 * Lens tier, per solver: the deflection and source-plane position of every vertex of the
 * (G + 1)² grid, the grid's extent (atomic min and max of ordered keys), each triangle's bins
 * (a box of integer bin indices; those covering more than 400 are skipped), a count, a prefix sum
 * and a scatter, and the triangle ids of each bin sorted ascending. Each source galaxy is sampled
 * and projected by the engine's own stipple (its own scene and camera: nothing global is swapped)
 * and its projected samples become marks (compute/lens-marks.wgsl); the sources' curves, drawn
 * parts and the quasar add theirs (src/sim/lens-pack.ts).
 *
 * View tier: every mark's images, κ from the fixed-point sum of the dot marks' magnification, how
 * many marks each (mark, image) slot makes, a deterministic scan per class, the marks, the quasar,
 * the curves' branches (v21's greedy matcher, one thread per curve) laid out as the line-work's
 * own curves, and the warped drawings' per-image instances. The line-work's passes
 * (src/render/ribbons.ts) expand the branches into ribbons and pieces, and the vector expansion
 * (src/render/vectors.ts, through its `post` hook) draws the drawings. Nothing is read back on
 * the frame path.
 *
 * CPU twin: src/fallback/lens.ts, kernels in src/fallback/kernels/lens.ts.
 */
import lensBinWgsl from '../shaders/compute/lens-bin.wgsl';
import lensGridWgsl from '../shaders/compute/lens-grid.wgsl';
import lensMarksWgsl from '../shaders/compute/lens-marks.wgsl';
import lensQueryWgsl from '../shaders/compute/lens-query.wgsl';
import { bufferWithData } from '../gpu/buffers';
import { INSTANCE_LAYOUT } from '../marks/instance';
import { sampleCount } from '../model/galaxy';
import type { GalaxyScene } from '../model/scene';
import { penWeights, type DrawingsMeta } from '../model/variation';
import { lensView, memberRows, MAX_IMAGES, type LensScene } from '../sim/lens';
import {
  IMG_LAYOUT,
  LENS_VIEW_CBASE,
  LENS_VIEW_CCAP,
  LENS_VIEW_WORDS,
  LMARK_LAYOUT,
  LSRC_LAYOUT,
  LSRC_WORDS,
  SOLVER_WORDS,
} from '../sim/lens-layouts';
import {
  LENS_BRANCH_SLOTS,
  layoutLens,
  lensRibbonDesc,
  lensVectorView,
  lensVectors,
  type LensLayers,
  type LensLayout,
  type LensVectors,
} from '../sim/lens-pack';
import { HALO_WORDS } from '../sim/lens';
import { ID_CAP_PER_TRIANGLE, LENS_CLASSES, LensCls, MAX_BRANCHES } from '../fallback/kernels/lens';
import { wobbleAmplitude } from '../view/warp';
import type { Camera } from '../view/camera';
import type { InkLayer } from './layers';
import { GpuRibbons } from './ribbons';
import { GpuVectors } from './vectors';

const STORAGE = GPUBufferUsage.STORAGE;
const SRC = GPUBufferUsage.COPY_SRC;
const DST = GPUBufferUsage.COPY_DST;

/** What the lens needs of the engine to sample a source galaxy: the stipple's own passes. */
export interface SourceRunner {
  /** samples, projects and compacts one source; its buffers hold until the next call */
  run(scene: GalaxyScene, cam: Camera): { n: number; projected: GPUBuffer; classes: GPUBuffer };
}

/** The main galaxy's buffers the lens's drawings read (its hand, its wobble). */
export interface MainBuffers {
  pool: GPUBuffer;
  dotBase: GPUBuffer;
  noise: GPUBuffer;
}

const GRID_ENTRIES = ['grid_vertices', 'grid_finish'] as const;
const BIN_ENTRIES = [
  'bin_count',
  'scan_local',
  'scan_blocks',
  'scan_add',
  'bin_scatter',
  'bin_sort',
] as const;
const QUERY_ENTRIES = [
  'query_marks',
  'count_marks',
  'quasar_images',
  'count_quasar',
  'scan_local',
  'scan_blocks',
  'emit_marks',
  'emit_quasar',
  'track_curves',
  'gather_branches',
  'vec_inst',
] as const;
type GridEntry = (typeof GRID_ENTRIES)[number];
type BinEntry = (typeof BIN_ENTRIES)[number];
type QueryEntry = (typeof QUERY_ENTRIES)[number];

/** The bindings each entry uses (its auto layout), per module. */
const GRID_USES: Record<GridEntry, number[]> = {
  grid_vertices: [0, 1, 2, 3, 4],
  grid_finish: [0, 3, 4],
};
const BIN_USES: Record<BinEntry, number[]> = {
  bin_count: [0, 1, 2, 3],
  scan_local: [0, 2, 3, 7, 8],
  scan_blocks: [0, 2, 5, 8],
  scan_add: [0, 2, 5, 7, 8],
  bin_scatter: [0, 1, 2, 4, 5],
  bin_sort: [0, 2, 5],
};
const QUERY_USES: Record<QueryEntry, number[]> = {
  query_marks: [0, 1, 2, 3, 4, 5, 6, 7],
  count_marks: [3, 4, 5, 6, 7, 8],
  quasar_images: [0, 3, 4, 5, 6, 7, 13, 16],
  count_quasar: [3, 8, 13],
  scan_local: [3, 8, 9],
  scan_blocks: [3, 9, 10, 11],
  emit_marks: [3, 4, 5, 6, 8, 10, 12],
  emit_quasar: [3, 8, 10, 12, 13, 14, 15, 17, 30],
  track_curves: [3, 6, 7, 18, 19, 20],
  gather_branches: [3, 18, 19, 20, 21, 22],
  vec_inst: [3, 6, 7, 23, 24],
};

function pipelines<E extends string>(
  device: GPUDevice,
  code: string,
  label: string,
  entries: readonly E[],
): Record<E, GPUComputePipeline> {
  const module = device.createShaderModule({ label, code });
  return Object.fromEntries(
    entries.map((e) => [
      e,
      device.createComputePipeline({
        label: `${label} ${e}`,
        layout: 'auto',
        compute: { module, entryPoint: e },
      }),
    ]),
  ) as Record<E, GPUComputePipeline>;
}

/** Everything the model tier holds. */
interface Model {
  L: LensScene;
  layout: LensLayout;
  vectors: LensVectors;
  instStatic: ArrayBuffer;
  own: GPUBuffer[];
  b: Record<string, GPUBuffer>;
  bind: Record<QueryEntry, GPUBindGroup>;
  ribbons: GpuRibbons;
  vecs: GpuVectors;
  /** star pool of the quasar */
  nStarPool: number;
  wobble: number;
  penDot: number;
  spike: number;
  nDotPool: number;
  key: number;
  mTime: number;
  P: GalaxyScene['P'];
  nSolvers: number;
}

export class GpuLens {
  private model: Model | null = null;

  private constructor(
    readonly device: GPUDevice,
    private readonly grid: Record<GridEntry, GPUComputePipeline>,
    private readonly bin: Record<BinEntry, GPUComputePipeline>,
    private readonly query: Record<QueryEntry, GPUComputePipeline>,
    private readonly marksPipe: GPUComputePipeline,
    private readonly runner: SourceRunner,
  ) {}

  static create(device: GPUDevice, runner: SourceRunner): GpuLens {
    return new GpuLens(
      device,
      pipelines(device, lensGridWgsl, 'lens-grid.wgsl', GRID_ENTRIES),
      pipelines(device, lensBinWgsl, 'lens-bin.wgsl', BIN_ENTRIES),
      pipelines(device, lensQueryWgsl, 'lens-query.wgsl', QUERY_ENTRIES),
      pipelines(device, lensMarksWgsl, 'lens-marks.wgsl', ['gather_marks'] as const).gather_marks,
      runner,
    );
  }

  get loaded(): boolean {
    return this.model !== null;
  }

  /** The layout of the marks (tests). */
  get layout(): LensLayout | null {
    return this.model?.layout ?? null;
  }

  /**
   * Model tier: the solvers' grids and bins, the sources sampled and projected, the table of
   * marks and every other table of the view tier.
   */
  load(scene: GalaxyScene, meta: DrawingsMeta, main: MainBuffers): void {
    this.destroyModel();
    const L = scene.lens;
    if (!L) throw new Error('no lens in the scene');
    const d = this.device;
    const own: GPUBuffer[] = [];
    const keep = (b: GPUBuffer) => {
      own.push(b);
      return b;
    };
    const buf = (bytes: number, usage: number, label: string) =>
      keep(d.createBuffer({ label, size: Math.max(16, Math.ceil(bytes / 4) * 4), usage }));
    const data = (x: ArrayBuffer | ArrayBufferView<ArrayBuffer>, usage: number, label: string) =>
      keep(bufferWithData(d, x, usage, label));

    // ---- the solvers
    const nS = L.solvers.length;
    const solverWords = new ArrayBuffer(nS * SOLVER_WORDS * 4);
    const su = new Uint32Array(solverWords);
    const sf = new Float32Array(solverWords);
    const halos: number[] = [];
    let vbase = 0;
    let obase = 0;
    const idCaps: number[] = [];
    L.solvers.forEach((s, i) => {
      const o = i * SOLVER_WORDS;
      const H = s.G * s.G;
      const idCap = ID_CAP_PER_TRIANGLE * 2 * H;
      idCaps.push(idCap);
      su[o] = s.G;
      su[o + 1] = s.G + 1;
      su[o + 2] = s.nHalo;
      su[o + 3] = halos.length / 4;
      su[o + 4] = vbase;
      su[o + 5] = obase;
      su[o + 7] = idCap;
      sf[o + 8] = s.R;
      sf[o + 9] = s.f;
      sf[o + 10] = s.cell;
      sf[o + 11] = s.shear[0];
      sf[o + 12] = s.shear[1];
      sf[o + 13] = s.shear[2];
      halos.push(...s.halos.subarray(0, s.nHalo * HALO_WORDS));
      vbase += (s.G + 1) * (s.G + 1);
      obase += H + 1;
    });
    const idStart = obase;
    let ids = idStart;
    L.solvers.forEach((_, i) => {
      su[i * SOLVER_WORDS + 6] = ids;
      ids += idCaps[i] ?? 0;
    });
    const solvers = data(solverWords, STORAGE | DST | SRC, 'lens solvers');
    const haloBuf = data(new Float32Array(halos), STORAGE, 'lens halos');
    const verts = buf(vbase * 16, STORAGE | SRC, 'lens grid');
    const bins = buf(ids * 4, STORAGE | SRC, 'lens bins');
    const counts = buf(obase * 4, STORAGE, 'lens bin counts');
    const cursor = buf(obase * 4, STORAGE, 'lens bin cursors');
    const maxBins = Math.max(...L.solvers.map((s) => s.G * s.G));
    const localRank = buf(maxBins * 4, STORAGE, 'lens scan');
    const blockTotals1 = buf(Math.ceil(maxBins / 256) * 4, STORAGE, 'lens scan blocks');
    const ext = buf(nS * 16, STORAGE | DST, 'lens extent');
    const gridGroups = (s: number) => {
      const job = data(new Uint32Array([s]), GPUBufferUsage.UNIFORM, `lens job ${String(s)}`);
      const b: Record<number, GPUBuffer> = {
        0: solvers,
        1: haloBuf,
        2: verts,
        3: ext,
        4: job,
      };
      return Object.fromEntries(
        GRID_ENTRIES.map((e) => [
          e,
          d.createBindGroup({
            layout: this.grid[e].getBindGroupLayout(0),
            entries: GRID_USES[e].map((binding) => ({
              binding,
              resource: { buffer: b[binding] as GPUBuffer },
            })),
          }),
        ]),
      ) as Record<GridEntry, GPUBindGroup>;
    };
    const binGroups = (s: number) => {
      const job = data(new Uint32Array([s]), GPUBufferUsage.UNIFORM, `lens bin job ${String(s)}`);
      const b: Record<number, GPUBuffer> = {
        0: solvers,
        1: verts,
        2: job,
        3: counts,
        4: cursor,
        5: bins,
        7: localRank,
        8: blockTotals1,
      };
      return Object.fromEntries(
        BIN_ENTRIES.map((e) => [
          e,
          d.createBindGroup({
            layout: this.bin[e].getBindGroupLayout(0),
            entries: BIN_USES[e].map((binding) => ({
              binding,
              resource: { buffer: b[binding] as GPUBuffer },
            })),
          }),
        ]),
      ) as Record<BinEntry, GPUBindGroup>;
    };
    // the extent starts as (max, min): the atomics only tighten it
    const extInit = new Uint32Array(nS * 4);
    for (let i = 0; i < nS; i++) extInit.set([0xffffffff, 0, 0xffffffff, 0], i * 4);
    d.queue.writeBuffer(ext, 0, extInit);
    const enc = d.createCommandEncoder({ label: 'lens tier' });
    const pass = enc.beginComputePass({ label: 'lens grid and bins' });
    L.solvers.forEach((s, i) => {
      const g = gridGroups(i);
      const b = binGroups(i);
      const H = s.G * s.G;
      const run = (p: GPUComputePipeline, group: GPUBindGroup, n: number) => {
        pass.setPipeline(p);
        pass.setBindGroup(0, group);
        pass.dispatchWorkgroups(n);
      };
      run(this.grid.grid_vertices, g.grid_vertices, Math.ceil(((s.G + 1) * (s.G + 1)) / 64));
      run(this.grid.grid_finish, g.grid_finish, 1);
      run(this.bin.bin_count, b.bin_count, Math.ceil((2 * H) / 64));
      run(this.bin.scan_local, b.scan_local, Math.ceil(H / 256));
      run(this.bin.scan_blocks, b.scan_blocks, 1);
      run(this.bin.scan_add, b.scan_add, Math.ceil(H / 64));
      run(this.bin.bin_scatter, b.bin_scatter, Math.ceil((2 * H) / 64));
      run(this.bin.bin_sort, b.bin_sort, Math.ceil(H / 64));
    });
    pass.end();
    d.queue.submit([enc.finish()]);

    // ---- the sources: each sampled and projected by the stipple (its own scene and camera),
    // then gathered as marks, as the runner's buffers hold only until its next call
    const sampleCounts = L.sources.map((s) => (s.scene ? sampleCount(s.scene.galaxy) : 0));
    const layout = layoutLens(L, sampleCounts, meta);
    const marks = buf(layout.nMarks * LMARK_LAYOUT.size, STORAGE | SRC | DST, 'lens marks');
    L.sources.forEach((s, si) => {
      if (!s.scene || !s.cam) return;
      const r = this.runner.run(s.scene, s.cam);
      const job = data(
        new Uint32Array([r.n, layout.stippleFirst[si] ?? 0, si, f32bits(s.k)]),
        GPUBufferUsage.UNIFORM,
        `lens marks job ${String(si)}`,
      );
      const group = d.createBindGroup({
        layout: this.marksPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: job } },
          { binding: 1, resource: { buffer: r.projected } },
          { binding: 2, resource: { buffer: r.classes } },
          { binding: 3, resource: { buffer: marks } },
        ],
      });
      const e = d.createCommandEncoder({ label: 'lens marks' });
      const p = e.beginComputePass();
      p.setPipeline(this.marksPipe);
      p.setBindGroup(0, group);
      p.dispatchWorkgroups(Math.ceil(r.n / 64));
      p.end();
      d.queue.submit([e.finish()]);
    });
    if (layout.tail.n) {
      d.queue.writeBuffer(
        marks,
        layout.tailFirst * LMARK_LAYOUT.size,
        layout.tail.f.buffer,
        0,
        layout.tail.n * LMARK_LAYOUT.size,
      );
    }

    // ---- the view tier's tables
    const nSlotsAll = layout.nSlots + layout.nQSlots;
    const lensVec = lensVectors(layout, meta, scene.P);
    const ribbonDesc = lensRibbonDesc(scene.ribbons, layout.maxPts);
    const ribbons = GpuRibbons.create(d);
    const dummyView = buf(64, GPUBufferUsage.UNIFORM, 'lens view (unused)');
    ribbons.load(ribbonDesc, dummyView, main.pool, main.dotBase, main.noise);
    const vecs = GpuVectors.create(d);
    vecs.load(lensVec.V.D, main.pool, main.dotBase, main.noise);
    const sstars = meta.vectors?.sstars?.kind ?? [];
    const starPool = sstars.flatMap((k, i) => (k === 'outline' || k === 'burst' ? [i] : []));
    const b: Record<string, GPUBuffer> = {
      solvers,
      verts,
      bins,
      lv: buf(LENS_VIEW_WORDS * 4, GPUBufferUsage.UNIFORM | DST, 'lens view'),
      marks,
      srcs: buf(Math.max(1, L.sources.length) * LSRC_LAYOUT.size, STORAGE | DST, 'lens sources'),
      imgs: buf(layout.nMarks * MAX_IMAGES * IMG_LAYOUT.size, STORAGE | SRC, 'lens images'),
      qmeta: buf((L.sources.length + layout.nMarks) * 4, STORAGE | SRC | DST, 'lens query meta'),
      slots: buf(nSlotsAll * 16, STORAGE | SRC, 'lens slots'),
      blockTotals: buf(LENS_CLASSES * layout.blocks * 4, STORAGE | SRC, 'lens slot blocks'),
      blockOffsets: buf(LENS_CLASSES * layout.blocks * 4, STORAGE | SRC, 'lens slot block offsets'),
      args: buf(
        LENS_CLASSES * 16,
        STORAGE | GPUBufferUsage.INDIRECT | SRC | DST,
        'lens draw arguments',
      ),
      out: buf(layout.totalInstances * INSTANCE_LAYOUT.size, STORAGE | SRC, 'lens instances'),
      qimgs: buf(9 * 16, STORAGE | SRC, 'lens quasar images'),
      pool: main.pool,
      dotBase: main.dotBase,
      halos: haloBuf,
      starPool: data(
        new Uint32Array(starPool.length ? starPool : [0]),
        STORAGE,
        'lens drawn-star pool',
      ),
      curvesIn: data(layout.curveIn, STORAGE, 'lens curves'),
      brawPts: buf(layout.brawPoints * 8, STORAGE | SRC, 'lens branch points'),
      brawN: buf(
        Math.max(1, layout.curves.length) * MAX_BRANCHES * 4,
        STORAGE | SRC,
        'lens branches',
      ),
      lvecs: data(layout.lvecs, STORAGE, 'lens drawings'),
      noise: main.noise,
    };
    const used: Record<number, GPUBuffer> = {
      0: b.solvers as GPUBuffer,
      1: b.verts as GPUBuffer,
      2: b.bins as GPUBuffer,
      3: b.lv as GPUBuffer,
      4: b.marks as GPUBuffer,
      5: b.srcs as GPUBuffer,
      6: b.imgs as GPUBuffer,
      7: b.qmeta as GPUBuffer,
      8: b.slots as GPUBuffer,
      9: b.blockTotals as GPUBuffer,
      10: b.blockOffsets as GPUBuffer,
      11: b.args as GPUBuffer,
      12: b.out as GPUBuffer,
      13: b.qimgs as GPUBuffer,
      14: b.pool as GPUBuffer,
      15: b.dotBase as GPUBuffer,
      16: b.halos as GPUBuffer,
      17: b.starPool as GPUBuffer,
      18: b.curvesIn as GPUBuffer,
      19: b.brawPts as GPUBuffer,
      20: b.brawN as GPUBuffer,
      21: ribbons.curveTable,
      22: ribbons.points,
      23: b.lvecs as GPUBuffer,
      24: vecs.instances,
      30: b.noise as GPUBuffer,
    };
    const bind = Object.fromEntries(
      QUERY_ENTRIES.map((e) => [
        e,
        d.createBindGroup({
          label: `lens ${e}`,
          layout: this.query[e].getBindGroupLayout(0),
          entries: QUERY_USES[e].map((binding) => ({
            binding,
            resource: { buffer: used[binding] as GPUBuffer },
          })),
        }),
      ]),
    ) as Record<QueryEntry, GPUBindGroup>;
    const pen = penWeights(scene.P.pen);
    this.model = {
      L,
      layout,
      vectors: lensVec.V,
      instStatic: lensVec.inst,
      own,
      b,
      bind,
      ribbons,
      vecs,
      nStarPool: starPool.length,
      wobble: wobbleAmplitude(scene.P.distort),
      penDot: Math.fround(pen.dot),
      spike: Math.fround(scene.variation.spike || 0),
      nDotPool: scene.galaxy.g.n_dot_pool,
      key: scene.galaxy.g.key,
      mTime: scene.P.mTime,
      P: scene.P,
      nSolvers: nS,
    };
  }

  /** View tier: this camera's uniforms and tables (the passes are `encode`). */
  setView(cam: Camera, mTime: number = this.need().mTime): void {
    const m = this.need();
    const { L, layout: lo } = m;
    const q = this.device.queue;
    const lv = lensView(L, cam);
    const f32 = Math.fround;
    // the sources as this view sees them
    const srcs = new ArrayBuffer(Math.max(1, L.sources.length) * LSRC_LAYOUT.size);
    const sf = new Float32Array(srcs);
    const su = new Uint32Array(srcs);
    L.sources.forEach((s, i) => {
      const o = i * LSRC_WORDS;
      sf[o] = lv.bc[i]?.[0] ?? 0;
      sf[o + 1] = lv.bc[i]?.[1] ?? 0;
      sf[o + 2] = s.k;
      sf[o + 3] = f32(s.dens);
      su[o + 4] = s.solver;
    });
    q.writeBuffer(m.b.srcs as GPUBuffer, 0, srcs);
    // the fixed-point sums start at zero
    q.writeBuffer(m.b.qmeta as GPUBuffer, 0, new Uint32Array(Math.max(1, L.sources.length)));
    const u = new ArrayBuffer(LENS_VIEW_WORDS * 4);
    const uu = new Uint32Array(u);
    const uf = new Float32Array(u);
    uu[0] = m.key >>> 0;
    uu[1] = lo.nMarks;
    uu[2] = lo.nSlots;
    uu[3] = lo.nQSlots;
    uu[4] = L.sources.length;
    uu[5] = lo.blocks;
    uu[6] = lo.curves.length;
    uu[7] = lo.nVec;
    uf[8] = lv.U;
    uf[9] = lv.ca;
    uf[10] = lv.sa;
    uf[11] = m.penDot;
    uf[12] = m.wobble;
    uf[13] = m.spike;
    uf[14] = f32((mTime / 2) % 1);
    uu[15] = Math.max(0, lo.quasarMark);
    uu[16] = m.nDotPool;
    uu[17] = m.nStarPool;
    uu[18] = lo.maxPts;
    uu[19] = LENS_BRANCH_SLOTS;
    lo.cbase.forEach((v, c) => {
      if (c < 8) uu[LENS_VIEW_CBASE + c] = v;
    });
    lo.ccap.forEach((v, c) => {
      if (c < 8) uu[LENS_VIEW_CCAP + c] = v;
    });
    q.writeBuffer(m.b.lv as GPUBuffer, 0, u);
    // the drawings: the static table with this view's member galaxies
    const vv = lensVectorView(m.vectors, m.instStatic, memberRows(L, cam), m.P, m.key, m.nDotPool);
    m.vecs.setView(vv);
    m.ribbons.setView(cam, m.P, m.nDotPool);
  }

  /** Records the view tier's passes. */
  encode(pass: GPUComputePassEncoder): void {
    const m = this.need();
    const lo = m.layout;
    const run = (e: QueryEntry, n: number, y = 1) => {
      if (!n) return;
      pass.setPipeline(this.query[e]);
      pass.setBindGroup(0, m.bind[e]);
      pass.dispatchWorkgroups(n, y);
    };
    run('query_marks', Math.ceil(lo.nMarks / 64));
    if (lo.quasarMark >= 0) run('quasar_images', 1);
    run('count_marks', Math.ceil(lo.nSlots / 64));
    run('count_quasar', Math.ceil(lo.nQSlots / 64));
    run('scan_local', lo.blocks, LENS_CLASSES);
    run('scan_blocks', LENS_CLASSES);
    run('emit_marks', Math.ceil(lo.nSlots / 64));
    run('emit_quasar', Math.ceil(lo.nQSlots / 64));
    if (lo.curves.length) {
      run('track_curves', lo.curves.length);
      run('gather_branches', 1);
    }
    m.ribbons.encodeExpand(pass);
    run('vec_inst', Math.ceil((lo.nVec * MAX_IMAGES) / 64));
    m.vecs.encode(pass);
  }

  /** The lens's ink layers, grouped by where they go among the galaxy's own. */
  layers(): LensLayers {
    const m = this.model;
    const none: LensLayers = {
      line: [],
      pieces: [],
      vectors: [],
      dots: [],
      knots: [],
      stars: [],
      cores: [],
    };
    if (!m) return none;
    const lo = m.layout;
    const cls = (atlas: 'dots' | 'knots' | 'stars' | 'cores', c: number): InkLayer => ({
      kind: 'gpu-sprites',
      atlas,
      gain: 1,
      source: {
        buffer: m.b.out as GPUBuffer,
        offset: (lo.cbase[c] ?? 0) * INSTANCE_LAYOUT.size,
        size: (lo.ccap[c] ?? 8) * INSTANCE_LAYOUT.size,
        indirect: m.b.args as GPUBuffer,
        indirectOffset: c * 16,
      },
    });
    const line = m.ribbons.layers();
    return {
      line: line.filter((l) => !('atlas' in l && l.atlas === 'pieces')),
      pieces: line.filter((l) => 'atlas' in l && l.atlas === 'pieces'),
      vectors: m.vecs.layers(),
      dots: [LensCls.old, LensCls.disc, LensCls.young].map((c) => cls('dots', c)),
      knots: [cls('knots', LensCls.knot)],
      stars: [cls('stars', LensCls.star)],
      cores: [cls('cores', LensCls.core)],
    };
  }

  /** Test and statistics only: the instances per class (a read-back of the draw arguments). */
  async readCounts(): Promise<number[]> {
    const m = this.need();
    const a = new Uint32Array(await this.read(m.b.args as GPUBuffer, LENS_CLASSES * 16));
    return Array.from({ length: LENS_CLASSES }, (_, c) => a[c * 4 + 1] ?? 0);
  }

  /** Test and statistics only: the warped drawings' capsules kept (a read-back). */
  async readVectorCaps(): Promise<number> {
    return (await this.need().vecs.readCounts()).nCaps;
  }

  /** Test only: the images and counts of the last view, and the instances per class. */
  async readQuery(): Promise<{
    imgs: ArrayBuffer;
    qmeta: Uint32Array;
    slots: Uint32Array;
    /** the scan's per-class block offsets (`LENS_CLASSES × blocks`) */
    blockOffsets: Uint32Array;
    blocks: number;
    out: ArrayBuffer;
    qimgs: Float32Array;
    brawN: Uint32Array;
    curves: ArrayBuffer;
    points: Float32Array;
  }> {
    const m = this.need();
    const lo = m.layout;
    const b = m.b;
    return {
      imgs: await this.read(b.imgs as GPUBuffer, lo.nMarks * MAX_IMAGES * IMG_LAYOUT.size),
      qmeta: new Uint32Array(
        await this.read(b.qmeta as GPUBuffer, (m.L.sources.length + lo.nMarks) * 4),
      ),
      slots: new Uint32Array(await this.read(b.slots as GPUBuffer, (lo.nSlots + lo.nQSlots) * 16)),
      blockOffsets: new Uint32Array(
        await this.read(b.blockOffsets as GPUBuffer, LENS_CLASSES * lo.blocks * 4),
      ),
      blocks: lo.blocks,
      out: await this.read(b.out as GPUBuffer, lo.totalInstances * INSTANCE_LAYOUT.size),
      qimgs: new Float32Array(await this.read(b.qimgs as GPUBuffer, 9 * 16)),
      brawN: new Uint32Array(
        await this.read(b.brawN as GPUBuffer, Math.max(1, lo.curves.length) * MAX_BRANCHES * 4),
      ),
      curves: await this.read(m.ribbons.curveTable, LENS_BRANCH_SLOTS * 48),
      points: new Float32Array(
        await this.read(m.ribbons.points, LENS_BRANCH_SLOTS * lo.maxPts * 8),
      ),
    };
  }

  /** Test only: the tables of the lens tier (grid, bins and each solver's extent). */
  async readSolvers(): Promise<{ solvers: Uint32Array; verts: Float32Array; bins: Uint32Array }> {
    const m = this.need();
    return {
      solvers: new Uint32Array(
        await this.read(m.b.solvers as GPUBuffer, m.nSolvers * SOLVER_WORDS * 4),
      ),
      verts: new Float32Array(
        await this.read(m.b.verts as GPUBuffer, (m.b.verts as GPUBuffer).size),
      ),
      bins: new Uint32Array(await this.read(m.b.bins as GPUBuffer, (m.b.bins as GPUBuffer).size)),
    };
  }

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

  private need(): Model {
    if (!this.model) throw new Error('load the lens first');
    return this.model;
  }

  private destroyModel(): void {
    const m = this.model;
    if (!m) return;
    for (const b of m.own) b.destroy();
    m.ribbons.destroy();
    m.vecs.unload();
    m.vecs.destroy();
    this.model = null;
  }

  destroy(): void {
    this.destroyModel();
  }
}

/** The bits of an f32, as a u32 (the marks' job carries `k` in a u32 slot of its uniform). */
function f32bits(x: number): number {
  return new Uint32Array(new Float32Array([x]).buffer)[0] ?? 0;
}
