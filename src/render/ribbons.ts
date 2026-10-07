/**
 * The line-work on the GPU (ADR 0003, 0010): the model tier's curve, lane and hatch buffers
 * (src/model/ribbons.ts) and the view tier's passes of compute/ribbons.wgsl: `project_points`
 * (before the stipple's projection, whose dust culls read the projected lane and carving points),
 * then `measure`, `expand`, `place_pieces` and the hatching. The ink layers draw the results with
 * no read-back: textured ribbons and capsules with direct draws of a count known in the model tier,
 * pieces with the indirect count `measure` writes.
 *
 * Owned by src/render/stipple.ts (GpuStipple), which records these passes in its own compute pass.
 * CPU twin: src/fallback/kernels/ribbons.ts.
 */
import ribbonsWgsl from '../shaders/compute/ribbons.wgsl';
import { bufferWithData, packStruct } from '../gpu/buffers';
import { INSTANCE_LAYOUT } from '../marks/instance';
import {
  CAPSULE_LAYOUT,
  CURVE_STATE_LAYOUT,
  RIBBON_SEG_LAYOUT,
  RIB_LAYOUT,
  ribUniform,
  type RibbonDesc,
} from '../model/ribbons';
import type { Params } from '../core/params';
import type { Camera } from '../view/camera';
import type { InkLayer } from './layers';
import type { GpuTide } from './tide';

const STORAGE = GPUBufferUsage.STORAGE;
const ENTRIES = [
  'project_points',
  'measure',
  'expand',
  'place_pieces',
  'hatch_caps',
  'hatch_dots',
  'hatch_blobs',
] as const;
type Entry = (typeof ENTRIES)[number];

/** Which bindings of ribbons.wgsl each entry point uses (its auto layout). */
const USES: Record<Entry, number[]> = {
  project_points: [0, 1, 2, 3],
  measure: [1, 3, 4, 5, 6, 10],
  expand: [1, 3, 4, 5, 6, 8, 30],
  place_pieces: [1, 3, 4, 5, 6, 7, 9, 10, 30],
  hatch_caps: [1, 3, 11, 12, 13, 16, 30],
  hatch_dots: [1, 3, 11, 12, 14, 17, 19, 20, 30],
  hatch_blobs: [1, 3, 11, 12, 15, 18, 19, 30],
};

interface Model {
  R: RibbonDesc;
  buffers: Record<number, GPUBuffer>;
  /** static indirect arguments of the hatching's dots and blobs */
  hdotArgs: GPUBuffer;
  hblobArgs: GPUBuffer;
  carve: GPUBuffer;
  groups: Record<Entry, GPUBindGroup>;
  own: GPUBuffer[];
}

export class GpuRibbons {
  private model: Model | null = null;

  private constructor(
    readonly device: GPUDevice,
    private readonly pipes: Record<Entry, GPUComputePipeline>,
  ) {}

  static create(device: GPUDevice): GpuRibbons {
    const module = device.createShaderModule({ label: 'ribbons.wgsl', code: ribbonsWgsl });
    const pipes = Object.fromEntries(
      ENTRIES.map((e) => [
        e,
        device.createComputePipeline({
          label: `ribbons.wgsl ${e}`,
          layout: 'auto',
          compute: { module, entryPoint: e },
        }),
      ]),
    ) as Record<Entry, GPUComputePipeline>;
    return new GpuRibbons(device, pipes);
  }

  get desc(): RibbonDesc | null {
    return this.model?.R ?? null;
  }

  /** The projected scene points (the stipple's dust culls read them). */
  get points(): GPUBuffer {
    return this.need().buffers[3] as GPUBuffer;
  }

  /** The curve table (the lensed branches are written into it by compute/lens-query.wgsl). */
  get curveTable(): GPUBuffer {
    return this.need().buffers[4] as GPUBuffer;
  }

