/**
 * Buffer pooling and upload reuse (M10, ADR 0070).
 *
 * Two small helpers keep a model-tier rebuild from creating the same buffers again:
 *
 * - `BufferPool`: scratch buffers (the samples, the projected instances, the scan's work buffers,
 *   a readback's staging buffer). `release` keeps a buffer for the next `acquire` of its size
 *   class instead of destroying it. A buffer a compute pass reads before it writes must read as
 *   zero, as a new buffer does, so a reused buffer is cleared (`zero`, the default) with
 *   `clearBuffer` submitted at once, so the queue's order puts it ahead of any later use.
 * - `UploadCache`: immutable uploads (the galaxy's shape, pools, dot sizes and noise field, the
 *   pen tables), content-addressed, so the same bytes are uploaded once however many times a
 *   model tier is rebuilt. A hit is checked byte for byte, so the cache can never serve other
 *   data.
 *
 * Neither changes what any kernel computes: sizes are rounded up to a size class, which only
 * changes how large a buffer is, and no shader asks a binding for its length (no `arrayLength`).
 * A shader that does must bind the exact size, or take its count from a uniform.
 */

/** The size class of `bytes`: 2^k × {1, 1.25, 1.5, 1.75}, at least 256 bytes. */
export function sizeClass(bytes: number): number {
  const n = Math.max(256, Math.ceil(bytes / 4) * 4);
  const k = Math.floor(Math.log2(n));
  const base = 2 ** k;
  if (n === base) return base;
  const step = base / 4;
  return base + Math.ceil((n - base) / step) * step;
}

export interface PoolStats {
  /** buffers made with createBuffer */
  created: number;
  /** acquires served from the free lists */
  reused: number;
  /** buffers kept for reuse, now */
  idle: number;
  idleBytes: number;
  /** buffers handed out and not yet released */
  live: number;
  liveBytes: number;
}

interface Entry {
  key: string;
  size: number;
}

export class BufferPool {
  private readonly free = new Map<string, GPUBuffer[]>();
  /** idle buffers, oldest first, for trimming */
  private readonly idleOrder: GPUBuffer[] = [];
  private readonly entries = new WeakMap<GPUBuffer, Entry>();
  private readonly out = new Set<GPUBuffer>();
  private created = 0;
  private reused = 0;
  private idleBytes = 0;
  private liveBytes = 0;

  /**
   * @param retainBytes how many bytes of idle buffers to keep; the oldest are destroyed beyond it
   * @param maxBinding the largest storage binding the device allows: a size class beyond it is not
   *   used (the exact size is)
   */
  constructor(
    private readonly device: GPUDevice,
    private readonly retainBytes = 256 * 1024 * 1024,
    private readonly maxBinding = device.limits.maxStorageBufferBindingSize,
  ) {}

  /**
   * A buffer of at least `size` bytes with `usage` (plus COPY_DST), zeroed unless `zero` is false.
   * `exact` skips the size class.
   */
  acquire(
    size: number,
    usage: GPUBufferUsageFlags,
    label: string,
    opts: { zero?: boolean; exact?: boolean } = {},
  ): GPUBuffer {
    const use = usage | GPUBufferUsage.COPY_DST;
    const want = Math.max(4, Math.ceil(size / 4) * 4);
    const cls = opts.exact ? want : sizeClass(want);
    const bytes = cls > this.maxBinding && want <= this.maxBinding ? want : cls;
    const key = `${String(use)}:${String(bytes)}`;
    const list = this.free.get(key);
    let buffer = list?.pop();
    if (buffer) {
      this.idleOrder.splice(this.idleOrder.indexOf(buffer), 1);
      this.idleBytes -= bytes;
      this.reused++;
      buffer.label = label;
      if (opts.zero ?? true) this.clear(buffer);
    } else {
      buffer = this.device.createBuffer({ label, size: bytes, usage: use });
      this.entries.set(buffer, { key, size: bytes });
      this.created++;
    }
    this.out.add(buffer);
    this.liveBytes += bytes;
    return buffer;
  }

