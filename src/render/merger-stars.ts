/**
 * The merger's test stars on the GPU (ADR 0003, 0009): the model tier's integration
 * (compute/merger.wgsl `init_stars`, `start_phase`, `integrate`, `finish_phase`) in chunks of
 * about 200 steps per submit, so a long horizon never stalls a frame, and the view tier's `blend`
 * (the state at `mTime`, as `snapAt`) and `radii` (for the framing). The core track is the CPU's
 * f64 one, uploaded as f32 positions per kick.
 *
 * Nothing is read back on the frame path. The one read-back of the model tier is the distances of
 * every fifth star at the chosen moment and at the horizon's end (`readRadii`): they set the
 * framing, which the CPU needs for the galaxies' cameras (ADR 0040).
 *
 * CPU twin: src/fallback/kernels/merger.ts.
 */
import mergerWgsl from '../shaders/compute/merger.wgsl';
import { bufferWithData, packStruct } from '../gpu/buffers';
import { readBuffer } from '../gpu/readback';
import {
  CHUNK_STEPS,
  MJOB_LAYOUT,
  MSEL_LAYOUT,
  MSIM_LAYOUT,
  packGals,
  selUniform,
  simUniform,
} from '../fallback/kernels/merger';
import type { MergerDesc, SnapSelect } from '../sim/merger';

const ENTRIES = [
  'init_stars',
  'start_phase',
  'integrate',
  'finish_phase',
  'blend',
  'radii',
] as const;
type Entry = (typeof ENTRIES)[number];

/** Which bindings of merger.wgsl each entry point uses (its auto layout). */
const USES: Record<Entry, number[]> = {
  init_stars: [0, 1, 3, 4, 5],
  start_phase: [0, 2, 3, 4, 6, 7],
  integrate: [0, 2, 3, 4, 6, 7],
  finish_phase: [0, 3, 8],
  blend: [0, 6, 9, 10, 11, 12, 13, 14],
  radii: [0, 14, 15, 16],
};

const STORAGE = GPUBufferUsage.STORAGE;
const SRC = GPUBufferUsage.COPY_SRC;

export interface MergerProgress {
  phase: 'timeline' | 'future';
  done: number;
  of: number;
}

export class GpuMergerStars {
  private desc: MergerDesc | null = null;
  private buffers: Record<string, GPUBuffer> = {};
  private groups = new Map<string, GPUBindGroup>();
  /** chosen-moment and horizon states exist once their phase has run */
  ready = { timeline: false, future: false };

  private constructor(
    readonly device: GPUDevice,
    private readonly pipes: Record<Entry, GPUComputePipeline>,
  ) {}

  static create(device: GPUDevice): GpuMergerStars {
    const module = device.createShaderModule({ label: 'merger.wgsl', code: mergerWgsl });
    const pipes = Object.fromEntries(
      ENTRIES.map((e) => [
        e,
        device.createComputePipeline({
          label: `merger.wgsl ${e}`,
          layout: 'auto',
          compute: { module, entryPoint: e },
        }),
      ]),
    ) as Record<Entry, GPUComputePipeline>;
    return new GpuMergerStars(device, pipes);
  }

  get description(): MergerDesc {
    if (!this.desc) throw new Error('load a merger first');
    return this.desc;
  }

  /** The stars' current positions after `blend` (vec4 each). */
  get current(): GPUBuffer {
    return this.buf('cur');
  }

  /** The initial disc coordinates (DX, DY, R0, 0) per star. */
  get initial(): GPUBuffer {
    return this.buf('ic');
  }

  /** The chosen moment's state (f32), after the timeline phase. */
  get chosen(): GPUBuffer {
    return this.buf('chosen');
  }

  get horizon(): GPUBuffer {
    return this.buf('horizon');
  }

  private buf(name: string): GPUBuffer {
    const b = this.buffers[name];
    if (!b) throw new Error(`merger buffer ${name} missing: load a merger first`);
    return b;
  }

