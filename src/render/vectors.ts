/**
 * The placed vector drawings on the GPU (ADR 0003, 0006, 0010): the library's tables (uploaded
 * once per set of drawings), the model tier's slot layout (src/model/vectors.ts), and the view
 * tier's passes of compute/vector-expand.wgsl: `expand_caps`, `expand_dots`, `expand_blobs`,
 * `stream_marks`, then the two compactions (capsules; the streams' dots and knots), each
 * `scan_local`, `scan_blocks` and a scatter. The ink layers draw the results with no read-back:
 * capsules and stream marks indirectly, with the counts the compactions write, dots and blobs with
 * counts known in the model tier.
 *
 * Owned by src/render/stipple.ts (GpuStipple), which records these passes in its view pass.
 * CPU twin: src/fallback/kernels/vector.ts.
 */
import vectorWgsl from '../shaders/compute/vector-expand.wgsl';
import { bufferWithData, packStruct } from '../gpu/buffers';
import { INSTANCE_LAYOUT } from '../marks/instance';
import type { PackedVectors } from '../marks/vector';
import { CAPSULE_LAYOUT } from '../model/ribbons';
import {
  JOB_LAYOUT,
  JobMode,
  STREAM_SEG_LAYOUT,
  VEC_LAYOUT,
  VINST_LAYOUT,
  streamSegments,
  type VectorDesc,
  type VectorView,
} from '../model/vectors';
import { ZOOM_MAX } from '../view/camera';
import type { InkLayer } from './layers';

const STORAGE = GPUBufferUsage.STORAGE;
const SCAN_BLOCK = 256;

const ENTRIES = [
  'expand_caps',
  'expand_dots',
  'expand_blobs',
  'stream_marks',
  'scan_local',
  'scan_blocks',
  'scatter_caps',
  'scatter_marks',
] as const;
type Entry = (typeof ENTRIES)[number];

/** Which bindings of vector-expand.wgsl each entry point uses (its auto layout). */
const USES: Record<Entry, number[]> = {
  expand_caps: [0, 1, 2, 3, 4, 9, 10, 30],
  expand_dots: [0, 1, 2, 5, 7, 8, 11, 30],
  expand_blobs: [0, 1, 2, 6, 7, 12, 30],
  stream_marks: [0, 7, 8, 10, 13, 14, 30],
  scan_local: [10, 15, 16, 17],
  scan_blocks: [15, 17, 18, 19],
  scatter_caps: [9, 10, 15, 16, 18, 20],
  scatter_marks: [10, 14, 15, 16, 18, 21],
};

/** Per-class capacity rounded to 8 instances (256-byte aligned slices, as the stipple's). */
const capacity = (n: number) => Math.max(8, Math.ceil(n / 8) * 8);
const blocksOf = (n: number) => Math.max(1, Math.ceil(n / SCAN_BLOCK));

/** One compaction's buffers. */
interface Job {
  uniform: GPUBuffer;
  keys: GPUBuffer;
  rank: GPUBuffer;
  totals: GPUBuffer;
  offsets: GPUBuffer;
  args: GPUBuffer;
  cap: number;
}

interface Model {
  D: VectorDesc;
  lib: PackedVectors;
  buffers: Record<number, GPUBuffer>;
  caps: Job;
  marks: Job;
  /** stream slots the buffers hold (at the largest zoom) */
  markCap: number;
  dotArgs: GPUBuffer;
  blobArgs: GPUBuffer;
  groups: Record<Entry, GPUBindGroup>;
  /** the scan groups of the marks' job (the caps' are in `groups`) */
  markGroups: Record<'scan_local' | 'scan_blocks', GPUBindGroup>;
  own: GPUBuffer[];
  /** this view's stream slots and segments */
  nSlots: number;
  nSegs: number;
}

export class GpuVectors {
  private model: Model | null = null;
  private libBuffers: { lib: PackedVectors; bufs: GPUBuffer[] } | null = null;

  private constructor(
    readonly device: GPUDevice,
    private readonly pipes: Record<Entry, GPUComputePipeline>,
  ) {}

  static create(device: GPUDevice): GpuVectors {
    const module = device.createShaderModule({ label: 'vector-expand.wgsl', code: vectorWgsl });
    const pipes = Object.fromEntries(
      ENTRIES.map((e) => [
        e,
        device.createComputePipeline({
          label: `vector-expand.wgsl ${e}`,
          layout: 'auto',
          compute: { module, entryPoint: e },
        }),
      ]),
    ) as Record<Entry, GPUComputePipeline>;
    return new GpuVectors(device, pipes);
  }

