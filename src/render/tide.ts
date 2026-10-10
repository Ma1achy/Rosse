/**
 * The tidal map on the GPU (ADR 0003, 0009): the bins of the stars' initial disc coordinates (model
 * tier) and the two 49 × 49 grids (view tier), built by compute/tide.wgsl in one buffer of words
 * (src/fallback/kernels/tide.ts `TideData`), and the passes that carry a merging galaxy's marks by
 * them (compute/tide-apply.wgsl). Reference: `tidal` and the grid of render() (app23.js:L536–551,
 * L1241–1248).
 *
 * CPU twin: src/fallback/kernels/tide.ts.
 */
import tideWgsl from '../shaders/compute/tide.wgsl';
import tideApplyWgsl from '../shaders/compute/tide-apply.wgsl';
import { packStruct } from '../gpu/buffers';
import { readBuffer } from '../gpu/readback';
import {
  TIDE_CELL_COUNT,
  TIDE_GV,
  TJOB_LAYOUT,
  TIDE_HEADER,
  TideData,
  tideWords,
} from '../fallback/kernels/tide';

const STORAGE = GPUBufferUsage.STORAGE;

const MAP_ENTRIES = ['init_table', 'bin_count', 'bin_scan', 'bin_fill', 'grid'] as const;
type MapEntry = (typeof MAP_ENTRIES)[number];
const MAP_USES: Record<MapEntry, number[]> = {
  init_table: [1, 31],
  bin_count: [31],
  bin_scan: [31],
  bin_fill: [31],
  grid: [31],
};

/** The tidal map of one merger: its words, built once (the bins) and once per view (the grids). */
export class GpuTideMap {
  buffer: GPUBuffer | null = null;
  private groups = new Map<MapEntry, GPUBindGroup>();
  n = 0;
  n0 = 0;

  private constructor(
    readonly device: GPUDevice,
    private readonly pipes: Record<MapEntry, GPUComputePipeline>,
  ) {}

  static create(device: GPUDevice): GpuTideMap {
    const module = device.createShaderModule({ label: 'tide.wgsl', code: tideWgsl });
    const pipes = Object.fromEntries(
      MAP_ENTRIES.map((e) => [
        e,
        device.createComputePipeline({
          label: `tide.wgsl ${e}`,
          layout: 'auto',
          compute: { module, entryPoint: e },
        }),
      ]),
    ) as Record<MapEntry, GPUComputePipeline>;
    return new GpuTideMap(device, pipes);
  }