  /** Zeroes a reused buffer: in the queue's order, so before any later write or dispatch. */
  private clear(buffer: GPUBuffer): void {
    const enc = this.device.createCommandEncoder({ label: 'pool clear' });
    enc.clearBuffer(buffer);
    this.device.queue.submit([enc.finish()]);
  }

  /** Hands a buffer back. A buffer this pool did not make is destroyed. */
  release(buffer: GPUBuffer): void {
    const e = this.entries.get(buffer);
    if (!e || !this.out.delete(buffer)) {
      if (!e) buffer.destroy();
      return;
    }
    this.liveBytes -= e.size;
    const list = this.free.get(e.key) ?? [];
    list.push(buffer);
    this.free.set(e.key, list);
    this.idleOrder.push(buffer);
    this.idleBytes += e.size;
    this.trim();
  }

  /** Destroys the oldest idle buffers beyond the retained bytes. */
  trim(limit = this.retainBytes): void {
    while (this.idleBytes > limit) {
      const b = this.idleOrder.shift();
      if (!b) break;
      const e = this.entries.get(b);
      if (!e) continue;
      const list = this.free.get(e.key);
      list?.splice(list.indexOf(b), 1);
      this.idleBytes -= e.size;
      b.destroy();
    }
  }

  get stats(): PoolStats {
    return {
      created: this.created,
      reused: this.reused,
      idle: this.idleOrder.length,
      idleBytes: this.idleBytes,
      live: this.out.size,
      liveBytes: this.liveBytes,
    };
  }

  /** Destroys every buffer, idle or handed out. */
  destroy(): void {
    this.trim(-1);
    for (const b of this.out) b.destroy();
    this.out.clear();
    this.liveBytes = 0;
  }
}

interface Cached {
  buffer: GPUBuffer;
  /** the bytes the buffer holds, kept to check a hit exactly */
  bytes: Uint8Array;
  refs: number;
  bytesSize: number;
}

/** Two 32-bit FNV-1a style hashes over the words of `bytes` (4-byte padded), and its length. */
function contentKey(bytes: Uint8Array): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ bytes.length;
  const words = bytes.length >> 2;
  const w =
    bytes.byteOffset % 4 === 0
      ? new Uint32Array(bytes.buffer, bytes.byteOffset, words)
      : new Uint32Array(bytes.slice(0, words * 4).buffer);
  for (let i = 0; i < words; i++) {
    const x = w[i] ?? 0;
    h1 = Math.imul(h1 ^ x, 0x01000193) >>> 0;
    h2 = Math.imul((h2 + x) | 0, 0x85ebca6b) ^ (h2 >>> 13);
    h2 >>>= 0;
  }
  for (let i = words * 4; i < bytes.length; i++)
    h1 = Math.imul(h1 ^ (bytes[i] ?? 0), 0x01000193) >>> 0;
  return `${String(bytes.length)}:${h1.toString(16)}:${h2.toString(16)}`;
}

export class UploadCache {
  private readonly byKey = new Map<string, Cached>();
  private readonly byBuffer = new WeakMap<GPUBuffer, { key: string; entry: Cached }>();
  private idleBytes = 0;
  hits = 0;
  misses = 0;

  /**
   * @param retainBytes idle (unreferenced) uploads kept for a later hit, in bytes
   * @param maxEntryBytes uploads larger than this are not cached (the copy kept to verify a hit
   *   would cost more than the upload)
   */
  constructor(
    private readonly device: GPUDevice,
    private readonly retainBytes = 16 * 1024 * 1024,
    private readonly maxEntryBytes = 1024 * 1024,
  ) {}

