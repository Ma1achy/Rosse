/**
 * A merger on the GPU (ADR 0003, 0009, 0010), tier by tier.
 *
 * **Model tier, `build`** (asynchronous: the integration runs in chunks, ./merger-stars.ts):
 * the scene (src/model/merger.ts), the test stars to the chosen moment and the horizon, the one
 * read-back of the model tier (the distances `frameOf` reads, a few thousand floats), the tidal
 * map's bins (./tide.ts), each merging galaxy built as a single galaxy and carried by its tides
 * (./stipple.ts `setTide`), and `mWarp`'s drawings.
 *
 * **View tier, `view(zoom)`**: the state at `mTime` (`blend`), the debris's marks and the stars'
 * plate positions (compute/merger-sprites.wgsl), the thinned debris compacted by class, the tidal
 * grids, then each galaxy's own view tier with its R2 and its camera, and `mWarp`. Nothing is read
 * back. Changing `mTime` only re-runs this tier (ADR 0009: it never re-integrates).
 *
 * CPU twin: src/fallback/merger.ts.
 */
import mergerSpritesWgsl from '../shaders/compute/merger-sprites.wgsl';
import scanWgsl from '../shaders/compute/scan.wgsl';
import { bufferWithData } from '../gpu/buffers';
import { readBuffer } from '../gpu/readback';
import { INSTANCE_LAYOUT } from '../marks/instance';
import { MVIEW_LAYOUT } from '../fallback/kernels/merger-sprites';
import { MERGER_SLOTS } from '../fallback/kernels/merger-sprites';
import { BLOCK_STRIDE, blockCount, classCapacity } from '../fallback/kernels/scan';
import { CLASS_COUNT, Cls } from '../model/classes';
import {
  buildMergerScene,
  framesFromRadii,
  mergerFraming,
  mergerViewUniform,
  mwarpDesc,
  mwarpView,
  packMergerView,
  type MergerFraming,
  type MergerScene,
  type MergerSceneOptions,
} from '../model/merger';
import { cameraOf } from '../view/camera';
import { markCounts, STIPPLE_LAYERS, type MarkCounts } from '../model/scene';
import type { DrawingsMeta } from '../model/variation';
import type { Params } from '../core/params';
import { wholeFrame, type MergerFrame } from '../sim/merger';
import type { GpuSpriteLayer, InkLayer } from './layers';
import { GpuMergerStars, type MergerProgress } from './merger-stars';
import { GpuShells } from './shells';
import { GpuStipple } from './stipple';
import { buildShellScene } from '../model/shells';
import { GpuTideMap } from './tide';
import { GpuVectors } from './vectors';

const STORAGE = GPUBufferUsage.STORAGE;
const SRC = GPUBufferUsage.COPY_SRC;

/** The debris's compaction buffers (the stipple's scan, over the stars' marks). */
interface Debris {
  n: number;
  cap: number;
  blocks: number;
  view: GPUBuffer;
  projected: GPUBuffer;
  classes: GPUBuffer;
  rank: GPUBuffer;
  totals: GPUBuffer;
  offsets: GPUBuffer;
  args: GPUBuffer;
  out: GPUBuffer;
  scan: GPUBuffer;
  sprites: GPUBindGroup;
  local: GPUBindGroup;
  blocksGroup: GPUBindGroup;
  scatter: GPUBindGroup;
}

export class GpuMerger {
  readonly stars: GpuMergerStars;
  readonly tideMap: GpuTideMap;
  readonly galaxies: [GpuStipple, GpuStipple];
  private readonly mwarp: GpuVectors;
  /** the simulated shells, when `shellsOn` (applied to the merged scene, app23.js:L1266) */
  readonly shells: GpuShells;
  private shellsOn = false;
  private readonly pipes: {
    sprites: GPUComputePipeline;
    local: GPUComputePipeline;
    blocks: GPUComputePipeline;
    scatter: GPUComputePipeline;
  };
  scene: MergerScene | null = null;
  /** `frameOf` at the chosen moment and at the horizon's end (the model tier's read-back) */
  frames: { chosen: MergerFrame; end: MergerFrame } | null = null;
  framing: MergerFraming | null = null;
  private debris: Debris | null = null;
  private poolBuffers: { pool: GPUBuffer; dotBase: GPUBuffer; noise: GPUBuffer } | null = null;
  private mwarpOn = false;
  /** the lens's host (M9): a merging pair can lens a galaxy behind it */
  private lensHost: GpuStipple | null = null;