  get desc(): VectorDesc | null {
    return this.model?.D ?? null;
  }

  /** The instance table (the lensed drawings' images are written into it by compute/lens-query.wgsl). */
  get instances(): GPUBuffer {
    return this.need().buffers[1] as GPUBuffer;
  }

  /** The library's tables, uploaded once per set of drawings. */
  private library(lib: PackedVectors): GPUBuffer[] {
    if (this.libBuffers?.lib === lib) return this.libBuffers.bufs;
    this.libBuffers?.bufs.forEach((b) => {
      b.destroy();
    });
    const d = this.device;
    const bufs = [
      bufferWithData(d, lib.table, STORAGE, 'vector table'),
      bufferWithData(d, lib.segs, STORAGE, 'vector segments'),
      bufferWithData(d, lib.dens, STORAGE, 'vector densified prefix'),
      bufferWithData(d, lib.dots, STORAGE, 'vector dots'),
      bufferWithData(d, lib.blobs, STORAGE, 'vector blobs'),
    ];
    this.libBuffers = { lib, bufs };
    return bufs;
  }

  /** Model tier: buffers for these placed drawings, reading the galaxy's pools and noise field. */
  load(D: VectorDesc, pool: GPUBuffer, dotBase: GPUBuffer, noise: GPUBuffer): void {
    this.unload();
    const d = this.device;
    const own: GPUBuffer[] = [];
    const keep = (b: GPUBuffer) => {
      own.push(b);
      return b;
    };
    const buf = (bytes: number, usage: number, label: string) =>
      keep(d.createBuffer({ label, size: Math.max(256, bytes), usage }));
    const src = STORAGE | GPUBufferUsage.COPY_SRC;
    const [table, segs, dens, dots, blobs] = this.library(D.lib) as [
      GPUBuffer,
      GPUBuffer,
      GPUBuffer,
      GPUBuffer,
      GPUBuffer,
    ];
    const markCap = capacity(streamSegments(D.parts, ZOOM_MAX).nSlots);
    const capCap = capacity(D.nCapSlots);
    const job = (n: number, cap: number, label: string): Job => ({
      uniform: buf(
        JOB_LAYOUT.size,
        GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        `${label} job`,
      ),
      keys: buf(n * 4, src, `${label} keys`),
      rank: buf(n * 4, STORAGE, `${label} rank`),
      totals: buf(blocksOf(n) * 4, STORAGE, `${label} block totals`),
      offsets: buf(blocksOf(n) * 8, STORAGE, `${label} block offsets`),
      args: buf(32, STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_SRC, `${label} args`),
      cap,
    });
    const caps = job(capCap, capCap, 'vector capsules');
    const marks = job(markCap, markCap, 'stream marks');
    const buffers: Record<number, GPUBuffer> = {
      0: buf(VEC_LAYOUT.size, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'vec'),
      1: buf(
        Math.max(1, D.nInst) * VINST_LAYOUT.size,
        STORAGE | GPUBufferUsage.COPY_DST,
        'vector instances',
      ),
      2: table,
      3: segs,
      4: dens,
      5: dots,
      6: blobs,
      7: pool,
      8: dotBase,
      9: buf(capCap * CAPSULE_LAYOUT.size, src, 'vector capsules (slots)'),
      11: buf(D.nDots * INSTANCE_LAYOUT.size, src, 'vector dots'),
      12: buf(D.nBlobs * INSTANCE_LAYOUT.size, src, 'vector blobs'),
      13: buf(
        markCap * STREAM_SEG_LAYOUT.size,
        STORAGE | GPUBufferUsage.COPY_DST,
        'stream segments',
      ),
      14: buf(markCap * INSTANCE_LAYOUT.size, src, 'stream marks (slots)'),
      20: buf(capCap * CAPSULE_LAYOUT.size, src, 'vector capsules'),
      21: buf(2 * markCap * INSTANCE_LAYOUT.size, src, 'stream dots and knots'),
      30: noise,
    };
    const dotArgs = keep(
      bufferWithData(d, new Uint32Array([4, D.nDots, 0, 0]), GPUBufferUsage.INDIRECT, 'dots args'),
    );
    const blobArgs = keep(
      bufferWithData(d, new Uint32Array([4, D.nBlobs, 0, 0]), GPUBufferUsage.INDIRECT, 'blob args'),
    );
    const withJob = (J: Job): Record<number, GPUBuffer> => ({
      ...buffers,
      10: J.keys,
      15: J.uniform,
      16: J.rank,
      17: J.totals,
      18: J.offsets,
      19: J.args,
    });
    const group = (e: Entry, b: Record<number, GPUBuffer>) =>
      d.createBindGroup({
        label: `vector-expand ${e}`,
        layout: this.pipes[e].getBindGroupLayout(0),
        entries: USES[e].map((binding) => ({
          binding,
          resource: { buffer: b[binding] as GPUBuffer },
        })),
      });
    const cb = withJob(caps);
    const mb = withJob(marks);
    const groups = {
      expand_caps: group('expand_caps', cb),
      expand_dots: group('expand_dots', cb),
      expand_blobs: group('expand_blobs', cb),
      stream_marks: group('stream_marks', mb),
      scan_local: group('scan_local', cb),
      scan_blocks: group('scan_blocks', cb),
      scatter_caps: group('scatter_caps', cb),
      scatter_marks: group('scatter_marks', mb),
    };
    const markGroups = {
      scan_local: group('scan_local', mb),
      scan_blocks: group('scan_blocks', mb),
    };
    d.queue.writeBuffer(
      caps.uniform,
      0,
      packStruct(JOB_LAYOUT, {
        n: D.nCapSlots,
        blocks: blocksOf(D.nCapSlots),
        cap: capCap,
        mode: JobMode.caps,
      }),
    );
    this.model = {
      D,
      lib: D.lib,
      buffers,
      caps,
      marks,
      markCap,
      dotArgs,
      blobArgs,
      groups,
      markGroups,
      own,
      nSlots: 0,
      nSegs: 0,
    };
  }

