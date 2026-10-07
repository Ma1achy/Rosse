/**
 * A shell galaxy's simulated shells on the GPU (ADR 0003, 0009): the satellite's integration
 * (compute/shells.wgsl, in chunks of steps per submit), the detection of its shells (one
 * invocation, a few numbers: the model tier's one read-back, which fixes the arcs' curves), the
 * stars as dots instances, and the arcs as stroke ribbons through a face-on camera (they ignore
 * the camera, v21 parity). Reference: shellSprites and shellArcs (app23.js:L711–760).
 *
 * CPU twin: src/fallback/shells.ts, src/fallback/kernels/shells.ts.
 */
import shellsWgsl from '../shaders/compute/shells.wgsl';
import { bufferWithData, packStruct } from '../gpu/buffers';
import { GpuResources } from '../gpu/pool';
import { readBuffer } from '../gpu/readback';
import { INSTANCE_LAYOUT } from '../marks/instance';
import { SSIM_LAYOUT, ssimUniform } from '../fallback/kernels/shells';
import { shellRibbons, type ShellScene } from '../model/shells';
import { SHELL_CHUNK, arcsOf, shellSteps, type ShellArc } from '../sim/shells';
import { UNIT_SCALE, packView, viewDesc, type Camera } from '../view/camera';
import type { InkLayer } from './layers';
import { GpuRibbons } from './ribbons';

const ENTRIES = ['init_shell', 'integrate', 'polar_hist', 'detect', 'dots'] as const;
type Entry = (typeof ENTRIES)[number];

const USES: Record<Entry, number[]> = {
  init_shell: [0, 1, 2],
  integrate: [0, 1, 2],
  polar_hist: [0, 1, 3, 4],
  detect: [0, 1, 3, 4, 5],
  dots: [0, 1, 6, 7, 8],
};

const STORAGE = GPUBufferUsage.STORAGE;
const SRC = GPUBufferUsage.COPY_SRC;

export class GpuShells {
  private ribbons: GpuRibbons;
  private buffers: Record<number, GPUBuffer> = {};
  private groups = new Map<Entry, GPUBindGroup>();
  private own: GPUBuffer[] = [];
  scene: ShellScene | null = null;
  arcs: ShellArc[] = [];
  private ribbonsOn = false;
  private cam: Camera = { incl: 0, az: 0, pa: 0, winding: 1, zoom: 1 };

  private constructor(
    readonly device: GPUDevice,
    private readonly pipes: Record<Entry, GPUComputePipeline>,
    res: GpuResources,
  ) {
    this.ribbons = GpuRibbons.create(device, res);
  }

  static create(device: GPUDevice, res: GpuResources = new GpuResources(device)): GpuShells {
    const module = device.createShaderModule({ label: 'shells.wgsl', code: shellsWgsl });
    const pipes = Object.fromEntries(
      ENTRIES.map((e) => [
        e,
        device.createComputePipeline({
          label: `shells.wgsl ${e}`,
          layout: 'auto',
          compute: { module, entryPoint: e },
        }),
      ]),
    ) as Record<Entry, GPUComputePipeline>;
    return new GpuShells(device, pipes, res);
  }

  /** Dots made (the satellite's stars): all of them are drawn. */
  get count(): number {
    return this.scene?.p.shellStars ?? 0;
  }

