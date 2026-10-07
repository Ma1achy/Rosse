/**
 * GPU pass timing (M10): timestamp queries around the passes of a frame, read back after it.
 *
 * Off the frame path: nothing here runs unless a profiler is attached (`GpuStipple.profiler`,
 * `GpuRenderer.profiler`), and `collect()` is only called by the profiling harness
 * (tools/perf, tests/perf/perf.ts), never by the page. Needs the `timestamp-query` feature
 * (src/gpu/device.ts requests it when the adapter has it); `GpuProfiler.create` returns null
 * without it, so a caller reports "no GPU timestamps" and falls back to wall-clock time.
 */

export interface PassTimes {
  /** milliseconds per labelled pass, summed over the passes with that label */
  byLabel: Record<string, number>;
  /** the sum over every pass */
  totalMs: number;
}

export class GpuProfiler {
  private readonly querySet: GPUQuerySet;
  private readonly resolveBuffer: GPUBuffer;
  private readonly readBuffer: GPUBuffer;
  private labels: string[] = [];

  private constructor(
    private readonly device: GPUDevice,
    /** how many passes one frame may time */
    readonly capacity: number,
  ) {
    this.querySet = device.createQuerySet({ type: 'timestamp', count: capacity * 2 });
    const bytes = capacity * 2 * 8;
    this.resolveBuffer = device.createBuffer({
      label: 'timestamps',
      size: bytes,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    this.readBuffer = device.createBuffer({
      label: 'timestamps read',
      size: bytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }

  /** A profiler for a device, or null when it has no `timestamp-query`. */
  static create(device: GPUDevice, capacity = 64): GpuProfiler | null {
    return device.features.has('timestamp-query') ? new GpuProfiler(device, capacity) : null;
  }

  /** Forget the passes timed so far (call before a frame). */
  reset(): void {
    this.labels = [];
  }

  /**
   * The `timestampWrites` of the next pass, labelled. Undefined (no timing) when the capacity is
   * used up, which a frame of this engine never reaches.
   */
  span(label: string): GPUComputePassTimestampWrites | undefined {
    const i = this.labels.length;
    if (i >= this.capacity) return undefined;
    this.labels.push(label);
    return {
      querySet: this.querySet,
      beginningOfPassWriteIndex: 2 * i,
      endOfPassWriteIndex: 2 * i + 1,
    };
  }

  /** Resolves and reads the timestamps of the passes since `reset()`. */
  async collect(): Promise<PassTimes> {
    const n = this.labels.length;
    const byLabel: Record<string, number> = {};
    if (!n) return { byLabel, totalMs: 0 };
    const bytes = n * 2 * 8;
    const enc = this.device.createCommandEncoder({ label: 'timestamps' });
    enc.resolveQuerySet(this.querySet, 0, n * 2, this.resolveBuffer, 0);
    enc.copyBufferToBuffer(this.resolveBuffer, 0, this.readBuffer, 0, bytes);
    this.device.queue.submit([enc.finish()]);
    await this.readBuffer.mapAsync(GPUMapMode.READ, 0, bytes);
    const t = new BigUint64Array(this.readBuffer.getMappedRange(0, bytes).slice(0));
    this.readBuffer.unmap();
    let totalMs = 0;
    this.labels.forEach((label, i) => {
      const ns = Number((t[2 * i + 1] ?? 0n) - (t[2 * i] ?? 0n));
      const ms = Math.max(0, ns) / 1e6;
      byLabel[label] = (byLabel[label] ?? 0) + ms;
      totalMs += ms;
    });
    return { byLabel, totalMs };
  }

  destroy(): void {
    this.querySet.destroy();
    this.resolveBuffer.destroy();
    this.readBuffer.destroy();
  }
}