  /** View tier: this view's instance table, stream segments and uniform. */
  setView(V: VectorView): void {
    const m = this.need();
    const q = this.device.queue;
    if (V.nStreamSlots > m.markCap) throw new Error('stream slots beyond their capacity');
    q.writeBuffer(m.buffers[0] as GPUBuffer, 0, packStruct(VEC_LAYOUT, V.uniform));
    if (m.D.nInst) q.writeBuffer(m.buffers[1] as GPUBuffer, 0, V.inst);
    if (V.nStreamSegs) q.writeBuffer(m.buffers[13] as GPUBuffer, 0, V.streamSegs);
    q.writeBuffer(
      m.marks.uniform,
      0,
      packStruct(JOB_LAYOUT, {
        n: V.nStreamSlots,
        blocks: blocksOf(V.nStreamSlots),
        cap: m.markCap,
        mode: JobMode.marks,
      }),
    );
    m.nSlots = V.nStreamSlots;
    m.nSegs = V.nStreamSegs;
  }

  /** Records the expansion and both compactions. */
  encode(pass: GPUComputePassEncoder): void {
    const m = this.need();
    const D = m.D;
    const run = (e: Entry, n: number, group = m.groups[e], size = 64) => {
      if (!n) return;
      pass.setPipeline(this.pipes[e]);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(Math.ceil(n / size));
    };
    run('expand_caps', D.nCapSlots);
    run('expand_dots', D.nDots);
    run('expand_blobs', D.nBlobs);
    // the compactions run even when empty, so the draw arguments say 0
    run('scan_local', Math.max(1, D.nCapSlots), m.groups.scan_local, SCAN_BLOCK);
    run('scan_blocks', 1, m.groups.scan_blocks, 1);
    run('scatter_caps', D.nCapSlots);
    run('stream_marks', m.nSlots);
    run('scan_local', Math.max(1, m.nSlots), m.markGroups.scan_local, SCAN_BLOCK);
    run('scan_blocks', 1, m.markGroups.scan_blocks, 1);
    run('scatter_marks', m.nSlots);
  }

