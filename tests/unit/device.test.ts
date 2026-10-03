import { describe, expect, it, vi } from 'vitest';
import { Gpu, detectBackend, requiredLimits, type GpuNavigator } from '../../src/gpu/device';

/** A fake adapter and device, enough for device.ts. */
function fakeNavigator(opts: { adapters?: boolean[] } = {}) {
  const adapters = opts.adapters ?? [true, true, true, true, true];
  let n = 0;
  const devices: { lose: (reason: GPUDeviceLostReason) => void; destroyed: boolean }[] = [];
  const requestAdapter = vi.fn(() => {
    const ok = adapters[n++] ?? false;
    if (!ok) return Promise.resolve(null);
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
    return Promise.resolve(adapter);
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
    const gpu = await Gpu.create(f.nav);
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
    const gpu = await Gpu.create(f.nav);
    const seen = vi.fn();
    gpu.onDevice(seen);
    gpu.destroy();
    await tick();
    expect(seen).not.toHaveBeenCalled();
    expect(f.requestAdapter).toHaveBeenCalledTimes(1);
  });

  it('reports failure when no new device can be had', async () => {
    const f = fakeNavigator({ adapters: [true, false, false, false] });
    const gpu = await Gpu.create(f.nav, 3);
    const failed = vi.fn();
    gpu.onFailure(failed);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    f.devices[0]?.lose('unknown');
    for (let i = 0; i < 10; i++) await tick();
    expect(failed).toHaveBeenCalledTimes(1);
    expect(f.requestAdapter).toHaveBeenCalledTimes(4);
  });
});
