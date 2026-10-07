/**
 * The WebGPU profiling page (M10), driven by tools/perf/perf.mjs through `window.__perf`.
 *
 * For each scenario (a preset with overrides, at a seed) it measures, on whatever adapter the
 * browser was started with:
 *
 * - the model tier: a parameter change to the first frame on screen, split into the CPU scene
 *   description (`buildScene`), the model tier's upload and dispatch (`GpuStipple.setScene`, the
 *   part that is on the CPU), and the rest up to the queue's completion; the median over `modelRuns`
 *   seeds;
 * - the orbit: `orbitFrames` camera moves through `GpuStipple.frame` (the path the page uses),
 *   `GpuRenderer.setLayers`, `drawInk` and `present`, each awaited (wall clock, latency), the CPU
 *   side of the frame alone (JS time to submit), a pipelined run (frames submitted back to back, one
 *   wait at the end), and, when the adapter has `timestamp-query`, the GPU time of the passes;
 * - what the frames allocate: `createBuffer`, `createBindGroup`, `createTexture` and
 *   `queue.writeBuffer` calls and bytes per frame, and the buffer and texture bytes alive.
 *
 * Every number is labelled with the adapter by the caller. On SwiftShader the "GPU" is a software
 * rasteriser on CPU cores of a shared machine, so its numbers show relative costs and call counts,
 * not what a GPU would take (docs/milestones/m10/README.md).
 */
import type { Params } from '../../src/core/params';
import { presetParams } from '../../src/core/presets';
import { requestDevice } from '../../src/gpu/device';
import { GpuProfiler } from '../../src/gpu/profile';
import { BuiltAssets, type AtlasName } from '../../src/marks/atlas';
import { VECTOR_ATLASES, type VectorLibrary } from '../../src/marks/vector';
import { buildScene, drawingsMeta, type MarkCounts } from '../../src/model/scene';
import { GpuRenderer } from '../../src/render/frame';
import { GpuStipple } from '../../src/render/stipple';
import { SURFACES } from '../../src/render/surface';
import { cameraOf } from '../../src/view/camera';

export interface Scenario {
  name: string;
  preset: string;
  overrides?: Partial<Params>;
  seed?: number;
}

export interface PerfConfig {
  scenarios: Scenario[];
  /** camera moves measured per scenario */
  orbitFrames: number;
  /** model-tier runs (a new seed each) measured per scenario */
  modelRuns: number;
  plateCss: number;
  dpr: number;
}

export interface Stat {
  median: number;
  p95: number;
  min: number;
  max: number;
  n: number;
}

export interface Alloc {
  createBuffer: number;
  createBindGroup: number;
  createTexture: number;
  writeBuffer: number;
  /** bytes of the buffers created and of the data written with writeBuffer */
  bufferBytes: number;
  writeBytes: number;
}

export interface ScenarioResult {
  name: string;
  preset: string;
  counts: MarkCounts | null;
  model: {
    /** buildScene on the CPU */
    sceneMs: Stat;
    /** GpuStipple.setScene: buffer creation, upload and the dispatch, JS side */
    uploadMs: Stat;
    /** a new seed to the frame on screen, queue complete (wall clock) */
    firstFrameMs: Stat;
    /** the model passes' GPU time, when the adapter has timestamp-query */
    gpuMs: Stat | null;
    alloc: Alloc;
  };
  orbit: {
    /** one move, awaited */
    latencyMs: Stat;
    /** JS time to record and submit one move, without waiting */
    cpuSideMs: Stat;
    /** frames submitted back to back, one wait: mean per frame */
    pipelinedMs: number;
    /** view + ink + composite on the GPU, timestamp-query */
    gpuMs: Stat | null;
    gpuByPass: Record<string, number> | null;
    /** per frame */
    alloc: Alloc;
    /** the model tier did not run during the orbit */
    modelRuns: number;
  };
  /** buffers and textures alive after the last frame, bytes */
  memory: { buffers: number; textures: number; ink: number };
}

declare global {
  interface Window {
    __perf?: {
      adapter: { description: string; vendor: string; architecture: string; device: string };
      features: string[];
      timestamps: boolean;
      run(config: PerfConfig): Promise<ScenarioResult[]>;
    };
    __perfError?: string;
  }
}

function stat(xs: number[]): Stat {
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number) =>
    s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))] ?? 0;
  return { median: at(0.5), p95: at(0.95), min: s[0] ?? 0, max: s[s.length - 1] ?? 0, n: s.length };
}

const TEXEL_BYTES: Record<string, number> = {
  r8unorm: 1,
  rgba8unorm: 4,
  'rgba8unorm-srgb': 4,
  rgba16float: 8,
  rgba32float: 16,
};