  /** A buffer holding `data`, padded to 4 bytes; the same buffer for the same bytes and usage. */
  upload(
    data: ArrayBuffer | ArrayBufferView<ArrayBuffer>,
    usage: GPUBufferUsageFlags,
    label: string,
  ): GPUBuffer {
    const bytes =
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const size = Math.max(4, Math.ceil(bytes.byteLength / 4) * 4);
    const make = () => {
      const buffer = this.device.createBuffer({ label, size, usage, mappedAtCreation: true });
      new Uint8Array(buffer.getMappedRange()).set(bytes);
      buffer.unmap();
      return buffer;
    };
    if (bytes.byteLength > this.maxEntryBytes) {
      this.misses++;
      return make();
    }
    const key = `${String(usage)}|${contentKey(bytes)}`;
    const hit = this.byKey.get(key);
    if (hit && hit.bytes.length === bytes.length && hit.bytes.every((v, i) => v === bytes[i])) {
      this.hits++;
      if (hit.refs === 0) this.idleBytes -= hit.bytesSize;
      hit.refs++;
      return hit.buffer;
    }
    this.misses++;
    if (hit && hit.refs === 0) {
      this.idleBytes -= hit.bytesSize;
      hit.buffer.destroy();
    }
    const buffer = make();
    // a colliding key with other bytes is replaced: its buffer, if referenced, lives on until released
    const entry: Cached = { buffer, bytes: bytes.slice(), refs: 1, bytesSize: size };
    this.byKey.set(key, entry);
    this.byBuffer.set(buffer, { key, entry });
    return buffer;
  }

  /** One reference less; an unreferenced upload stays for a later hit, within the retained bytes. */
  release(buffer: GPUBuffer): void {
    const rec = this.byBuffer.get(buffer);
    if (!rec) {
      buffer.destroy();
      return;
    }
    const { entry, key } = rec;
    entry.refs--;
    if (entry.refs > 0) return;
    if (this.byKey.get(key) !== entry) {
      entry.buffer.destroy();
      return;
    }
    this.idleBytes += entry.bytesSize;
    // evict the oldest idle uploads (Map order is insertion order)
    for (const [k, e] of this.byKey) {
      if (this.idleBytes <= this.retainBytes) break;
      if (e.refs > 0) continue;
      this.byKey.delete(k);
      this.idleBytes -= e.bytesSize;
      e.buffer.destroy();
    }
  }

  /** Destroys everything, referenced or not. */
  destroy(): void {
    for (const e of this.byKey.values()) e.buffer.destroy();
    this.byKey.clear();
    this.idleBytes = 0;
  }
}

/**
 * What a renderer's model tier draws its buffers from: scratch from the pool, uploads from the
 * cache. `release` takes either back.
 */
export class GpuResources {
  readonly pool: BufferPool;
  readonly uploads: UploadCache;
  private readonly uploaded = new WeakSet<GPUBuffer>();

  constructor(readonly device: GPUDevice) {
    this.pool = new BufferPool(device);
    this.uploads = new UploadCache(device);
  }

  /** A zeroed scratch buffer of at least `bytes` (at least 16). */
  scratch(bytes: number, usage: GPUBufferUsageFlags, label: string): GPUBuffer {
    return this.pool.acquire(Math.max(16, bytes), usage, label);
  }

  /** An immutable upload of `data`, shared with every other upload of the same bytes. */
  data(
    data: ArrayBuffer | ArrayBufferView<ArrayBuffer>,
    usage: GPUBufferUsageFlags,
    label: string,
  ): GPUBuffer {
    const b = this.uploads.upload(data, usage, label);
    this.uploaded.add(b);
    return b;
  }

  /**
   * A scratch buffer that starts as `data` and is then written by the GPU (a counter, draw
   * arguments): never shared, so a kernel's writes cannot reach another model's buffer.
   */
  init(data: ArrayBufferView<ArrayBuffer>, usage: GPUBufferUsageFlags, label: string): GPUBuffer {
    const b = this.scratch(data.byteLength, usage, label);
    this.device.queue.writeBuffer(b, 0, data);
    return b;
  }

  release(buffer: GPUBuffer): void {
    if (this.uploaded.has(buffer)) this.uploads.release(buffer);
    else this.pool.release(buffer);
  }

  destroy(): void {
    this.pool.destroy();
    this.uploads.destroy();
  }
}