  /** Model tier: the buffers for a description. The stars start when `run` is called. */
  load(d: MergerDesc): void {
    this.destroy();
    this.desc = d;
    const dev = this.device;
    const N = d.total;
    const make = (name: string, bytes: number, usage: number) => {
      this.buffers[name] = dev.createBuffer({
        label: `merger ${name}`,
        size: Math.max(16, bytes),
        usage,
      });
    };
    make('xs', N * 16, STORAGE | SRC);
    make('vs', N * 16, STORAGE | SRC);
    make('ic', N * 16, STORAGE | SRC);
    make('snap1', d.rows[0] * N * 8, STORAGE | SRC);
    make('snap2', d.rows[1] * N * 8, STORAGE | SRC);
    make('chosen', N * 16, STORAGE | SRC);
    make('horizon', N * 16, STORAGE | SRC);
    make('cur', N * 16, STORAGE | SRC);
    make('radii', Math.ceil(N / 5) * 4, STORAGE | SRC);
    this.buffers.cores = bufferWithData(dev, d.cores, STORAGE | SRC, 'merger cores');
    this.buffers.sim = bufferWithData(
      dev,
      packStruct(MSIM_LAYOUT, simUniform(d)),
      GPUBufferUsage.UNIFORM,
      'merger sim',
    );
    this.buffers.gal = bufferWithData(dev, packGals(d), GPUBufferUsage.UNIFORM, 'merger galaxies');
    const uni = (name: string, bytes: number) =>
      (this.buffers[name] = dev.createBuffer({
        label: `merger ${name}`,
        size: bytes,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }));
    uni('job', MJOB_LAYOUT.size);
    uni('sel', MSEL_LAYOUT.size);
    uni('centre', 16);
    this.ready = { timeline: false, future: false };
    this.groups.clear();
  }

  private group(entry: Entry, tag: string, binding7?: string, binding8?: string): GPUBindGroup {
    const key = `${entry}:${tag}`;
    let g = this.groups.get(key);
    if (g) return g;
    const named: Record<number, string> = {
      0: 'sim',
      1: 'gal',
      2: 'job',
      3: 'xs',
      4: 'vs',
      5: 'ic',
      6: 'cores',
      7: binding7 ?? 'snap1',
      8: binding8 ?? 'chosen',
      9: 'snap1',
      10: 'snap2',
      11: 'chosen',
      12: 'horizon',
      13: 'sel',
      14: 'cur',
      15: 'radii',
      16: 'centre',
    };
    g = this.device.createBindGroup({
      label: `merger ${key}`,
      layout: this.pipes[entry].getBindGroupLayout(0),
      entries: USES[entry].map((binding) => ({
        binding,
        resource: { buffer: this.buf(named[binding] as string) },
      })),
    });
    this.groups.set(key, g);
    return g;
  }

