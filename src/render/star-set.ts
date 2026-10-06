/**
 * The drawn stars on the GPU (M7): one `sstars` drawing per `rstar` the stipple's compaction kept,
 * expanded by the vector pass (compute/vector-expand.wgsl) as a dynamic set (src/model/dynvec.ts).
 * A rows pass (compute/dyn-rows.wgsl `rows_rstar`) writes the instance table from the compacted
 * `rstar` instances each view, so the count never leaves the GPU (ADR 0003); the capsules, dots and
 * blobs are compacted by the same scans as the placed parts' and drawn with their layers.
 *
 * Owned by GpuStipple, which records `encode` after the stipple's compaction. CPU twin: the drawn
 * stars of src/fallback/stipple.ts (`rstarRows`, `runVectors`).
 */
import dynRowsWgsl from '../shaders/compute/dyn-rows.wgsl';
import { bufferWithData, packStruct } from '../gpu/buffers';
import type { Params } from '../core/params';
import { dynDesc, dynUniform, type DynSpec } from '../model/dynvec';
import type { PackedVectors } from '../marks/vector';
import type { StructLayout } from '../marks/instance';
import { GpuVectors } from './vectors';
import type { InkLayer } from './layers';

/** The `Rows` uniform of dyn-rows.wgsl. */
export const ROWS_LAYOUT: StructLayout = {
  name: 'Rows',
  size: 32,
  align: 4,
  fields: [
    'n_rows',
    'src_base',
    'args_at',
    'first',
    'stride_c',
    'stride_d',
    'stride_b',
    'pad0',
  ].map((name, i) => ({ name, type: 'u32' as const, offset: i * 4, size: 4 })),
};

export class GpuStarSet {
  private pipe: GPUComputePipeline | null = null;
  private group: GPUBindGroup | null = null;
  private uniform: GPUBuffer | null = null;
  private spec: DynSpec = { rows: 0, strideCaps: 0, strideDots: 0, strideBlobs: 0 };

  constructor(
    readonly device: GPUDevice,
    readonly vectors: GpuVectors,
  ) {}

  static create(device: GPUDevice): GpuStarSet {
    return new GpuStarSet(device, GpuVectors.create(device));
  }

  /**
   * Model tier: the set for `spec.rows` drawn stars. `src` and `srcArgs` are the stipple's
   * compacted instances and draw arguments, `cls` the class of drawn stars, `cap` the per-class
   * capacity of `src`.
   */
  load(
    P: Params,
    lib: PackedVectors,
    spec: DynSpec,
    pool: GPUBuffer,
    dotBase: GPUBuffer,
    noise: GPUBuffer,
    src: GPUBuffer,
    srcArgs: GPUBuffer,
    cls: number,
    cap: number,
  ): void {
    this.unload();
    this.spec = spec;
    if (!spec.rows) return;
    const d = this.device;
    this.vectors.load(dynDesc(lib, P, spec), pool, dotBase, noise);
    this.pipe ??= d.createComputePipeline({
      label: 'dyn-rows.wgsl rows_rstar',
      layout: 'auto',
      compute: {
        module: d.createShaderModule({ label: 'dyn-rows.wgsl', code: dynRowsWgsl }),
        entryPoint: 'rows_rstar',
      },
    });
    this.uniform = bufferWithData(
      d,
      packStruct(ROWS_LAYOUT, {
        n_rows: spec.rows,
        src_base: cls * cap,
        args_at: cls * 4 + 1,
        first: lib.first.sstars,
        stride_c: spec.strideCaps,
        stride_d: spec.strideDots,
        stride_b: spec.strideBlobs,
        pad0: 0,
      }),
      GPUBufferUsage.UNIFORM,
      'drawn stars rows',
    );
    this.group = d.createBindGroup({
      layout: this.pipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniform } },
        { binding: 1, resource: { buffer: src } },
        { binding: 2, resource: { buffer: srcArgs } },
        { binding: 3, resource: { buffer: this.vectors.instances } },
      ],
    });
  }

  get active(): boolean {
    return this.spec.rows > 0 && this.group !== null;
  }

  /** View tier: this view's uniform (the hand wobble follows `distort`). */
  setView(P: Params, key: number, nDotPool: number): void {
    if (!this.active) return;
    this.vectors.setView({
      rows: [],
      inst: new ArrayBuffer(0),
      nStreamSegs: 0,
      nStreamSlots: 0,
      streamSegs: new ArrayBuffer(0),
      uniform: dynUniform(P, this.spec, this.spec.rows, key, nDotPool),
    });
  }

  /** Records the rows pass and the expansion; after the stipple's compaction. */
  encode(pass: GPUComputePassEncoder): void {
    if (!this.active || !this.pipe || !this.group) return;
    pass.setPipeline(this.pipe);
    pass.setBindGroup(0, this.group);
    pass.dispatchWorkgroups(Math.ceil(this.spec.rows / 64));
    this.vectors.encode(pass);
  }

  layers(): InkLayer[] {
    return this.active ? this.vectors.layers() : [];
  }

  unload(): void {
    this.vectors.unload();
    this.uniform?.destroy();
    this.uniform = null;
    this.group = null;
    this.spec = { rows: 0, strideCaps: 0, strideDots: 0, strideBlobs: 0 };
  }

  destroy(): void {
    this.unload();
    this.vectors.destroy();
  }
}
