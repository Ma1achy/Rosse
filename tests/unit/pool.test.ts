import { beforeAll, describe, expect, it } from 'vitest';
import { BufferPool, GpuResources, UploadCache, sizeClass } from '../../src/gpu/pool';

// the buffer usage flags the pool reads; Node has no WebGPU
beforeAll(() => {
  Object.assign(globalThis, {
    GPUBufferUsage: {
      MAP_READ: 1,
      COPY_SRC: 4,
      COPY_DST: 8,
      UNIFORM: 64,
      STORAGE: 128,
      INDIRECT: 256,
    },
  });
});

class FakeBuffer {
  destroyed = false;
  label = '';
  data: Uint8Array;
  constructor(
    readonly size: number,
    readonly usage: number,
    mapped: boolean,
  ) {
    this.data = new Uint8Array(size);
    this.mapped = mapped;
  }
  mapped: boolean;
  getMappedRange() {
    return this.data.buffer;
  }
  unmap() {
    this.mapped = false;
  }
  destroy() {
    this.destroyed = true;
  }
}

/** A device that records what the pool asks of it. */
function fakeDevice() {
  const created: FakeBuffer[] = [];
  const submits: string[][] = [];
  const device = {
    limits: { maxStorageBufferBindingSize: 1 << 20 },
    createBuffer(d: { size: number; usage: number; label?: string; mappedAtCreation?: boolean }) {
      const b = new FakeBuffer(d.size, d.usage, !!d.mappedAtCreation);
      b.label = d.label ?? '';
      created.push(b);
      return b;
    },
    createCommandEncoder() {
      const ops: string[] = [];
      return {
        clearBuffer(b: FakeBuffer) {
          b.data.fill(0);
          ops.push(`clear ${b.label}`);
        },
        finish() {
          return ops;
        },
      };
    },
    queue: {
      submit(list: string[][]) {
        submits.push(...list);
      },
      writeBuffer(b: FakeBuffer, _o: number, d: Uint8Array) {
        b.data.set(d);
      },
    },
  };
  return { device: device as unknown as GPUDevice, created, submits };
}

describe('sizeClass', () => {
  it('rounds up to a quarter-octave step, at least 256 bytes', () => {
    expect(sizeClass(1)).toBe(256);
    expect(sizeClass(256)).toBe(256);
    expect(sizeClass(257)).toBe(320);
    expect(sizeClass(1000)).toBe(1024);
    expect(sizeClass(1025)).toBe(1280);
    expect(sizeClass(1 << 20)).toBe(1 << 20);
  });

  it('never rounds down, and by under 25%', () => {
    for (let n = 1; n < 5_000_000; n = Math.ceil(n * 1.07) + 1) {
      const c = sizeClass(n);
      expect(c).toBeGreaterThanOrEqual(Math.ceil(n / 4) * 4);
      if (n > 256) expect(c).toBeLessThanOrEqual(n * 1.25 + 4);
    }
  });
});

describe('BufferPool', () => {
  it('reuses a released buffer of the same class and usage, cleared', () => {
    const { device, created, submits } = fakeDevice();
    const pool = new BufferPool(device);
    const a = pool.acquire(1000, GPUBufferUsage.STORAGE, 'a') as unknown as FakeBuffer;
    a.data.fill(7);
    pool.release(a as unknown as GPUBuffer);
    const b = pool.acquire(900, GPUBufferUsage.STORAGE, 'b') as unknown as FakeBuffer;
    expect(b).toBe(a);
    expect(created).toHaveLength(1);
    expect(b.label).toBe('b');
    // not zero until the pool's clears are recorded, and then it is
    expect(b.data[0]).toBe(7);
    pool.flush();
    expect(b.data.every((x) => x === 0)).toBe(true);
    expect(submits).toEqual([['clear b']]);
    expect(pool.stats).toMatchObject({ created: 1, reused: 1, idle: 0, live: 1 });
  });

  it('does not clear when asked not to, and does not mix usages or classes', () => {
    const { device, created, submits } = fakeDevice();
    const pool = new BufferPool(device);
    const a = pool.acquire(1000, GPUBufferUsage.STORAGE, 'a');
    pool.release(a);
    pool.acquire(1000, GPUBufferUsage.UNIFORM, 'u');
    pool.acquire(5000, GPUBufferUsage.STORAGE, 'big');
    expect(created).toHaveLength(3);
    const again = pool.acquire(1000, GPUBufferUsage.STORAGE, 'a2', { zero: false });
    expect(again).toBe(a);
    pool.flush();
    expect(submits).toHaveLength(0);
  });

  it('drops a pending clear when the buffer is released before the flush', () => {
    const { device, submits } = fakeDevice();
    const pool = new BufferPool(device);
    const a = pool.acquire(64, GPUBufferUsage.STORAGE, 'a');
    pool.release(a);
    const b = pool.acquire(64, GPUBufferUsage.STORAGE, 'b');
    pool.release(b);
    pool.flush();
    expect(submits).toHaveLength(0);
  });

  it('destroys the oldest idle buffers beyond the retained bytes', () => {
    const { device, created } = fakeDevice();
    const pool = new BufferPool(device, 1024);
    const bufs = [0, 1, 2].map((i) => pool.acquire(512, GPUBufferUsage.STORAGE, `b${String(i)}`));
    bufs.forEach((b) => {
      pool.release(b);
    });
    // 3 × 512 idle, 1024 retained: the first released is destroyed
    expect(created.map((b) => b.destroyed)).toEqual([true, false, false]);
    expect(pool.stats.idleBytes).toBe(1024);
  });

  it('uses the exact size when its class would exceed the binding limit', () => {
    const { device } = fakeDevice();
    const pool = new BufferPool(device);
    const limit = 1 << 20;
    const b = pool.acquire(limit - 100, GPUBufferUsage.STORAGE, 'near the limit');
    expect(b.size).toBeLessThanOrEqual(limit);
    expect(b.size).toBeGreaterThanOrEqual(limit - 100);
  });

  it('ignores a double release and destroys a buffer it did not make', () => {
    const { device } = fakeDevice();
    const pool = new BufferPool(device);
    const a = pool.acquire(64, GPUBufferUsage.STORAGE, 'a');
    pool.release(a);
    pool.release(a);
    expect(pool.stats.idle).toBe(1);
    const stranger = new FakeBuffer(8, 0, false);
    pool.release(stranger as unknown as GPUBuffer);
    expect(stranger.destroyed).toBe(true);
  });

  it('destroys everything on destroy', () => {
    const { device, created } = fakeDevice();
    const pool = new BufferPool(device);
    const a = pool.acquire(64, GPUBufferUsage.STORAGE, 'a');
    pool.acquire(64, GPUBufferUsage.UNIFORM, 'b');
    pool.release(a);
    pool.destroy();
    expect(created.every((b) => b.destroyed)).toBe(true);
  });
});

