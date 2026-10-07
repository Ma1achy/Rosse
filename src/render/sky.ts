/**
 * The deep field and the foreground stars on the GPU (M7, ADR 0003, 0010): the catalogue
 * (src/model/sky.ts) uploaded once per scene, and per view the passes of compute/sky.wgsl:
 * `sky_cull`, the compaction of the galaxies that are on the plate (the scan entry points of
 * compute/scan.wgsl, one class, in catalogue order), `sky_dots`, `rows_sky` (the drawings as the
 * rows of a dynamic vector set, expanded by compute/vector-expand.wgsl) and `sky_fg`. Nothing comes
 * back to the CPU: the dots are drawn from fixed slots (a galaxy's unused slots are zero
 * instances), the drawings from the vector set's compaction.
 *
 * Owned by GpuStipple, which records `encode` in its view pass. CPU twin: src/fallback/kernels/sky.ts.
 */
import skyWgsl from '../shaders/compute/sky.wgsl';
import scanWgsl from '../shaders/compute/scan.wgsl';
import { bufferWithData, packStruct } from '../gpu/buffers';
import { BLOCK_STRIDE, blockCount, classCapacity } from '../fallback/kernels/scan';
import { INSTANCE_LAYOUT, type StructLayout } from '../marks/instance';
import type { PackedVectors } from '../marks/vector';
import type { Params } from '../core/params';
import { dynDesc, dynUniform } from '../model/dynvec';
import { SKY_DOTS_PER_GALAXY, SKY_ROWS_PER_GALAXY, type SkyDesc } from '../model/sky';
import { wobbleAmplitude } from '../view/warp';
import { packNoise } from '../core/noise';
import { viewDesc, type Camera } from '../view/camera';
import { skyBound, skyInputs } from '../fallback/kernels/sky';
import { CLASS_COUNT } from '../model/classes';
import type { InkLayer } from './layers';
import { GpuVectors } from './vectors';

const STORAGE = GPUBufferUsage.STORAGE;

/** The `SkyU` uniform of sky.wgsl. */
export const SKY_UNIFORM_LAYOUT: StructLayout = {
  name: 'SkyU',
  size: 48,
  align: 4,
  fields: [
    ['n_bg', 'u32'],
    ['n_fg', 'u32'],
    ['key', 'u32'],
    ['n_dot_pool', 'u32'],
    ['vis_cap', 'u32'],
    ['massive', 'u32'],
    ['wobble', 'f32'],
    ['pad0', 'u32'],
    ['stride_c', 'u32'],
    ['stride_d', 'u32'],
    ['stride_b', 'u32'],
    ['pad1', 'u32'],
  ].map(([name, type], i) => ({
    name: name as string,
    type: type as 'u32' | 'f32',
    offset: i * 4,
    size: 4,
  })),
};

type Entry = 'sky_cull' | 'sky_dots' | 'rows_sky' | 'sky_fg';

interface Model {
  S: SkyDesc;
  own: GPUBuffer[];
  uniform: GPUBuffer;
  scan: GPUBuffer;
  groups: Record<Entry, GPUBindGroup>;
  scanGroups: { local: GPUBindGroup; blocks: GPUBindGroup; scatter: GPUBindGroup };
  blocks: number;
  dots: GPUBuffer;
  fg: GPUBuffer;
  dotArgs: GPUBuffer;
  fgArgs: GPUBuffer;
  /** the compaction's draw arguments: the visible galaxies' count at [1] */
  args: GPUBuffer;
  /** the key, pool size and strides this scene was loaded with */
  key: number;
  nDotPool: number;
  /** the galaxies this view can show (≤ visCap): what is dispatched */
  bound: number;
}

export class GpuSky {
  private model: Model | null = null;

  private constructor(
    readonly device: GPUDevice,
    private readonly pipes: Record<Entry, GPUComputePipeline>,
    private readonly scanPipes: {
      local: GPUComputePipeline;
      blocks: GPUComputePipeline;
      scatter: GPUComputePipeline;
    },
    /** the galaxies' drawings (a dynamic vector set) */
    readonly vectors: GpuVectors,
  ) {}