  private constructor(readonly device: GPUDevice) {
    this.stars = GpuMergerStars.create(device);
    this.tideMap = GpuTideMap.create(device);
    this.galaxies = [GpuStipple.create(device), GpuStipple.create(device)];
    this.mwarp = GpuVectors.create(device);
    this.shells = GpuShells.create(device);
    const mod = (code: string, label: string) => device.createShaderModule({ label, code });
    const sprites = mod(mergerSpritesWgsl, 'merger-sprites.wgsl');
    const scan = mod(scanWgsl, 'scan.wgsl');
    const pipe = (m: GPUShaderModule, entryPoint: string, label: string) =>
      device.createComputePipeline({
        label: `${label} ${entryPoint}`,
        layout: 'auto',
        compute: { module: m, entryPoint },
      });
    this.pipes = {
      sprites: pipe(sprites, 'sprites', 'merger-sprites.wgsl'),
      local: pipe(scan, 'scan_local', 'scan.wgsl'),
      blocks: pipe(scan, 'scan_blocks', 'scan.wgsl'),
      scatter: pipe(scan, 'scatter', 'scan.wgsl'),
    };
  }

  static create(device: GPUDevice): GpuMerger {
    return new GpuMerger(device);
  }

  /**
   * The model tier. `onProgress` reports each chunk of the integration; `yieldTo` is awaited
   * between chunks (the page passes a frame wait).
   */
  async build(
    P: Params,
    meta: DrawingsMeta,
    opts: MergerSceneOptions = {},
    onProgress?: (p: MergerProgress) => void,
    yieldTo?: () => Promise<void>,
  ): Promise<void> {
    const d = this.device;
    this.destroyModel();
    const scene = buildMergerScene(P, meta, opts);
    this.scene = scene;
    const D = scene.desc;
    this.stars.load(D);
    await this.stars.run(onProgress, yieldTo);
    // the framing: the distances of every fifth star from the cores' midpoint, at the chosen moment
    // and at the horizon's end (app23.js:L466–471). The model tier's one read-back.
    const track = D.track;
    this.stars.blend({
      phase: 'timeline',
      exact: true,
      i0: track.chosen.nSnaps - 1,
      i1: track.chosen.nSnaps - 1,
      a: 0,
      n: track.chosen.nSnaps,
    });
    const rc = await this.stars.readRadii(wholeFrame(track.C, track.M).c);
    this.stars.blend({
      phase: 'future',
      exact: false,
      i0: track.future.nSnaps - 1,
      i1: track.future.nSnaps - 1,
      a: 0,
      n: track.future.nSnaps,
    });
    const re = await this.stars.readRadii(wholeFrame(track.Cend, track.M).c);
    this.frames = framesFromRadii(scene, rc, re);

    // the tidal map and the galaxies carried by it
    const tide = this.tideMap.load(D.total, D.n[0], this.stars.initial);
    this.galaxies.forEach((s, g) => {
      s.setTide(tide, g as 0 | 1);
      s.setScene(scene.galaxies[g] as MergerScene['galaxies'][number]);
    });

    // the debris's marks, one list of 12 slots a star, compacted as the stipple's
    const n = D.total * MERGER_SLOTS;
    const cap = classCapacity(D.total);
    const blocks = blockCount(n);
    const buf = (size: number, usage: number, label: string) =>
      d.createBuffer({ label, size: Math.max(16, size), usage });
    this.poolBuffers = {
      pool: bufferWithData(d, scene.pool, STORAGE, 'merger pool'),
      dotBase: bufferWithData(d, scene.dotBase, STORAGE, 'merger dot sizes'),
      noise: bufferWithData(d, new Uint32Array(16 * 8), STORAGE, 'merger noise (none)'),
    };
    const view = buf(
      MVIEW_LAYOUT.size,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      'merger view',
    );
    const projected = buf(n * INSTANCE_LAYOUT.size, STORAGE | SRC, 'merger marks');
    const classes = buf(n * 4, STORAGE | SRC, 'merger mark classes');
    const rank = buf(n * 4, STORAGE, 'merger rank');
    const totals = buf(blocks * 8, STORAGE, 'merger block totals');
    const offsets = buf(blocks * BLOCK_STRIDE * 4, STORAGE, 'merger block offsets');
    const args = buf(CLASS_COUNT * 16, STORAGE | GPUBufferUsage.INDIRECT | SRC, 'merger draw args');
    const out = buf(CLASS_COUNT * cap * INSTANCE_LAYOUT.size, STORAGE | SRC, 'merger debris');
    const scan = bufferWithData(
      d,
      new Uint32Array([n, cap, blocks, 0]),
      GPUBufferUsage.UNIFORM,
      'merger scan',
    );
    const group = (p: GPUComputePipeline, entries: [number, GPUBuffer][]) =>
      d.createBindGroup({
        layout: p.getBindGroupLayout(0),
        entries: entries.map(([binding, buffer]) => ({ binding, resource: { buffer } })),
      });
    this.debris = {
      n,
      cap,
      blocks,
      view,
      projected,
      classes,
      rank,
      totals,
      offsets,
      args,
      out,
      scan,
      sprites: group(this.pipes.sprites, [
        [0, view],
        [1, this.stars.current],
        [2, this.stars.initial],
        [3, this.poolBuffers.pool],
        [4, this.poolBuffers.dotBase],
        [6, projected],
        [7, classes],
        [31, tide],
      ]),
      local: group(this.pipes.local, [
        [0, scan],
        [1, classes],
        [2, rank],
        [3, totals],
      ]),
      blocksGroup: group(this.pipes.blocks, [
        [0, scan],
        [3, totals],
        [4, offsets],
        [5, args],
      ]),
      scatter: group(this.pipes.scatter, [
        [0, scan],
        [1, classes],
        [2, rank],
        [4, offsets],
        [6, projected],
        [7, out],
      ]),
    };

    // the shells of `shellsOn`, over the merged scene
    this.shellsOn = !!P.shellsOn;
    if (this.shellsOn)
      await this.shells.build(
        buildShellScene(P, meta, scene.variation, {
          ...opts.shells,
          ...(opts.placementKey !== undefined ? { placementKey: opts.placementKey } : {}),
        }),
      );

    // the lens of `lensOn`: a merging pair can lens a galaxy behind it (M9)
    if (scene.lensHost) {
      this.lensHost ??= GpuStipple.create(d);
      this.lensHost.setScene(scene.lensHost);
    } else {
      this.lensHost?.destroy();
      this.lensHost = null;
    }

    // mWarp's drawings: the main picture's hand, torn through the tidal map itself
    const MW = mwarpDesc(scene);
    this.mwarpOn = !!MW;
    if (MW) {
      this.mwarp.load(
        MW,
        this.poolBuffers.pool,
        this.poolBuffers.dotBase,
        this.poolBuffers.noise,
        tide,
      );
    }
  }