describe('UploadCache', () => {
  it('serves the same buffer for the same bytes and usage, and counts the references', () => {
    const { device, created } = fakeDevice();
    const cache = new UploadCache(device);
    const x = new Float32Array([1, 2, 3, 4]);
    const a = cache.upload(x, GPUBufferUsage.STORAGE, 'x');
    const b = cache.upload(new Float32Array([1, 2, 3, 4]), GPUBufferUsage.STORAGE, 'x again');
    expect(b).toBe(a);
    expect(created).toHaveLength(1);
    expect(cache.hits).toBe(1);
    // other usage or other bytes: another buffer
    const c = cache.upload(x, GPUBufferUsage.UNIFORM, 'x');
    const d = cache.upload(new Float32Array([1, 2, 3, 5]), GPUBufferUsage.STORAGE, 'y');
    expect(new Set([a, c, d]).size).toBe(3);
    // two references: one release keeps it, and a later upload still hits
    cache.release(a);
    expect((a as unknown as FakeBuffer).destroyed).toBe(false);
    cache.release(a);
    expect(cache.upload(x, GPUBufferUsage.STORAGE, 'x')).toBe(a);
  });

  it('holds the bytes uploaded, padded to four', () => {
    const { device } = fakeDevice();
    const cache = new UploadCache(device);
    const b = cache.upload(new Uint8Array([1, 2, 3, 4, 5]), GPUBufferUsage.STORAGE, 'odd');
    expect(b.size).toBe(8);
    expect([...(b as unknown as FakeBuffer).data]).toEqual([1, 2, 3, 4, 5, 0, 0, 0]);
  });

  it('keeps unreferenced uploads within the retained bytes, evicting the oldest', () => {
    const { device } = fakeDevice();
    const cache = new UploadCache(device, 16);
    const bufs = [1, 2, 3].map((i) =>
      cache.upload(new Uint32Array([i, i, i]), GPUBufferUsage.STORAGE, `b${String(i)}`),
    );
    bufs.forEach((b) => {
      cache.release(b);
    });
    // 3 × 12 bytes idle, 16 retained: the first two are gone, the last stays
    expect(bufs.map((b) => (b as unknown as FakeBuffer).destroyed)).toEqual([true, true, false]);
  });

  it('does not cache what is larger than its limit', () => {
    const { device, created } = fakeDevice();
    const cache = new UploadCache(device, 1 << 20, 16);
    const big = new Uint8Array(64);
    const a = cache.upload(big, GPUBufferUsage.STORAGE, 'big');
    const b = cache.upload(big, GPUBufferUsage.STORAGE, 'big');
    expect(a).not.toBe(b);
    expect(created).toHaveLength(2);
    cache.release(a);
    expect((a as unknown as FakeBuffer).destroyed).toBe(true);
  });
});

describe('GpuResources', () => {
  it('routes a release to the pool or the cache, and init survives the clears', () => {
    const { device } = fakeDevice();
    const res = new GpuResources(device);
    const s = res.scratch(100, GPUBufferUsage.STORAGE, 'scratch');
    (s as unknown as FakeBuffer).data.fill(9);
    res.release(s);
    const d = res.data(new Uint32Array([5]), GPUBufferUsage.STORAGE, 'data');
    res.release(d);
    expect(res.pool.stats.idle).toBe(1);
    // a counter the GPU writes: reused scratch, cleared first, then the initial value
    const args = res.init(new Uint32Array([4, 0, 0, 0]), GPUBufferUsage.STORAGE, 'args');
    expect(args).toBe(s);
    const words = new Uint32Array((args as unknown as FakeBuffer).data.buffer);
    expect([...words.slice(0, 4)]).toEqual([4, 0, 0, 0]);
    res.flush();
    // the pool's clear went out before the write, so the write is not wiped
    expect([...new Uint32Array((args as unknown as FakeBuffer).data.buffer).slice(0, 4)]).toEqual([
      4, 0, 0, 0,
    ]);
  });
});