  static create(device: GPUDevice): GpuSky {
    const mod = device.createShaderModule({ label: 'sky.wgsl', code: skyWgsl });
    const entry = (e: Entry) =>
      device.createComputePipeline({
        label: `sky.wgsl ${e}`,
        layout: 'auto',
        compute: { module: mod, entryPoint: e },
      });
    const scanMod = device.createShaderModule({ label: 'scan.wgsl', code: scanWgsl });
    const sc = (e: string) =>
      device.createComputePipeline({
        label: `scan.wgsl ${e} (sky)`,
        layout: 'auto',
        compute: { module: scanMod, entryPoint: e },
      });
    return new GpuSky(
      device,
      {
        sky_cull: entry('sky_cull'),
        sky_dots: entry('sky_dots'),
        rows_sky: entry('rows_sky'),
        sky_fg: entry('sky_fg'),
      },
      { local: sc('scan_local'), blocks: sc('scan_blocks'), scatter: sc('scatter') },
      GpuVectors.create(device),
    );
  }

  get active(): boolean {
    return this.model !== null;
  }

  /** Model tier: the catalogue and the buffers of one view. `view` is the stipple's View uniform. */
  load(
    P: Params,
    S: SkyDesc | null,
    lib: PackedVectors,
    view: GPUBuffer,
    pool: GPUBuffer,
    dotBase: GPUBuffer,
    noise: GPUBuffer,
    key: number,
    nDotPool: number,
  ): void {
    this.unload();
    if (!S) return;
    const d = this.device;
    const own: GPUBuffer[] = [];
    const keep = <T extends GPUBuffer>(b: T): T => {
      own.push(b);
      return b;
    };
    const buf = (size: number, usage: number, label: string) =>
      keep(d.createBuffer({ label, size: Math.max(64, size), usage }));
    const ib = INSTANCE_LAYOUT.size;
    const nBg = Math.max(1, S.nBg);
    const cap = classCapacity(nBg);
    const blocks = blockCount(nBg);
    const uniform = buf(
      SKY_UNIFORM_LAYOUT.size,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      'sky uniform',
    );
    const bg = keep(bufferWithData(d, S.bgBuf, STORAGE, 'sky catalogue'));
    const fg = keep(bufferWithData(d, S.fgBuf, STORAGE, 'foreground stars'));
    const items = keep(bufferWithData(d, S.items, STORAGE, 'sky drawings'));
    const visIn = buf(nBg * ib, STORAGE, 'sky galaxies');
    const keys = buf(nBg * 4, STORAGE, 'sky keys');
    const scan = keep(
      bufferWithData(
        d,
        new Uint32Array([S.nBg, cap, blocks, 0]),
        GPUBufferUsage.UNIFORM,
        'sky scan',
      ),
    );
    const rank = buf(nBg * 4, STORAGE, 'sky rank');
    const totals = buf(blocks * 8, STORAGE, 'sky block totals');
    const offsets = buf(blocks * BLOCK_STRIDE * 4, STORAGE, 'sky block offsets');
    const args = buf(CLASS_COUNT * 16, STORAGE | GPUBufferUsage.COPY_SRC, 'sky args');
    const vis = buf(cap * ib, STORAGE | GPUBufferUsage.COPY_SRC, 'visible galaxies');
    const nDotSlots = S.visCap * SKY_DOTS_PER_GALAXY;
    const dots = buf(nDotSlots * ib, STORAGE | GPUBufferUsage.COPY_SRC, 'deep field dots');
    const fgOut = buf(
      Math.max(1, S.nFg) * ib,
      STORAGE | GPUBufferUsage.COPY_SRC,
      'foreground stars out',
    );
    const dotArgs = keep(
      bufferWithData(
        d,
        new Uint32Array([4, nDotSlots, 0, 0]),
        GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
        'sky dot args',
      ),
    );
    const fgArgs = keep(
      bufferWithData(d, new Uint32Array([4, S.nFg, 0, 0]), GPUBufferUsage.INDIRECT, 'fg args'),
    );
    if (S.spec.rows && S.spec.strideCaps)
      this.vectors.load(dynDesc(lib, P, S.spec), pool, dotBase, noise);
    const inst =
      S.spec.rows && S.spec.strideCaps ? this.vectors.instances : buf(256, STORAGE, 'no rows');
    const group = (p: GPUComputePipeline, entries: [number, GPUBuffer][]) =>
      d.createBindGroup({
        layout: p.getBindGroupLayout(0),
        entries: entries.map(([binding, buffer]) => ({ binding, resource: { buffer } })),
      });
    const P2 = this.pipes;
    this.model = {
      S,
      own,
      uniform,
      scan,
      blocks,
      dots,
      fg: fgOut,
      dotArgs,
      fgArgs,
      args,
      key,
      nDotPool,
      bound: 0,
      groups: {
        sky_cull: group(P2.sky_cull, [
          [0, view],
          [1, uniform],
          [2, bg],
          [7, visIn],
          [8, keys],
        ]),
        sky_dots: group(P2.sky_dots, [
          [0, view],
          [1, uniform],
          [2, bg],
          [5, pool],
          [6, dotBase],
          [9, vis],
          [10, args],
          [11, dots],
          [30, noise],
        ]),
        rows_sky: group(P2.rows_sky, [
          [0, view],
          [1, uniform],
          [2, bg],
          [4, items],
          [9, vis],
          [10, args],
          [13, inst],
        ]),
        sky_fg: group(P2.sky_fg, [
          [0, view],
          [1, uniform],
          [3, fg],
          [12, fgOut],
          [30, noise],
        ]),
      },
      scanGroups: {
        local: group(this.scanPipes.local, [
          [0, scan],
          [1, keys],
          [2, rank],
          [3, totals],
        ]),
        blocks: group(this.scanPipes.blocks, [
          [0, scan],
          [3, totals],
          [4, offsets],
          [5, args],
        ]),
        scatter: group(this.scanPipes.scatter, [
          [0, scan],
          [1, keys],
          [2, rank],
          [4, offsets],
          [6, visIn],
          [7, vis],
        ]),
      },
    };
  }

