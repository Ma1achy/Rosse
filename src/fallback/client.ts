/**
 * The page's side of the CPU engine's worker (ADR 0071): `CpuBackend` is what the page's CPU
 * engine calls, implemented by a worker (`WorkerCpu`) or, where a worker cannot be made or
 * `?cpuworker=off` is given, in the page's own thread (`LocalCpu`).
 */
import type { Params } from '../core/params';
import type { AtlasData, ImageData8 } from '../marks/atlas';
import type { Plates } from '../render/plates';
import type { SurfaceName } from '../render/surface';
import type { DrawingsMeta } from '../model/variation';
import { CpuEngineCore, type CpuDrawn, type CpuFrame, type CpuSize } from './core';
import type { CpuReply, CpuRequest } from './protocol';

export interface CpuBackend {
  readonly where: 'worker' | 'main thread';
  draw(P: Params, zoom: number): Promise<CpuDrawn>;
  resize(size: CpuSize): Promise<void>;
  present(surface: SurfaceName, plates: Plates): Promise<CpuFrame>;
  destroy(): void;
}

export class LocalCpu implements CpuBackend {
  readonly where = 'main thread';
  private readonly core: CpuEngineCore;

  constructor(atlases: readonly AtlasData[], paper: ImageData8, meta: DrawingsMeta, size: CpuSize) {
    this.core = new CpuEngineCore(atlases, paper, meta, size);
  }

  draw(P: Params, zoom: number) {
    return Promise.resolve(this.core.draw(P, zoom));
  }
  resize(size: CpuSize) {
    this.core.resize(size);
    return Promise.resolve();
  }
  present(surface: SurfaceName, plates: Plates) {
    return Promise.resolve(this.core.present(surface, plates));
  }
  destroy(): void {
    // nothing is held outside the object
  }
}

type Without<T> = T extends unknown ? Omit<T, 'id'> : never;

export class WorkerCpu implements CpuBackend {
  readonly where = 'worker';
  private nextId = 1;
  private readonly waiting = new Map<number, (r: CpuReply) => void>();

  private constructor(private readonly worker: Worker) {
    worker.onmessage = (e: MessageEvent<CpuReply>) => {
      this.waiting.get(e.data.id)?.(e.data);
      this.waiting.delete(e.data.id);
    };
    worker.onerror = (e) => {
      const error = `the CPU worker failed: ${e.message}`;
      this.waiting.forEach((done, id) => {
        done({ id, ok: false, error });
      });
      this.waiting.clear();
    };
  }

  /** Starts the worker; it loads the packed assets from `base` itself. */
  static async create(base: string, size: CpuSize): Promise<WorkerCpu> {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const w = new WorkerCpu(worker);
    await w.request({ op: 'init', base, size });
    return w;
  }

  private request(m: Without<CpuRequest>): Promise<CpuReply & { ok: true }> {
    const id = this.nextId++;
    return new Promise((ok, fail) => {
      this.waiting.set(id, (r) => {
        if (r.ok) ok(r);
        else fail(new Error(r.error));
      });
      this.worker.postMessage({ ...m, id });
    });
  }

  async draw(P: Params, zoom: number) {
    const r = await this.request({ op: 'draw', P, zoom });
    if (r.op !== 'draw') throw new Error('unexpected reply');
    return { counts: r.counts, tiers: r.tiers };
  }
  async resize(size: CpuSize) {
    await this.request({ op: 'resize', size });
  }
  async present(surface: SurfaceName, plates: Plates) {
    const r = await this.request({ op: 'present', surface, plates });
    if (r.op !== 'present') throw new Error('unexpected reply');
    return { pixels: r.pixels, width: r.width, height: r.height };
  }
  destroy(): void {
    this.worker.terminate();
  }
}