  private dispatch(entry: Entry, g: GPUBindGroup, n = this.description.total): void {
    const enc = this.device.createCommandEncoder({ label: `merger ${entry}` });
    const pass = enc.beginComputePass({ label: entry });
    pass.setPipeline(this.pipes[entry]);
    pass.setBindGroup(0, g);
    pass.dispatchWorkgroups(Math.max(1, Math.ceil(n / 64)));
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  private writeJob(st0: number, st1: number, future: boolean): void {
    const d = this.description;
    const ph = future ? d.track.future : d.track.chosen;
    this.device.queue.writeBuffer(
      this.buf('job'),
      0,
      packStruct(MJOB_LAYOUT, {
        st0,
        st1,
        steps: Math.max(ph.steps, 0),
        every: ph.every,
        flags: future ? 1 : 0,
        core_off: future ? d.off.pos2 : d.off.pos1,
        pad0: 0,
        pad1: 0,
      }),
    );
  }

  /**
   * Runs the whole simulation: the initial conditions, the way in to the chosen moment, then on to
   * the horizon, in chunks of `CHUNK_STEPS` steps per submit. `yieldTo` is awaited between chunks
   * (the page passes a frame wait; the default waits for the queue); `onProgress` reports each.
   * The timeline is usable (`ready.timeline`) as soon as its phase is done.
   */
  async run(
    onProgress?: (p: MergerProgress) => void,
    yieldTo: () => Promise<void> = () => this.device.queue.onSubmittedWorkDone(),
  ): Promise<void> {
    const d = this.description;
    this.dispatch('init_stars', this.group('init_stars', 'all'));
    for (const future of [false, true]) {
      const ph = future ? d.track.future : d.track.chosen;
      const steps = Math.max(ph.steps, 0);
      const tag = future ? 'p2' : 'p1';
      const table = future ? 'snap2' : 'snap1';
      this.writeJob(0, 0, future);
      this.dispatch('start_phase', this.group('start_phase', tag, table));
      for (let st = 0; st < steps; st += CHUNK_STEPS) {
        const st1 = Math.min(steps, st + CHUNK_STEPS);
        this.writeJob(st, st1, future);
        this.dispatch('integrate', this.group('integrate', tag, table));
        onProgress?.({ phase: future ? 'future' : 'timeline', done: st1, of: steps });
        await yieldTo();
      }
      this.dispatch(
        'finish_phase',
        this.group('finish_phase', tag, undefined, future ? 'horizon' : 'chosen'),
      );
      this.ready[future ? 'future' : 'timeline'] = true;
    }
    await this.device.queue.onSubmittedWorkDone();
  }

  /** View tier: the stars' positions at a selected state into `current`. */
  blend(sel: SnapSelect): void {
    const d = this.description;
    this.device.queue.writeBuffer(this.buf('sel'), 0, packStruct(MSEL_LAYOUT, selUniform(d, sel)));
    this.dispatch('blend', this.group('blend', 'all'));
  }

  /**
   * The distances of every fifth star of `current` to `centre`, read back (the model tier's one
   * read-back, ADR 0040), for `frameOf`.
   */
  async readRadii(centre: readonly number[]): Promise<Float32Array> {
    const d = this.description;
    this.device.queue.writeBuffer(
      this.buf('centre'),
      0,
      new Float32Array([centre[0] ?? 0, centre[1] ?? 0, centre[2] ?? 0, 0]),
    );
    this.dispatch('radii', this.group('radii', 'all'), Math.ceil(d.total / 5));
    const n = Math.ceil(d.total / 5);
    return new Float32Array(await readBuffer(this.device, this.buf('radii'), n * 4));
  }

  /** Tests: positions and velocities, 4 words per star. */
  async readState(): Promise<{ xs: Float32Array; vs: Float32Array; ic: Float32Array }> {
    const N = this.description.total;
    const r = async (name: string) =>
      new Float32Array(await readBuffer(this.device, this.buf(name), N * 16));
    return { xs: await r('xs'), vs: await r('vs'), ic: await r('ic') };
  }

  /** Tests: the closing snapshots (f32). */
  async readClosing(): Promise<{ chosen: Float32Array; horizon: Float32Array }> {
    const N = this.description.total;
    const r = async (name: string) =>
      new Float32Array(await readBuffer(this.device, this.buf(name), N * 16));
    return { chosen: await r('chosen'), horizon: await r('horizon') };
  }

  /** Tests: the f16 tables. */
  async readTables(): Promise<{ snap1: Uint32Array; snap2: Uint32Array }> {
    const d = this.description;
    const r = async (name: string, rows: number) =>
      new Uint32Array(await readBuffer(this.device, this.buf(name), rows * d.total * 8));
    return { snap1: await r('snap1', d.rows[0]), snap2: await r('snap2', d.rows[1]) };
  }

  async readCurrent(): Promise<Float32Array> {
    return new Float32Array(
      await readBuffer(this.device, this.buf('cur'), this.description.total * 16),
    );
  }

  destroy(): void {
    for (const b of Object.values(this.buffers)) b.destroy();
    this.buffers = {};
    this.groups.clear();
    this.desc = null;
  }
}