  /** The carving segments' first points. */
  get carve(): GPUBuffer {
    return this.need().carve;
  }

  /**
   * Model tier: the line-work's buffers, reading the shared view uniform, the galaxy's pools and
   * the scene's noise field (the wobble's).
   */
  load(
    R: RibbonDesc,
    view: GPUBuffer,
    pool: GPUBuffer,
    dotBase: GPUBuffer,
    noise: GPUBuffer,
  ): void {
    this.destroy();
    const d = this.device;
    const buf = (bytes: number, usage: number, label: string) =>
      d.createBuffer({ label, size: Math.max(16, bytes), usage });
    const data = (x: ArrayBuffer | ArrayBufferView<ArrayBuffer>, label: string, usage = STORAGE) =>
      bufferWithData(d, x, usage, label);
    const src = STORAGE | GPUBufferUsage.COPY_SRC;
    const own: GPUBuffer[] = [];
    const keep = (b: GPUBuffer) => {
      own.push(b);
      return b;
    };
    const buffers: Record<number, GPUBuffer> = {
      0: view,
      1: keep(buf(RIB_LAYOUT.size, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'rib')),
      2: keep(data(R.points3, 'scene points')),
      3: keep(buf(R.nPoints * 8, src, 'projected points')),
      4: keep(data(R.curveBuf, 'curves', STORAGE | GPUBufferUsage.COPY_SRC)),
      5: keep(buf(R.nPoints * 4, src, 'arc lengths')),
      6: keep(buf(Math.max(1, R.nCurves) * CURVE_STATE_LAYOUT.size, src, 'curve state')),
      7: keep(data(R.pieces, 'stroke pieces')),
      8: keep(buf(Math.max(1, R.nSegs) * RIBBON_SEG_LAYOUT.size, src, 'ribbon segments')),
      9: keep(buf(Math.max(1, R.pieceCap) * INSTANCE_LAYOUT.size, src, 'pieces')),
      10: keep(
        data(
          new Uint32Array([4, 0, 0, 0]),
          'pieces draw args',
          STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_SRC,
        ),
      ),
      11: keep(data(R.hatchBuf, 'hatches')),
      12: keep(data(R.pen.table, 'pen table')),
      13: keep(data(R.pen.segs, 'pen segments')),
      14: keep(data(R.pen.dots, 'pen dots')),
      15: keep(data(R.pen.blobs, 'pen blobs')),
      16: keep(buf(Math.max(1, R.nCaps) * CAPSULE_LAYOUT.size, src, 'hatch capsules')),
      17: keep(buf(Math.max(1, R.nHDots) * INSTANCE_LAYOUT.size, src, 'hatch dots')),
      18: keep(buf(Math.max(1, R.nHBlobs) * INSTANCE_LAYOUT.size, src, 'hatch blobs')),
      19: pool,
      20: dotBase,
      30: noise,
    };
    const hdotArgs = keep(
      data(new Uint32Array([4, R.nHDots, 0, 0]), 'hatch dots args', GPUBufferUsage.INDIRECT),
    );
    const hblobArgs = keep(
      data(new Uint32Array([4, R.nHBlobs, 0, 0]), 'hatch blobs args', GPUBufferUsage.INDIRECT),
    );
    const carve = keep(data(R.carve, 'carving segments'));
    const groups = Object.fromEntries(
      ENTRIES.map((e) => [
        e,
        d.createBindGroup({
          label: `ribbons ${e}`,
          layout: this.pipes[e].getBindGroupLayout(0),
          entries: USES[e].map((binding) => ({
            binding,
            resource: { buffer: buffers[binding] as GPUBuffer },
          })),
        }),
      ]),
    ) as Record<Entry, GPUBindGroup>;
    this.model = { R, buffers, hdotArgs, hblobArgs, carve, groups, own };
  }