  /** View tier: this view's uniform (the hand wobble follows `distort`) and its dispatch bound. */
  setView(P: Params, cam: Camera): void {
    const m = this.model;
    if (!m) return;
    const S = m.S;
    const bound = skyBound(
      skyInputs(
        S,
        {
          V: viewDesc(cam, 0, 0, 0),
          key: m.key,
          wobble: 0,
          nDotPool: m.nDotPool,
          massive: S.massive,
        },
        new Uint32Array(0),
        new Float32Array(0),
        packNoise(),
      ),
    );
    m.bound = bound;
    this.device.queue.writeBuffer(
      m.uniform,
      0,
      packStruct(SKY_UNIFORM_LAYOUT, {
        n_bg: S.nBg,
        n_fg: S.nFg,
        key: m.key >>> 0,
        n_dot_pool: m.nDotPool,
        vis_cap: bound,
        massive: S.massive ? 1 : 0,
        wobble: wobbleAmplitude(P.distort),
        pad0: 0,
        stride_c: S.spec.strideCaps,
        stride_d: S.spec.strideDots,
        stride_b: S.spec.strideBlobs,
        pad1: 0,
      }),
    );
    if (S.spec.rows && S.spec.strideCaps)
      this.vectors.setView({
        rows: [],
        inst: new ArrayBuffer(0),
        nStreamSegs: 0,
        nStreamSlots: 0,
        streamSegs: new ArrayBuffer(0),
        uniform: dynUniform(P, S.spec, bound * SKY_ROWS_PER_GALAXY, m.key, m.nDotPool),
      });
    this.device.queue.writeBuffer(
      m.dotArgs,
      0,
      new Uint32Array([4, bound * SKY_DOTS_PER_GALAXY, 0, 0]),
    );
  }