  /** The view tier at a zoom (the camera and `mTime` are in the scene's parameters). */
  view(zoom: number, mTime?: number): void {
    const scene = this.scene;
    const db = this.debris;
    if (!scene || !db || !this.frames) throw new Error('build the merger first');
    if (mTime !== undefined) scene.P.mTime = mTime;
    const d = this.device;
    const fr = mergerFraming(scene, zoom, this.frames);
    this.framing = fr;
    this.stars.blend(fr.sel);
    d.queue.writeBuffer(db.view, 0, packMergerView(mergerViewUniform(scene, fr, zoom)));
    const enc = d.createCommandEncoder({ label: 'merger view' });
    const pass = enc.beginComputePass({ label: 'merger marks and tides' });
    pass.setPipeline(this.pipes.sprites);
    pass.setBindGroup(0, db.sprites);
    pass.dispatchWorkgroups(Math.ceil(scene.desc.total / 64));
    this.tideMap.encodeGrid(pass);
    pass.setPipeline(this.pipes.local);
    pass.setBindGroup(0, db.local);
    pass.dispatchWorkgroups(db.blocks);
    pass.setPipeline(this.pipes.blocks);
    pass.setBindGroup(0, db.blocksGroup);
    pass.dispatchWorkgroups(1);
    pass.setPipeline(this.pipes.scatter);
    pass.setBindGroup(0, db.scatter);
    pass.dispatchWorkgroups(Math.ceil(db.n / 64));
    pass.end();
    d.queue.submit([enc.finish()]);
    // each galaxy: its R2 and its camera (s0 = MS.sc · rmax / 4.2), then its own view tier
    this.galaxies.forEach((s, g) => {
      const G = fr.galaxies[g];
      if (!G) return;
      s.setTideR2(G.r2);
      s.setView(G.camera);
    });
    if (this.shellsOn) this.shells.view(zoom);
    this.lensHost?.setView(cameraOf(scene.P, zoom), scene.P.mTime);
    if (this.mwarpOn) {
      const MW = mwarpDesc(scene);
      if (MW) {
        this.mwarp.setView(mwarpView(scene, MW, fr));
        const e = d.createCommandEncoder({ label: 'mWarp' });
        const p = e.beginComputePass({ label: 'mWarp' });
        this.mwarp.encode(p);
        p.end();
        d.queue.submit([e.finish()]);
      }
    }
  }