  /** View tier: this view's numbers (zoom, wobble, the edge-on stroke's alpha). */
  setView(cam: Camera, P: Params, nDotPool: number): void {
    const m = this.need();
    this.device.queue.writeBuffer(
      m.buffers[1] as GPUBuffer,
      0,
      packStruct(RIB_LAYOUT, ribUniform(m.R, cam, P, nDotPool)),
    );
  }

  /** Records `project_points` (before the stipple's projection). */
  encodeProject(pass: GPUComputePassEncoder): void {
    const m = this.need();
    this.dispatch(pass, 'project_points', m.R.nPoints);
  }

  /** Records the rest: measure, expand, pieces, hatching. */
  encodeExpand(pass: GPUComputePassEncoder): void {
    const m = this.need();
    const R = m.R;
    if (R.nCurves) {
      pass.setPipeline(this.pipes.measure);
      pass.setBindGroup(0, m.groups.measure);
      pass.dispatchWorkgroups(1);
    }
    this.dispatch(pass, 'expand', R.nSegs);
    this.dispatch(pass, 'place_pieces', R.pieceCap);
    this.dispatch(pass, 'hatch_caps', R.nCaps);
    this.dispatch(pass, 'hatch_dots', R.nHDots);
    this.dispatch(pass, 'hatch_blobs', R.nHBlobs);
  }

  /**
   * A merging galaxy's tides (M8), applied in place to what `encodeExpand` made: the ribbon
   * segments (torn where stretched), the pieces, and the hatching's capsules, dots and blobs.
   */
  encodeTide(
    pass: GPUComputePassEncoder,
    apply: GpuTide,
    tide: GPUBuffer,
    g: number,
    r2: number,
  ): void {
    const m = this.need();
    const R = m.R;
    const b = m.buffers;
    const job = { g, r2 };
    apply.encode(pass, tide, {
      ...job,
      key: 'segs',
      entry: 'warp_ribbons',
      buffer: b[8] as GPUBuffer,
      n: R.nSegs,
    });
    apply.encode(pass, tide, {
      ...job,
      key: 'pieces',
      entry: 'warp_instances',
      buffer: b[9] as GPUBuffer,
      n: R.pieceCap,
      args: b[10] as GPUBuffer,
      argsIndex: 0,
    });
    apply.encode(pass, tide, {
      ...job,
      key: 'caps',
      entry: 'warp_caps',
      buffer: b[16] as GPUBuffer,
      n: R.nCaps,
    });
    apply.encode(pass, tide, {
      ...job,
      key: 'hdots',
      entry: 'warp_instances',
      buffer: b[17] as GPUBuffer,
      n: R.nHDots,
    });
    apply.encode(pass, tide, {
      ...job,
      key: 'hblobs',
      entry: 'warp_instances',
      buffer: b[18] as GPUBuffer,
      n: R.nHBlobs,
    });
  }

  private dispatch(pass: GPUComputePassEncoder, e: Entry, n: number): void {
    if (!n) return;
    const m = this.need();
    pass.setPipeline(this.pipes[e]);
    pass.setBindGroup(0, m.groups[e]);
    pass.dispatchWorkgroups(Math.ceil(n / 64));
  }