  /** Records the view's passes. */
  encode(pass: GPUComputePassEncoder): void {
    const m = this.model;
    if (!m) return;
    const S = m.S;
    const run = (e: Entry, n: number) => {
      if (!n) return;
      pass.setPipeline(this.pipes[e]);
      pass.setBindGroup(0, m.groups[e]);
      pass.dispatchWorkgroups(Math.ceil(n / 64));
    };
    run('sky_fg', S.nFg);
    if (!S.nBg) return;
    run('sky_cull', S.nBg);
    pass.setPipeline(this.scanPipes.local);
    pass.setBindGroup(0, m.scanGroups.local);
    pass.dispatchWorkgroups(m.blocks);
    pass.setPipeline(this.scanPipes.blocks);
    pass.setBindGroup(0, m.scanGroups.blocks);
    pass.dispatchWorkgroups(1);
    pass.setPipeline(this.scanPipes.scatter);
    pass.setBindGroup(0, m.scanGroups.scatter);
    pass.dispatchWorkgroups(Math.ceil(S.nBg / 64));
    run('sky_dots', m.bound * SKY_DOTS_PER_GALAXY);
    if (S.spec.rows && S.spec.strideCaps) {
      run('rows_sky', m.bound * SKY_ROWS_PER_GALAXY);
      this.vectors.encode(pass);
    }
  }

  /** The background: the dots, then the galaxies' drawings (line ink, before everything else). */
  background(): InkLayer[] {
    const m = this.model;
    if (!m || !m.S.nBg) return [];
    const S = m.S;
    const ib = INSTANCE_LAYOUT.size;
    return [
      {
        kind: 'gpu-sprites',
        atlas: 'dots',
        gain: 1,
        source: {
          buffer: m.dots,
          offset: 0,
          // the capacity, not this view's bound: the binding must not move with the camera (ADR 0070)
          size: Math.max(16, S.visCap * SKY_DOTS_PER_GALAXY * ib),
          indirect: m.dotArgs,
          indirectOffset: 0,
        },
      },
      ...(S.spec.rows && S.spec.strideCaps ? this.vectors.layers() : []),
    ];
  }

  /** The foreground stars (the `star` ink, drawn last). */
  foreground(): InkLayer[] {
    const m = this.model;
    if (!m || !m.S.nFg) return [];
    return [
      {
        kind: 'gpu-sprites',
        atlas: 'fgstars',
        gain: 1,
        source: {
          buffer: m.fg,
          offset: 0,
          size: Math.max(16, m.S.nFg * INSTANCE_LAYOUT.size),
          indirect: m.fgArgs,
          indirectOffset: 0,
        },
      },
    ];
  }

  /** Tests only: the visible galaxies' count, and the dots and foreground stars written. */
  async readBack(): Promise<{
    nVis: number;
    dots: Float32Array;
    dotsU: Uint32Array;
    fg: Float32Array;
    fgU: Uint32Array;
  }> {
    const m = this.need();
    const d = this.device;
    const read = async (src: GPUBuffer, size: number) => {
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
    const ib = INSTANCE_LAYOUT.size;
    const dots = await read(m.dots, m.S.visCap * SKY_DOTS_PER_GALAXY * ib);
    const fg = await read(m.fg, Math.max(1, m.S.nFg) * ib);
    const args = new Uint32Array(await read(m.args, 16));
    return {
      nVis: args[1] ?? 0,
      dots: new Float32Array(dots),
      dotsU: new Uint32Array(dots),
      fg: new Float32Array(fg),
      fgU: new Uint32Array(fg),
    };
  }

  private need(): Model {
    if (!this.model) throw new Error('load the sky first');
    return this.model;
  }

  unload(): void {
    this.model?.own.forEach((b) => {
      b.destroy();
    });
    this.model = null;
    this.vectors.unload();
  }

  destroy(): void {
    this.unload();
    this.vectors.destroy();
  }
}