  /** The debris's layers (disc, young, knots, sparkle stars), in the stipple's order. */
  private debrisLayers(): GpuSpriteLayer[] {
    const db = this.debris;
    if (!db) return [];
    const bytes = db.cap * INSTANCE_LAYOUT.size;
    return STIPPLE_LAYERS.filter((l) => l.cls !== 0).map((l) => ({
      kind: 'gpu-sprites',
      atlas: l.atlas,
      gain: 1,
      source: {
        buffer: db.out,
        offset: l.cls * bytes,
        size: bytes,
        indirect: db.args,
        indirectOffset: l.cls * 16,
      },
    }));
  }

  /** Every ink layer: both galaxies' (the single-galaxy layers, carried by the tides), the debris, mWarp. */
  inkLayers(): InkLayer[] {
    return [
      ...this.galaxies.flatMap((s) => s.inkLayers()),
      ...this.mwarp.layers(),
      ...this.debrisLayers(),
      ...(this.shellsOn ? this.shells.layers() : []),
      ...(this.lensHost?.lensLayers() ?? []),
    ];
  }

  /** Statistics: the mark counts, galaxies and debris together (a read-back, off the frame path). */
  async readCounts(): Promise<{ counts: MarkCounts; perClass: Uint32Array }> {
    const db = this.debris;
    if (!db) throw new Error('build the merger first');
    const a = new Uint32Array(await readBuffer(this.device, db.args, CLASS_COUNT * 16));
    const perClass = new Uint32Array(CLASS_COUNT);
    for (let c = 0; c < CLASS_COUNT; c++) perClass[c] = a[c * 4 + 1] ?? 0;
    const parts = await Promise.all(this.galaxies.map((s) => s.readCounts()));
    for (const p of parts)
      for (let c = 0; c < CLASS_COUNT; c++) perClass[c] = (perClass[c] ?? 0) + (p.perClass[c] ?? 0);
    const lens = await (this.lensHost?.lensCounts() ?? Promise.resolve([] as number[]));
    for (let c = 0; c < CLASS_COUNT; c++) perClass[c] = (perClass[c] ?? 0) + (lens[c] ?? 0);
    // the shells' stars are `old` dots
    if (this.shellsOn) perClass[Cls.old] = (perClass[Cls.old] ?? 0) + this.shells.count;
    const counts: MarkCounts = { ...markCounts(perClass) };
    const sum = (k: keyof MarkCounts) => parts.reduce((acc, p) => acc + (p.counts[k] ?? 0), 0);
    for (const k of [
      'curves',
      'pieces',
      'ribbonSegments',
      'hatches',
      'drawings',
      'vectorCaps',
      'vectorDots',
      'vectorBlobs',
      'streamDots',
      'streamKnots',
    ] as const)
      counts[k] = sum(k);
    return { counts, perClass };
  }

  private destroyModel(): void {
    const db = this.debris;
    if (db)
      for (const b of [
        db.view,
        db.projected,
        db.classes,
        db.rank,
        db.totals,
        db.offsets,
        db.args,
        db.out,
        db.scan,
      ])
        b.destroy();
    this.debris = null;
    if (this.poolBuffers) for (const b of Object.values(this.poolBuffers)) b.destroy();
    this.poolBuffers = null;
  }

  destroy(): void {
    this.destroyModel();
    this.stars.destroy();
    this.tideMap.destroy();
    this.galaxies.forEach((s) => {
      s.destroy();
    });
    this.mwarp.destroy();
    this.shells.destroy();
    this.lensHost?.destroy();
  }
}