  /**
   * The line-work's layers, in the reference's order (scene(), app23.js:L1289–1301): stroke ribbons,
   * the hatching's lines, dots and blobs (line ink), then the pieces (young ink).
   */
  layers(): InkLayer[] {
    const m = this.model;
    if (!m) return [];
    const R = m.R;
    const b = m.buffers;
    const out: InkLayer[] = [];
    if (R.nSegs)
      out.push({
        kind: 'gpu-ribbons',
        atlas: 'strokes',
        buffer: b[8] as GPUBuffer,
        count: R.nSegs,
        gain: 1,
      });
    if (R.nCaps)
      out.push({ kind: 'gpu-capsules', buffer: b[16] as GPUBuffer, count: R.nCaps, gain: 1 });
    const sprites = (
      atlas: 'dots' | 'knots' | 'pieces',
      buffer: GPUBuffer,
      count: number,
      indirect: GPUBuffer,
    ): InkLayer => ({
      kind: 'gpu-sprites',
      atlas,
      gain: 1,
      ...(atlas === 'pieces' ? { pop: 'young' as const } : {}),
      source: {
        buffer,
        offset: 0,
        size: Math.max(16, count * INSTANCE_LAYOUT.size),
        indirect,
        indirectOffset: 0,
      },
    });
    if (R.nHDots) out.push(sprites('dots', b[17] as GPUBuffer, R.nHDots, m.hdotArgs));
    if (R.nHBlobs) out.push(sprites('knots', b[18] as GPUBuffer, R.nHBlobs, m.hblobArgs));
    if (R.pieceCap) out.push(sprites('pieces', b[9] as GPUBuffer, R.pieceCap, b[10] as GPUBuffer));
    return out;
  }

  /** Tests only: copies the view tier's outputs back. */
  async readBack(): Promise<{
    points: Float32Array;
    arc: Float32Array;
    state: ArrayBuffer;
    segs: ArrayBuffer;
    nPieces: number;
    pieces: ArrayBuffer;
    caps: Float32Array;
    hdots: ArrayBuffer;
    hblobs: ArrayBuffer;
  }> {
    const m = this.need();
    const R = m.R;
    const b = m.buffers;
    const read = async (src: GPUBuffer, size: number): Promise<ArrayBuffer> => {
      const d = this.device;
      const bytes = Math.max(16, size);
      const dst = d.createBuffer({
        size: bytes,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const enc = d.createCommandEncoder();
      enc.copyBufferToBuffer(src, 0, dst, 0, bytes);
      d.queue.submit([enc.finish()]);
      await dst.mapAsync(GPUMapMode.READ);
      const copy = dst.getMappedRange().slice(0);
      dst.unmap();
      dst.destroy();
      return copy;
    };
    const args = new Uint32Array(await read(b[10] as GPUBuffer, 16));
    const nPieces = args[1] ?? 0;
    return {
      points: new Float32Array(await read(b[3] as GPUBuffer, R.nPoints * 8)),
      arc: new Float32Array(await read(b[5] as GPUBuffer, R.nPoints * 4)),
      state: await read(b[6] as GPUBuffer, R.nCurves * CURVE_STATE_LAYOUT.size),
      segs: await read(b[8] as GPUBuffer, R.nSegs * RIBBON_SEG_LAYOUT.size),
      nPieces,
      pieces: await read(b[9] as GPUBuffer, nPieces * INSTANCE_LAYOUT.size),
      caps: new Float32Array(await read(b[16] as GPUBuffer, R.nCaps * CAPSULE_LAYOUT.size)),
      hdots: await read(b[17] as GPUBuffer, R.nHDots * INSTANCE_LAYOUT.size),
      hblobs: await read(b[18] as GPUBuffer, R.nHBlobs * INSTANCE_LAYOUT.size),
    };
  }

  /** The pieces' indirect count (statistics; a read-back, off the frame path). */
  async readPieceCount(): Promise<number> {
    const m = this.model;
    if (!m) return 0;
    const d = this.device;
    const dst = d.createBuffer({
      size: 16,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const enc = d.createCommandEncoder();
    enc.copyBufferToBuffer(m.buffers[10] as GPUBuffer, 0, dst, 0, 16);
    d.queue.submit([enc.finish()]);
    await dst.mapAsync(GPUMapMode.READ);
    const n = new Uint32Array(dst.getMappedRange())[1] ?? 0;
    dst.unmap();
    dst.destroy();
    return n;
  }

  private need(): Model {
    if (!this.model) throw new Error('load the line-work first');
    return this.model;
  }

  destroy(): void {
    this.model?.own.forEach((b) => {
      b.destroy();
    });
    this.model = null;
  }
}