/** Counts the resources a device creates; wraps the methods of this device only. */
class Meter {
  alloc: Alloc = emptyAlloc();
  liveBuffers = 0;
  liveTextures = 0;

  constructor(device: GPUDevice) {
    const createBuffer = device.createBuffer.bind(device);
    device.createBuffer = (d) => {
      const b = createBuffer(d);
      this.alloc.createBuffer++;
      this.alloc.bufferBytes += d.size;
      this.liveBuffers += d.size;
      const destroy = b.destroy.bind(b);
      let gone = false;
      b.destroy = () => {
        if (!gone) this.liveBuffers -= d.size;
        gone = true;
        destroy();
      };
      return b;
    };
    const createTexture = device.createTexture.bind(device);
    device.createTexture = (d) => {
      const t = createTexture(d);
      this.alloc.createTexture++;
      const size = Array.isArray(d.size)
        ? d.size
        : [
            (d.size as GPUExtent3DDict).width,
            (d.size as GPUExtent3DDict).height ?? 1,
            (d.size as GPUExtent3DDict).depthOrArrayLayers ?? 1,
          ];
      const mips = d.mipLevelCount ?? 1;
      let texels = 0;
      for (let m = 0; m < mips; m++)
        texels +=
          Math.max(1, (size[0] ?? 1) >> m) * Math.max(1, (size[1] ?? 1) >> m) * (size[2] ?? 1);
      const bytes = texels * (TEXEL_BYTES[d.format] ?? 4);
      this.liveTextures += bytes;
      const destroy = t.destroy.bind(t);
      let gone = false;
      t.destroy = () => {
        if (!gone) this.liveTextures -= bytes;
        gone = true;
        destroy();
      };
      return t;
    };
    const createBindGroup = device.createBindGroup.bind(device);
    device.createBindGroup = (d) => {
      this.alloc.createBindGroup++;
      return createBindGroup(d);
    };
    const writeBuffer = device.queue.writeBuffer.bind(device.queue);
    device.queue.writeBuffer = (buffer, offset, data, ...rest) => {
      this.alloc.writeBuffer++;
      this.alloc.writeBytes += data.byteLength;
      writeBuffer(buffer, offset, data, ...(rest as []));
    };
  }

  /** The counts since the last call. */
  take(): Alloc {
    const a = this.alloc;
    this.alloc = emptyAlloc();
    return a;
  }
}

function emptyAlloc(): Alloc {
  return {
    createBuffer: 0,
    createBindGroup: 0,
    createTexture: 0,
    writeBuffer: 0,
    bufferBytes: 0,
    writeBytes: 0,
  };
}

function perFrame(a: Alloc, n: number): Alloc {
  const r = (x: number) => Math.round((x / n) * 10) / 10;
  return {
    createBuffer: r(a.createBuffer),
    createBindGroup: r(a.createBindGroup),
    createTexture: r(a.createTexture),
    writeBuffer: r(a.writeBuffer),
    bufferBytes: Math.round(a.bufferBytes / n),
    writeBytes: Math.round(a.writeBytes / n),
  };
}