  /**
   * Model tier: the buffer for `n` stars (the first `n0` in galaxy 0), the star table's initial
   * coordinates from `ic` (vec4 per star), and the bins. The plate centre is (cx, cy).
   */
  load(n: number, n0: number, ic: GPUBuffer, cx = 400, cy = 400): GPUBuffer {
    this.destroy();
    this.n = n;
    this.n0 = n0;
    const d = this.device;
    const L = tideWords(n);
    this.buffer = d.createBuffer({
      label: 'tidal map',
      size: L.total * 4,
      usage: STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    const head = new TideData(n, n0, cx, cy).words.subarray(0, TIDE_HEADER);
    d.queue.writeBuffer(this.buffer, 0, head);
    const entries = (e: MapEntry): GPUBindGroupEntry[] =>
      MAP_USES[e].map((binding) => ({
        binding,
        resource: { buffer: binding === 1 ? ic : (this.buffer as GPUBuffer) },
      }));
    for (const e of MAP_ENTRIES)
      this.groups.set(
        e,
        d.createBindGroup({
          label: `tide ${e}`,
          layout: this.pipes[e].getBindGroupLayout(0),
          entries: entries(e),
        }),
      );
    const enc = d.createCommandEncoder({ label: 'tide bins' });
    const pass = enc.beginComputePass({ label: 'tide bins' });
    this.dispatch(pass, 'init_table', n);
    this.dispatch(pass, 'bin_count', 2 * TIDE_CELL_COUNT);
    this.dispatch(pass, 'bin_scan', 1, 1);
    this.dispatch(pass, 'bin_fill', 2 * TIDE_CELL_COUNT);
    pass.end();
    d.queue.submit([enc.finish()]);
    return this.buffer;
  }

  private dispatch(pass: GPUComputePassEncoder, e: MapEntry, n: number, size = 64): void {
    pass.setPipeline(this.pipes[e]);
    pass.setBindGroup(0, this.groups.get(e));
    pass.dispatchWorkgroups(Math.max(1, Math.ceil(n / size)));
  }

  /** View tier: the two grids, after the stars' plate positions have been written to the table. */
  encodeGrid(pass: GPUComputePassEncoder): void {
    this.dispatch(pass, 'grid', 2 * TIDE_GV * TIDE_GV);
  }

  /** Tests: every word. */
  async readWords(): Promise<Uint32Array> {
    if (!this.buffer) throw new Error('load the tidal map first');
    return new Uint32Array(await readBuffer(this.device, this.buffer, this.buffer.size));
  }

  destroy(): void {
    this.buffer?.destroy();
    this.buffer = null;
    this.groups.clear();
  }
}

const APPLY_ENTRIES = ['warp_instances', 'warp_ribbons', 'warp_caps'] as const;
export type ApplyEntry = (typeof APPLY_ENTRIES)[number];
const APPLY_USES: Record<ApplyEntry, number[]> = {
  warp_instances: [1, 2, 5, 31],
  warp_ribbons: [1, 3, 31],
  warp_caps: [1, 4, 31],
};
const APPLY_BINDING: Record<ApplyEntry, number> = {
  warp_instances: 2,
  warp_ribbons: 3,
  warp_caps: 4,
};

/** One thing to carry by the tides. */
export interface TideJob {
  /** names the job's uniform and bind group (a target buffer may be the same every frame) */
  key: string;
  entry: ApplyEntry;
  /** the instances, ribbon segments or capsules, modified in place */
  buffer: GPUBuffer;
  /** how many (an upper bound when `args` is given) */
  n: number;
  /** the galaxy (0 or 1) and R2, the plate px the grid spans */
  g: number;
  r2: number;
  /** a compaction's draw arguments: the count is word `argsIndex + 1` (`warp_instances` only) */
  args?: GPUBuffer;
  argsIndex?: number;
}

/** The passes that apply a galaxy's tides to its outputs (compute/tide-apply.wgsl). */
export class GpuTide {
  private uniforms = new Map<string, GPUBuffer>();
  private groups = new Map<string, { target: GPUBuffer; args: GPUBuffer; group: GPUBindGroup }>();
  private dummy: GPUBuffer;

  private constructor(
    readonly device: GPUDevice,
    private readonly pipes: Record<ApplyEntry, GPUComputePipeline>,
  ) {
    this.dummy = device.createBuffer({ label: 'no draw args', size: 16, usage: STORAGE });
  }

  static create(device: GPUDevice): GpuTide {
    const module = device.createShaderModule({ label: 'tide-apply.wgsl', code: tideApplyWgsl });
    const pipes = Object.fromEntries(
      APPLY_ENTRIES.map((e) => [
        e,
        device.createComputePipeline({
          label: `tide-apply.wgsl ${e}`,
          layout: 'auto',
          compute: { module, entryPoint: e },
        }),
      ]),
    ) as Record<ApplyEntry, GPUComputePipeline>;
    return new GpuTide(device, pipes);
  }

  /** Records one job. `tide` is the map's buffer. */
  encode(pass: GPUComputePassEncoder, tide: GPUBuffer, job: TideJob): void {
    if (job.n <= 0) return;
    const d = this.device;
    let uniform = this.uniforms.get(job.key);
    if (!uniform) {
      uniform = d.createBuffer({
        label: `tide job ${job.key}`,
        size: TJOB_LAYOUT.size,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.uniforms.set(job.key, uniform);
    }
    d.queue.writeBuffer(
      uniform,
      0,
      packStruct(TJOB_LAYOUT, {
        g: job.g,
        n: job.n,
        use_args: job.args ? 1 : 0,
        args_index: job.argsIndex ?? 0,
        r2: Math.fround(job.r2),
        pad0: 0,
        pad1: 0,
        pad2: 0,
      }),
    );
    const args = job.args ?? this.dummy;
    let g = this.groups.get(job.key);
    if (!g || g.target !== job.buffer || g.args !== args) {
      const buffers: Record<number, GPUBuffer> = {
        1: uniform,
        [APPLY_BINDING[job.entry]]: job.buffer,
        5: args,
        31: tide,
      };
      g = {
        target: job.buffer,
        args,
        group: d.createBindGroup({
          label: `tide ${job.key}`,
          layout: this.pipes[job.entry].getBindGroupLayout(0),
          entries: APPLY_USES[job.entry].map((binding) => ({
            binding,
            resource: { buffer: buffers[binding] as GPUBuffer },
          })),
        }),
      };
      this.groups.set(job.key, g);
    }
    pass.setPipeline(this.pipes[job.entry]);
    pass.setBindGroup(0, g.group);
    pass.dispatchWorkgroups(Math.ceil(job.n / 64));
  }

  /** The map's buffer changed (a new merger): the bind groups name it. */
  reset(): void {
    this.groups.clear();
  }

  destroy(): void {
    for (const b of this.uniforms.values()) b.destroy();
    this.uniforms.clear();
    this.groups.clear();
    this.dummy.destroy();
  }
}
