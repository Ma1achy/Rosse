/**
 * WebGPU device setup (ADR 0011): the capability check that decides whether to fall back to the
 * CPU engine, adapter and device request with the limits we rely on, and device-loss handling.
 *
 * Limits: the adapter's own `maxTextureArrayLayers` (so the 638-cell `pieces` sheet fits in one
 * array where it can; marks/atlas.ts splits it otherwise), and the adapter's storage-buffer and
 * buffer sizes up to 1 GiB. `timestamp-query` is enabled when available, for profiling.
 *
 * Loss: when the device is lost for any reason other than our own `destroy()`, a new adapter and
 * device are requested (up to `maxRecoveries` times in a row) and every listener is told, so it
 * can rebuild its GPU resources from the scene description. If recovery fails, `onFailure`
 * listeners are told, and the page switches to the CPU engine.
 */

export type Backend = 'webgpu' | 'cpu';

/** The parts of `navigator` we use, so tests can pass a fake. */
export interface GpuNavigator {
  gpu?: Pick<GPU, 'requestAdapter'> | undefined;
}

/**
 * Which engine to use: 'webgpu' when `navigator.gpu` exists and an adapter can be had, else
 * 'cpu'. `force` overrides (the page's `?backend=cpu`).
 */
export async function detectBackend(
  nav: GpuNavigator = globalThis.navigator,
  force?: Backend | null,
): Promise<Backend> {
  if (force) return force;
  if (!nav.gpu) return 'cpu';
  try {
    const adapter = await nav.gpu.requestAdapter({ powerPreference: 'high-performance' });
    return adapter ? 'webgpu' : 'cpu';
  } catch {
    return 'cpu';
  }
}

const GiB = 1024 * 1024 * 1024;

/** The limits we request from an adapter: its own, where we benefit, capped. */
export function requiredLimits(adapter: Pick<GPUAdapter, 'limits'>): Record<string, number> {
  const l = adapter.limits;
  return {
    maxTextureArrayLayers: l.maxTextureArrayLayers,
    maxStorageBufferBindingSize: Math.min(l.maxStorageBufferBindingSize, GiB),
    maxBufferSize: Math.min(l.maxBufferSize, GiB),
  };
}

export async function requestDevice(
  nav: GpuNavigator,
): Promise<{ adapter: GPUAdapter; device: GPUDevice }> {
  if (!nav.gpu) throw new Error('WebGPU is not available');
  const adapter = await nav.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('no WebGPU adapter');
  const requiredFeatures: GPUFeatureName[] = adapter.features.has('timestamp-query')
    ? ['timestamp-query']
    : [];
  const device = await adapter.requestDevice({
    label: 'rosse',
    requiredFeatures,
    requiredLimits: requiredLimits(adapter),
  });
  return { adapter, device };
}

/**
 * The GPU, surviving device loss. Hold on to this, not to `device`: after a loss, `device` is a
 * new object and every resource made from the old one must be rebuilt (see `onDevice`).
 */
export class Gpu {
  private deviceListeners = new Set<(device: GPUDevice) => void>();
  private failureListeners = new Set<(error: unknown) => void>();
  private destroyed = false;
  private recovering = false;
  /** recoveries since the last healthy frame */
  private recoveries = 0;

  private constructor(
    private readonly nav: GpuNavigator,
    public adapter: GPUAdapter,
    public device: GPUDevice,
    readonly maxRecoveries: number,
    readonly backoffMs: number,
  ) {
    this.watch(device);
  }

  /**
   * @param maxRecoveries how many device recreations in a row (without a healthy frame between,
   *   see `markHealthy`) before giving up
   * @param backoffMs the wait before the first recreation, doubled for each further attempt
   */
  static async create(
    nav: GpuNavigator = globalThis.navigator,
    maxRecoveries = 3,
    backoffMs = 100,
  ): Promise<Gpu> {
    const { adapter, device } = await requestDevice(nav);
    return new Gpu(nav, adapter, device, maxRecoveries, backoffMs);
  }

  /** Called with each new device after a loss. Returns an unsubscribe function. */
  onDevice(fn: (device: GPUDevice) => void): () => void {
    this.deviceListeners.add(fn);
    return () => this.deviceListeners.delete(fn);
  }

  /** Called when the device is lost and cannot be recreated. */
  onFailure(fn: (error: unknown) => void): () => void {
    this.failureListeners.add(fn);
    return () => this.failureListeners.delete(fn);
  }

  /**
   * Call after a frame has been presented on the current device: the recovery budget is
   * `maxRecoveries` losses in a row, not per page.
   */
  markHealthy(): void {
    this.recoveries = 0;
  }

  private gone(): boolean {
    return this.destroyed;
  }

  destroy(): void {
    this.destroyed = true;
    this.device.destroy();
  }

  private watch(device: GPUDevice): void {
    void device.lost.then((info) => {
      if (this.destroyed || info.reason === 'destroyed' || device !== this.device) return;
      console.warn(`WebGPU device lost: ${info.message}`);
      void this.recover();
    });
    device.addEventListener('uncapturederror', (e) => {
      console.error('WebGPU error:', e.error.message);
    });
  }

  private async recover(): Promise<void> {
    if (this.recovering) return;
    this.recovering = true;
    try {
      while (this.recoveries < this.maxRecoveries && !this.destroyed) {
        const wait = this.backoffMs * 2 ** this.recoveries;
        this.recoveries++;
        if (wait > 0)
          await new Promise((r) => {
            setTimeout(r, wait);
          });
        // gone() is a call, so it is re-read: destroy() may have run while we waited
        if (this.gone()) return;
        let next: { adapter: GPUAdapter; device: GPUDevice };
        try {
          next = await requestDevice(this.nav);
        } catch (e) {
          console.warn('WebGPU device recreation failed:', e);
          continue;
        }
        if (this.gone()) {
          // destroy() was called while we waited: the new device belongs to nobody
          next.device.destroy();
          return;
        }
        this.adapter = next.adapter;
        this.device = next.device;
        try {
          this.deviceListeners.forEach((fn) => {
            fn(next.device);
          });
        } catch (e) {
          // a listener could not rebuild on the new device: drop it and try again
          console.warn('Rebuilding on the new WebGPU device failed:', e);
          next.device.destroy();
          continue;
        }
        this.watch(next.device);
        return;
      }
      if (!this.destroyed)
        this.failureListeners.forEach((fn) => {
          fn(new Error('WebGPU device lost and could not be recreated'));
        });
    } finally {
      this.recovering = false;
    }
  }
}