  /** The model tier: the satellite to its time, the shells found, the arcs as ribbons. */
  async build(scene: ShellScene): Promise<ShellArc[]> {
    this.destroy();
    this.scene = scene;
    const d = this.device;
    const n = scene.p.shellStars;
    const keep = (b: GPUBuffer) => {
      this.own.push(b);
      return b;
    };
    const buf = (bytes: number, usage: number, label: string) =>
      keep(d.createBuffer({ label, size: Math.max(16, bytes), usage }));
    this.buffers = {
      0: buf(SSIM_LAYOUT.size, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'shell sim'),
      1: buf(n * 16, STORAGE | SRC, 'shell positions'),
      2: buf(n * 16, STORAGE | SRC, 'shell velocities'),
      3: buf(n * 8, STORAGE | SRC, 'shell polar'),
      4: buf(128 * 4, STORAGE | SRC, 'shell histogram'),
      5: buf(6 * 16, STORAGE | SRC, 'shell arcs'),
      6: keep(bufferWithData(d, scene.pool, STORAGE, 'shell pool')),
      7: keep(bufferWithData(d, scene.dotBase, STORAGE, 'shell dot sizes')),
      8: buf(n * INSTANCE_LAYOUT.size, STORAGE | SRC, 'shell dots'),
    };
    this.groups.clear();
    for (const e of ENTRIES)
      this.groups.set(
        e,
        d.createBindGroup({
          label: `shells ${e}`,
          layout: this.pipes[e].getBindGroupLayout(0),
          entries: USES[e].map((binding) => ({
            binding,
            resource: { buffer: this.buffers[binding] as GPUBuffer },
          })),
        }),
      );
    const steps = shellSteps(scene.p);
    const uni = (st0: number, st1: number) => {
      d.queue.writeBuffer(
        this.buffers[0] as GPUBuffer,
        0,
        packStruct(
          SSIM_LAYOUT,
          ssimUniform(scene.p, scene.key, st0, st1, UNIT_SCALE, scene.variation.dotPool.length),
        ),
      );
    };
    this.dispatch('init_shell', n, () => {
      uni(0, 0);
    });
    for (let st = 0; st < steps; st += SHELL_CHUNK) {
      this.dispatch('integrate', n, () => {
        uni(st, Math.min(steps, st + SHELL_CHUNK));
      });
      await d.queue.onSubmittedWorkDone();
    }
    this.dispatch('polar_hist', n, () => {
      uni(0, 0);
    });
    this.dispatch(
      'detect',
      1,
      () => {
        uni(0, 0);
      },
      1,
    );
    this.arcs = arcsOf(new Float32Array(await readBuffer(d, this.buffers[5] as GPUBuffer, 6 * 16)));
    if (scene.opts.arcs) this.arcs = [...scene.opts.arcs];

    // the arcs as ribbons through a face-on camera
    const R = shellRibbons(scene, this.arcs);
    this.ribbonsOn = !!R;
    if (R) {
      const view = buf(64, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'shell view');
      this.buffers[9] = view;
      this.ribbons.load(
        R,
        view,
        this.buffers[6] as GPUBuffer,
        this.buffers[7] as GPUBuffer,
        keep(bufferWithData(d, new Uint32Array(16 * 8), STORAGE, 'shell noise (none)')),
      );
    }
    this.buffers[10] = keep(
      bufferWithData(
        d,
        new Uint32Array([4, n, 0, 0]),
        GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_SRC,
        'shell dots args',
      ),
    );
    return this.arcs;
  }

  private dispatch(entry: Entry, n: number, write: () => void, size = 64): void {
    write();
    const enc = this.device.createCommandEncoder({ label: `shells ${entry}` });
    const pass = enc.beginComputePass({ label: entry });
    pass.setPipeline(this.pipes[entry]);
    pass.setBindGroup(0, this.groups.get(entry));
    pass.dispatchWorkgroups(Math.max(1, Math.ceil(n / size)));
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  /** The view tier at a zoom: the dots placed, the arcs expanded. */
  view(zoom: number): void {
    const scene = this.scene;
    if (!scene) throw new Error('build the shells first');
    const d = this.device;
    d.queue.writeBuffer(
      this.buffers[0] as GPUBuffer,
      0,
      packStruct(
        SSIM_LAYOUT,
        ssimUniform(scene.p, scene.key, 0, 0, UNIT_SCALE * zoom, scene.variation.dotPool.length),
      ),
    );
    const enc = d.createCommandEncoder({ label: 'shells view' });
    const pass = enc.beginComputePass({ label: 'shells dots and arcs' });
    pass.setPipeline(this.pipes.dots);
    pass.setBindGroup(0, this.groups.get('dots'));
    pass.dispatchWorkgroups(Math.ceil(scene.p.shellStars / 64));
    if (this.ribbonsOn) {
      this.cam = { incl: 0, az: 0, pa: 0, winding: 1, zoom };
      d.queue.writeBuffer(this.buffers[9] as GPUBuffer, 0, packView(viewDesc(this.cam, 0, 0, 0)));
      this.ribbons.setView(this.cam, scene.P, scene.variation.dotPool.length);
      this.ribbons.encodeProject(pass);
      this.ribbons.encodeExpand(pass);
    }
    pass.end();
    d.queue.submit([enc.finish()]);
  }

  /** The arcs' ribbons, then the dots (old ink). */
  layers(): InkLayer[] {
    if (!this.scene) return [];
    const n = this.scene.p.shellStars;
    return [
      ...(this.ribbonsOn ? this.ribbons.layers() : []),
      {
        kind: 'gpu-sprites',
        atlas: 'dots',
        gain: 1,
        source: {
          buffer: this.buffers[8] as GPUBuffer,
          offset: 0,
          size: Math.max(16, n * INSTANCE_LAYOUT.size),
          indirect: this.buffers[10] as GPUBuffer,
          indirectOffset: 0,
        },
      },
    ];
  }

  /** Tests: the final positions. */
  async readPositions(): Promise<Float32Array> {
    const n = this.count;
    return new Float32Array(await readBuffer(this.device, this.buffers[1] as GPUBuffer, n * 16));
  }

  async readDots(): Promise<Float32Array> {
    const n = this.count;
    return new Float32Array(
      await readBuffer(this.device, this.buffers[8] as GPUBuffer, n * INSTANCE_LAYOUT.size),
    );
  }

  destroy(): void {
    for (const b of this.own) b.destroy();
    this.own = [];
    this.buffers = {};
    this.groups.clear();
    this.ribbons.destroy();
    this.scene = null;
    this.ribbonsOn = false;
  }
}