async function main(): Promise<void> {
  const { adapter, device } = await requestDevice(navigator);
  device.addEventListener('uncapturederror', (e) => {
    console.error('WebGPU error:', e.error.message);
  });
  const meter = new Meter(device);
  const assets = await BuiltAssets.load('/');
  const names: AtlasName[] = ['dots', 'knots', 'stars', 'cores', 'pieces', 'strokes'];
  const [atlases, paper, sheets] = await Promise.all([
    Promise.all(names.map((n) => assets.atlas(n))),
    assets.paper(),
    Promise.all(VECTOR_ATLASES.map((n) => assets.vector(n))),
  ]);
  const vectors = Object.fromEntries(VECTOR_ATLASES.map((n, i) => [n, sheets[i]])) as VectorLibrary;
  const by = (n: string) => {
    const a = atlases.find((x) => x.name === n);
    if (!a) throw new Error(`atlas ${n} missing`);
    return a;
  };
  const meta = drawingsMeta(
    {
      dots: by('dots'),
      knots: by('knots'),
      stars: by('stars'),
      cores: by('cores'),
      strokes: by('strokes'),
    },
    vectors.penlines,
    vectors,
  );
  const profiler = GpuProfiler.create(device);
  const info = adapter.info;

  window.__perf = {
    adapter: {
      description: info.description,
      vendor: info.vendor,
      architecture: info.architecture,
      device: info.device,
    },
    features: [...adapter.features],
    timestamps: profiler !== null,
    async run(config) {
      const results: ScenarioResult[] = [];
      const format: GPUTextureFormat = 'rgba8unorm';
      for (const sc of config.scenarios) {
        const renderer = new GpuRenderer(
          device,
          { plateCss: config.plateCss, dpr: config.dpr },
          paper,
        );
        const out = device.createTexture({
          size: [renderer.width, renderer.height],
          format,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        });
        const outView = out.createView();
        for (const a of atlases) renderer.addAtlas(a);
        const stipple = GpuStipple.create(device);
        if (profiler) {
          stipple.profiler = profiler;
          renderer.profiler = profiler;
        }
        const seed0 = sc.seed ?? 7;
        const params = (seed: number) => presetParams(sc.preset, seed, sc.overrides ?? {});
        const wait = () => device.queue.onSubmittedWorkDone();
        const surface = SURFACES.paper;

        // warm up: pipelines, the first atlas upload, shader compilation
        {
          const P = params(seed0);
          stipple.frame(P, 1, meta);
          renderer.setLayers(stipple.inkLayers());
          renderer.drawInk();
          renderer.present(outView, format, surface);
          await wait();
        }

        // 1. the model tier: a new seed is a new model
        const sceneMs: number[] = [];
        const uploadMs: number[] = [];
        const firstMs: number[] = [];
        const modelGpu: number[] = [];
        meter.take();
        for (let k = 0; k < config.modelRuns; k++) {
          const P = params(seed0 + 1 + k);
          profiler?.reset();
          const t0 = performance.now();
          const scene = buildScene(P, meta, {});
          const t1 = performance.now();
          stipple.setScene(scene);
          const t2 = performance.now();
          stipple.setView(cameraOf(P, 1));
          renderer.setLayers(stipple.inkLayers());
          renderer.drawInk();
          renderer.present(outView, format, surface);
          await wait();
          const t3 = performance.now();
          sceneMs.push(t1 - t0);
          uploadMs.push(t2 - t1);
          firstMs.push(t3 - t0);
          if (profiler) {
            const t = await profiler.collect();
            modelGpu.push(t.totalMs);
          }
        }
        const modelAlloc = perFrame(meter.take(), config.modelRuns);

        // 2. the orbit, on the last model
        const P0 = params(seed0);
        stipple.frame(P0, 1, meta);
        renderer.setLayers(stipple.inkLayers());
        renderer.drawInk();
        renderer.present(outView, format, surface);
        await wait();
        const modelRunsBefore = stipple.tiers.runs.model;
        const step = (k: number): Params => ({ ...P0, az: (P0.az + 3 * (k + 1)) % 360 });
        const frame = (k: number) => {
          const P = step(k);
          stipple.frame(P, 1, meta);
          renderer.setLayers(stipple.inkLayers());
          renderer.drawInk();
          renderer.present(outView, format, surface);
        };
        const latency: number[] = [];
        const cpuSide: number[] = [];
        const gpu: number[] = [];
        const byPass: Record<string, number[]> = {};
        meter.take();
        for (let k = 0; k < config.orbitFrames; k++) {
          profiler?.reset();
          const t0 = performance.now();
          frame(k);
          cpuSide.push(performance.now() - t0);
          await wait();
          latency.push(performance.now() - t0);
          if (profiler) {
            const t = await profiler.collect();
            gpu.push(t.totalMs);
            for (const [label, ms] of Object.entries(t.byLabel)) (byPass[label] ??= []).push(ms);
          }
        }
        const orbitAlloc = perFrame(meter.take(), config.orbitFrames);
        // pipelined: frames back to back, one wait
        const n = Math.min(10, Math.max(3, config.orbitFrames));
        const tp = performance.now();
        for (let k = 0; k < n; k++) frame(config.orbitFrames + k);
        await wait();
        const pipelinedMs = (performance.now() - tp) / n;

        const last = await stipple.readCounts().catch(() => null);
        results.push({
          name: sc.name,
          preset: sc.preset,
          counts: last?.counts ?? null,
          model: {
            sceneMs: stat(sceneMs),
            uploadMs: stat(uploadMs),
            firstFrameMs: stat(firstMs),
            gpuMs: modelGpu.length ? stat(modelGpu) : null,
            alloc: modelAlloc,
          },
          orbit: {
            latencyMs: stat(latency),
            cpuSideMs: stat(cpuSide),
            pipelinedMs,
            gpuMs: gpu.length ? stat(gpu) : null,
            gpuByPass: gpu.length
              ? Object.fromEntries(Object.entries(byPass).map(([k, v]) => [k, stat(v).median]))
              : null,
            alloc: orbitAlloc,
            modelRuns: stipple.tiers.runs.model - modelRunsBefore,
          },
          memory: {
            buffers: meter.liveBuffers,
            textures: meter.liveTextures,
            ink: renderer.width * renderer.height * 8,
          },
        });
        stipple.destroy();
        renderer.destroy();
        out.destroy();
      }
      return results;
    },
  };
}

main().catch((e: unknown) => {
  window.__perfError = String(e instanceof Error ? (e.stack ?? e) : e);
});
