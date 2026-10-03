import { describe, expect, it, vi } from 'vitest';
import { Gpu, detectBackend, requiredLimits, type GpuNavigator } from '../../src/gpu/device';

/** A fake adapter and device, enough for device.ts. */
function fakeNavigator(opts: { adapters?: boolean[]; later?: Promise<void> } = {}) {
  const adapters = opts.adapters ?? [true, true, true, true, true];
  let n = 0;
  const devices: { lose: (reason: GPUDeviceLostReason) => void; destroyed: boolean }[] = [];
  const requestAdapter = vi.fn(async () => {
    const i = n++;
    // every request after the first waits for `later`, if given
    if (i > 0 && opts.later) await opts.later;
    const ok = adapters[i] ?? false;
    if (!ok) return null;
    const limits = {
      maxTextureArrayLayers: 2048,
      maxStorageBufferBindingSize: 4 * 1024 ** 3,
      maxBufferSize: 256 * 1024 ** 2,
    };
    const adapter = {
      limits,
      features: new Set<string>(),
      requestDevice: vi.fn(() => {
        let lose: (info: GPUDeviceLostInfo) => void = () => undefined;
        const lost = new Promise<GPUDeviceLostInfo>((r) => (lose = r));
        const d = {
          destroyed: false,
          lose: (reason: GPUDeviceLostReason) => {
            lose({ reason, message: 'test' } as GPUDeviceLostInfo);
          },
        };
        devices.push(d);
        return Promise.resolve({
          lost,
          limits,
          addEventListener: () => undefined,
          destroy: () => {
            d.destroyed = true;
            d.lose('destroyed');
          },
        });
      }),
    };
    return adapter;
  });
  const nav = { gpu: { requestAdapter } } as unknown as GpuNavigator;
  return { nav, devices, requestAdapter };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('detectBackend', () => {
  it('falls back to the CPU without navigator.gpu', async () => {
    expect(await detectBackend({})).toBe('cpu');
  });
  it('falls back to the CPU without an adapter', async () => {
    expect(await detectBackend(fakeNavigator({ adapters: [false] }).nav)).toBe('cpu');
  });
  it('uses WebGPU with an adapter', async () => {
    expect(await detectBackend(fakeNavigator().nav)).toBe('webgpu');
  });
  it('honours a forced backend', async () => {
    expect(await detectBackend(fakeNavigator().nav, 'cpu')).toBe('cpu');
  });
  it('treats a throwing requestAdapter as no WebGPU', async () => {
    const nav = {
      gpu: { requestAdapter: () => Promise.reject(new Error('x')) },
    } as unknown as GpuNavigator;
    expect(await detectBackend(nav)).toBe('cpu');
  });
});

describe('Gpu', () => {
  it('requests the adapter limits it needs, capped', () => {
    const l = requiredLimits({
      limits: {
        maxTextureArrayLayers: 2048,
        maxStorageBufferBindingSize: 4 * 1024 ** 3,
        maxBufferSize: 1024,
      } as GPUSupportedLimits,
    });
    expect(l).toEqual({
      maxTextureArrayLayers: 2048,
      maxStorageBufferBindingSize: 1024 ** 3,
      maxBufferSize: 1024,
    });
  });

  it('recreates the device after a loss and tells listeners', async () => {
    const f = fakeNavigator();
    const gpu = await Gpu.create(f.nav, 3, 0);
    const first = gpu.device;
    const seen: GPUDevice[] = [];
    gpu.onDevice((d) => seen.push(d));
    f.devices[0]?.lose('unknown');
    await tick();
    await tick();
    expect(seen).toHaveLength(1);
    expect(gpu.device).not.toBe(first);
    expect(seen[0]).toBe(gpu.device);
  });

  it('does not recreate after its own destroy()', async () => {
    const f = fakeNavigator();
    const gpu = await Gpu.create(f.nav, 3, 0);
    const seen = vi.fn();
    gpu.onDevice(seen);
    gpu.destroy();
    await tick();
    expect(seen).not.toHaveBeenCalled();
    expect(f.requestAdapter).toHaveBeenCalledTimes(1);
  });

  it('reports failure when no new device can be had', async () => {
    const f = fakeNavigator({ adapters: [true, false, false, false] });
    const gpu = await Gpu.create(f.nav, 3, 0);
    const failed = vi.fn();
    gpu.onFailure(failed);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    f.devices[0]?.lose('unknown');
    for (let i = 0; i < 10; i++) await tick();
    expect(failed).toHaveBeenCalledTimes(1);
    expect(f.requestAdapter).toHaveBeenCalledTimes(4);
  });

  it('budgets recoveries in a row, reset by markHealthy()', async () => {
    const f = fakeNavigator({ adapters: Array<boolean>(10).fill(true) });
    const gpu = await Gpu.create(f.nav, 2, 0);
    const failed = vi.fn();
    gpu.onFailure(failed);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const settle = async () => {
      for (let i = 0; i < 10; i++) await tick();
    };
    for (let k = 0; k < 4; k++) {
      f.devices.at(-1)?.lose('unknown');
      await settle();
      gpu.markHealthy();
    }
    expect(failed).not.toHaveBeenCalled();
    expect(f.devices).toHaveLength(5);
    // without markHealthy, the third loss in a row gives up
    for (let k = 0; k < 3; k++) {
      f.devices.at(-1)?.lose('unknown');
      await settle();
    }
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it('destroys a new device when rebuilding on it fails, and tries again', async () => {
    const f = fakeNavigator();
    const gpu = await Gpu.create(f.nav, 3, 0);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let calls = 0;
    gpu.onDevice(() => {
      if (calls++ === 0) throw new Error('rebuild failed');
    });
    f.devices[0]?.lose('unknown');
    for (let i = 0; i < 10; i++) await tick();
    expect(calls).toBe(2);
    expect(f.devices[1]?.destroyed).toBe(true);
    expect(f.devices[2]?.destroyed).toBe(false);
  });

  it('destroys a device that arrives after destroy()', async () => {
    let release: () => void = () => undefined;
    const later = new Promise<void>((r) => (release = r));
    const f = fakeNavigator({ later });
    const gpu = await Gpu.create(f.nav, 3, 0);
    const seen = vi.fn();
    gpu.onDevice(seen);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    f.devices[0]?.lose('unknown');
    await tick();
    gpu.destroy(); // while the new device is being requested
    release();
    for (let i = 0; i < 10; i++) await tick();
    expect(seen).not.toHaveBeenCalled();
    expect(f.devices).toHaveLength(2);
    expect(f.devices.every((d) => d.destroyed)).toBe(true);
  });

  it('recovers from a destroy() it did not make itself', async () => {
    const f = fakeNavigator();
    const gpu = await Gpu.create(f.nav, 3, 0);
    const seen = vi.fn();
    gpu.onDevice(seen);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    f.devices[0]?.lose('destroyed'); // as an external device.destroy() reports it
    for (let i = 0; i < 10; i++) await tick();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(gpu.device).toBe(seen.mock.calls[0]?.[0]);
  });

  it('survives a failure listener that throws', async () => {
    const f = fakeNavigator({ adapters: [true, false] });
    const gpu = await Gpu.create(f.nav, 1, 0);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const second = vi.fn();
    gpu.onFailure(() => {
      throw new Error('listener');
    });
    gpu.onFailure(second);
    f.devices[0]?.lose('unknown');
    for (let i = 0; i < 10; i++) await tick();
    expect(second).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalled();
  });
});