  /** The drawings' layers (line ink, after the line-work's hatching): capsules, dots, blobs. */
  layers(): InkLayer[] {
    const m = this.model;
    if (!m) return [];
    const D = m.D;
    const b = m.buffers;
    const out: InkLayer[] = [];
    if (D.nCapSlots)
      out.push({
        kind: 'gpu-capsules',
        buffer: b[20] as GPUBuffer,
        count: m.caps.cap,
        gain: 1,
        indirect: m.caps.args,
      });
    const sprites = (atlas: 'dots' | 'knots', buffer: GPUBuffer, n: number, args: GPUBuffer) =>
      out.push({
        kind: 'gpu-sprites',
        atlas,
        gain: 1,
        source: {
          buffer,
          offset: 0,
          size: Math.max(16, n * INSTANCE_LAYOUT.size),
          indirect: args,
          indirectOffset: 0,
        },
      });
    if (D.nDots) sprites('dots', b[11] as GPUBuffer, D.nDots, m.dotArgs);
    if (D.nBlobs) sprites('knots', b[12] as GPUBuffer, D.nBlobs, m.blobArgs);
    return out;
  }

  /** The streams' dots and knots (old ink, after the stipple's populations). */
  streamLayers(): InkLayer[] {
    const m = this.model;
    if (!m?.D.parts.streams.length) return [];
    const bytes = m.markCap * INSTANCE_LAYOUT.size;
    return (['dots', 'knots'] as const).map((atlas, c) => ({
      kind: 'gpu-sprites',
      atlas,
      gain: 1,
      pop: 'old' as const,
      source: {
        buffer: m.buffers[21] as GPUBuffer,
        offset: c * bytes,
        size: bytes,
        indirect: m.marks.args,
        indirectOffset: c * 16,
      },
    }));
  }

  /** Statistics only (a read-back): the compactions' counts. */
  async readCounts(): Promise<{ nCaps: number; nSdots: number; nSknots: number }> {
    const m = this.need();
    const d = this.device;
    const dst = d.createBuffer({
      size: 48,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const enc = d.createCommandEncoder();
    enc.copyBufferToBuffer(m.caps.args, 0, dst, 0, 16);
    enc.copyBufferToBuffer(m.marks.args, 0, dst, 16, 32);
    d.queue.submit([enc.finish()]);
    await dst.mapAsync(GPUMapMode.READ);
    const a = new Uint32Array(dst.getMappedRange().slice(0));
    dst.unmap();
    dst.destroy();
    return { nCaps: (a[0] ?? 0) / 6, nSdots: a[5] ?? 0, nSknots: a[9] ?? 0 };
  }

  /** Tests and statistics only: copies the outputs back. */
  async readBack(): Promise<{
    nCaps: number;
    caps: Float32Array;
    capsRaw: Float32Array;
    capKeys: Uint32Array;
    dots: ArrayBuffer;
    blobs: ArrayBuffer;
    nSdots: number;
    nSknots: number;
    sdots: ArrayBuffer;
    sknots: ArrayBuffer;
  }> {
    const m = this.need();
    const D = m.D;
    const b = m.buffers;
    const read = async (src: GPUBuffer, size: number, offset = 0): Promise<ArrayBuffer> => {
      const d = this.device;
      const bytes = Math.max(16, size);
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
    };
    const ca = new Uint32Array(await read(m.caps.args, 16));
    const ma = new Uint32Array(await read(m.marks.args, 32));
    const nCaps = (ca[0] ?? 0) / 6;
    const nSdots = ma[1] ?? 0;
    const nSknots = ma[5] ?? 0;
    const ib = INSTANCE_LAYOUT.size;
    return {
      nCaps,
      caps: new Float32Array(await read(b[20] as GPUBuffer, nCaps * CAPSULE_LAYOUT.size)),
      capsRaw: new Float32Array(await read(b[9] as GPUBuffer, D.nCapSlots * CAPSULE_LAYOUT.size)),
      capKeys: new Uint32Array(await read(m.caps.keys, D.nCapSlots * 4)),
      dots: await read(b[11] as GPUBuffer, D.nDots * ib),
      blobs: await read(b[12] as GPUBuffer, D.nBlobs * ib),
      nSdots,
      nSknots,
      sdots: await read(b[21] as GPUBuffer, nSdots * ib),
      sknots: await read(b[21] as GPUBuffer, nSknots * ib, m.markCap * ib),
    };
  }

  private need(): Model {
    if (!this.model) throw new Error('load the vector drawings first');
    return this.model;
  }

  /** Frees the model tier's buffers (the library's tables stay for the next load). */
  unload(): void {
    this.model?.own.forEach((b) => {
      b.destroy();
    });
    this.model = null;
  }

  destroy(): void {
    this.unload();
    this.libBuffers?.bufs.forEach((b) => {
      b.destroy();
    });
    this.libBuffers = null;
  }
}
