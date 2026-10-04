/**
 * Entry point of the page (M2): the plate shows the current preset's stipple, on Paper or
 * Chalkboard, with a preset menu and a seed. The full page is M11.
 *
 * Flow (docs/architecture.md, "Frame"): pick the engine (WebGPU, or the CPU engine of ADR 0011
 * when WebGPU is missing, fails, or `?backend=cpu` is given), load the packed drawings, build the
 * scene description on the CPU, run the model and view tiers (compute passes, or their CPU twins),
 * ink the layers, and composite onto the surface. Switching surface re-runs only the composite (the
 * present tier of ADR 0010). The plate is drawn at its CSS width × device pixel ratio (capped at
 * 2, as v21) and redrawn when either changes. If the GPU device is lost it is recreated and
 * everything rebuilt; if that fails, or a frame fails for another reason, the page carries on
 * with the CPU engine.
 *
 * URL parameters: `preset`, `seed`, `variant=stipple` (the M2 golden overrides: no lines, knots,
 * envelope, drawn stars, deep field or foreground stars), `backend=cpu|webgpu`, `present=copy`.
 */
import type { Params } from './core/params';
import { PRESET_NAMES, presetParams } from './core/presets';
import { CpuRenderer } from './fallback';
import { CpuStipple } from './fallback/stipple';
import { Gpu, detectBackend, type Backend } from './gpu/device';
import { readTexture } from './gpu/readback';
import { BuiltAssets, type AtlasData, type AtlasName, type ImageData8 } from './marks/atlas';
import { coreInstances } from './model/parts';
import { buildScene, drawingsMeta, markCounts, type MarkCounts } from './model/scene';
import type { DrawingsMeta } from './model/variation';
import { GpuRenderer, type FrameSize } from './render/frame';
import type { InkLayer } from './render/layers';
import { PLATE } from './view/camera';
import { GpuStipple } from './render/stipple';
import { SURFACES, type SurfaceName } from './render/surface';
import { cameraOf } from './view/camera';

declare global {
  interface Window {
    /** The last frame on the plate: which engine drew it, on which surface, at what size. */
    __rosse?: {
      backend: Backend;
      surface: SurfaceName;
      frames: number;
      size: FrameSize;
      preset: string;
      seed: number;
      counts: MarkCounts | null;
    };
  }
}

const ATLASES: AtlasName[] = ['dots', 'knots', 'stars', 'cores'];
/** v21 caps the device pixel ratio at 2 (app23.js:L1224). */
const MAX_DPR = 2;

/** The M2 golden overrides (tests/golden/extra-cases.json). */
const STIPPLE_ONLY: Partial<Params> = {
  lines: 0,
  knots: 0,
  envelope: 0,
  starMix: 0,
  field: 0,
  fgstars: 0,
};

interface Scene {
  atlases: AtlasData[];
  paper: ImageData8;
  meta: DrawingsMeta;
}

/** The drawn core, a CPU-placed part (model/parts.ts). */
function coreLayer(P: Params, meta: DrawingsMeta): InkLayer[] {
  const cores = coreInstances(P, meta, cameraOf(P));
  return cores.length ? [{ kind: 'sprites', atlas: 'cores', gain: 1, instances: cores }] : [];
}

interface Engine {
  backend: Backend;
  /** the size the engine draws at now */
  size(): FrameSize;
  /** Model and view tiers for these parameters, then the ink. */
  draw(P: Params): void;
  /**
   * The mark counts of the last draw, for the line under the plate. On the GPU this reads the
   * indirect draw arguments back (`mapAsync`), so the page asks for it after presenting, outside
   * the frame queue.
   */
  counts(): Promise<MarkCounts>;
  /** Composites onto the surface and shows it. Rejects if the frame could not be shown. */
  present(surface: SurfaceName): Promise<void>;
  /** A new plate size or DPR: re-inks at that size, keeping the drawings loaded. */
  resize(size: FrameSize): void;
  /**
   * After a failed frame: true when it failed because the device was lost, so recovery will
   * rebuild and show it again (no CPU fallback needed).
   */
  recovering(): Promise<boolean>;
  destroy(): void;
}

function plateCanvas(): HTMLCanvasElement {
  const c = document.getElementById('plate');
  if (!(c instanceof HTMLCanvasElement)) throw new Error('#plate is missing');
  return c;
}

function plateSize(canvas: HTMLCanvasElement): FrameSize {
  return {
    plateCss: canvas.clientWidth || PLATE,
    dpr: Math.min(MAX_DPR, window.devicePixelRatio || 1),
  };
}

const sameSize = (a: FrameSize, b: FrameSize) => a.plateCss === b.plateCss && a.dpr === b.dpr;

/** A canvas keeps its first context type, so switching engine needs a new element. */
function freshCanvas(): HTMLCanvasElement {
  const old = plateCanvas();
  const c = old.cloneNode() as HTMLCanvasElement;
  old.replaceWith(c);
  return c;
}

function cpuEngine(scene: Scene, size: FrameSize): Engine {
  const canvas = freshCanvas();
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2D canvas');
  const r = new CpuRenderer(size, scene.paper);
  scene.atlases.forEach((a) => {
    r.addAtlas(a);
  });
  const ink = () => {
    r.drawInk();
    canvas.width = canvas.height = r.width;
  };
  let counts: MarkCounts = markCounts([]);
  return {
    backend: 'cpu',
    size: () => r.size,
    draw(P) {
      const view = new CpuStipple(buildScene(P, scene.meta)).view(cameraOf(P));
      r.setLayers(view.layers);
      ink();
      counts = view.counts;
    },
    counts: () => Promise.resolve(counts),
    present(surface) {
      const out = r.present(SURFACES[surface]);
      ctx.putImageData(new ImageData(out, r.width, r.height), 0, 0);
      return Promise.resolve();
    },
    resize(s) {
      r.resize(s);
      ink();
    },
    recovering: () => Promise.resolve(false),
    destroy: () => undefined,
  };
}

/**
 * The WebGPU engine. `copy` composites into a texture, reads it back and puts it on a 2D canvas
 * instead of presenting a WebGPU canvas (`?present=copy`, for headless SwiftShader; see start()).
 */
async function gpuEngine(
  scene: Scene,
  size: FrameSize,
  copy: boolean,
  events: { onRebuilt: () => void; onFailure: () => void },
): Promise<Engine> {
  const gpu = await Gpu.create();
  try {
    const canvas = freshCanvas();
    const format = copy ? 'rgba8unorm' : navigator.gpu.getPreferredCanvasFormat();
    const ctx2d = copy ? canvas.getContext('2d') : null;
    const ctxGpu = copy ? null : canvas.getContext('webgpu');
    if (copy ? !ctx2d : !ctxGpu) throw new Error('no canvas context');
    // every device that has been lost, for whatever reason (onSubmittedWorkDone resolves on a
    // lost device, so a frame's success has to be checked against this)
    const lostDevices = new WeakSet<GPUDevice>();
    let renderer: GpuRenderer | null = null;
    let stipple: GpuStipple | null = null;
    /** the parameters drawn last, redrawn on a new device */
    let drawn: Params | null = null;
    let out: GPUTexture | null = null;
    /** the output texture (copy mode) and canvas, at the renderer's size */
    const fitOutput = (r: GpuRenderer) => {
      out?.destroy();
      canvas.width = canvas.height = r.width;
      out = copy
        ? r.device.createTexture({
            size: [r.width, r.height],
            format,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
          })
        : null;
    };
    /** everything, on a (new) device */
    const build = (device: GPUDevice, s: FrameSize) => {
      void device.lost.then(() => lostDevices.add(device));
      renderer?.destroy();
      stipple?.destroy();
      const r = new GpuRenderer(device, s, scene.paper);
      renderer = r;
      stipple = GpuStipple.create(device);
      scene.atlases.forEach((a) => {
        r.addAtlas(a);
      });
      if (drawn) inkScene(drawn);
      if (ctxGpu) ctxGpu.configure({ device, format, alphaMode: 'opaque' });
      fitOutput(r);
    };
    /** model and view tiers on the GPU, then the ink */
    const inkScene = (P: Params) => {
      const r = current();
      const st = stipple;
      if (!st) throw new Error('no stipple passes');
      st.setScene(buildScene(P, scene.meta));
      st.setView(cameraOf(P));
      r.setLayers([...st.layers(), ...coreLayer(P, scene.meta)]);
      r.drawInk();
      drawn = P;
      return st;
    };
    build(gpu.device, size);
    gpu.onDevice((device) => {
      build(device, renderer?.size ?? size);
      events.onRebuilt();
    });
    gpu.onFailure(events.onFailure);
    const current = () => {
      if (!renderer) throw new Error('no renderer');
      return renderer;
    };
    return {
      backend: 'webgpu',
      size: () => current().size,
      draw(P) {
        inkScene(P);
      },
      async counts() {
        const st = stipple;
        if (!st) throw new Error('no stipple passes');
        // a read-back of the indirect draw arguments: never awaited by the frame queue
        return (await st.readCounts()).counts;
      },
      async present(surface) {
        const r = current();
        if (out && ctx2d) {
          r.present(out.createView(), format, SURFACES[surface]);
          const px = new Uint8ClampedArray((await readTexture(r.device, out, 4)).buffer);
          ctx2d.putImageData(new ImageData(px, r.width, r.height), 0, 0);
        } else if (ctxGpu) {
          r.present(ctxGpu.getCurrentTexture().createView(), format, SURFACES[surface]);
          await r.device.queue.onSubmittedWorkDone();
        }
        // let a loss reported alongside the frame land before trusting it
        await new Promise((res) => setTimeout(res, 0));
        if (lostDevices.has(r.device) || r.device !== gpu.device || r !== renderer)
          throw new Error('the device was lost during the frame');
        // a frame is on screen: the recovery budget counts losses in a row
        gpu.markHealthy();
      },
      resize(s) {
        // keep the atlases and pipelines: a new ink target, batches and composite uniforms
        const r = current();
        r.resize(s);
        r.drawInk();
        fitOutput(r);
      },
      recovering() {
        // the loss may be reported just after the failed call that revealed it
        const device = renderer?.device;
        if (!device) return Promise.resolve(false);
        if (lostDevices.has(device)) return Promise.resolve(true);
        return Promise.race([
          device.lost.then(() => true),
          new Promise<boolean>((res) =>
            setTimeout(() => {
              res(false);
            }, 200),
          ),
        ]);
      },
      destroy() {
        stipple?.destroy();
        renderer?.destroy();
        out?.destroy();
        gpu.destroy();
      },
    };
  } catch (e) {
    gpu.destroy();
    throw e;
  }
}

async function start(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const forced = params.get('backend');
  // `?present=copy`: Chromium's SwiftShader WebGPU loses the device when a WebGPU canvas is
  // presented headless, so the screenshot tool uses this; it is never the default.
  const copy = params.get('present') === 'copy';
  const stippleOnly = params.get('variant') === 'stipple';
  const note = document.getElementById('note');
  const stats = document.getElementById('stats');
  const select = document.getElementById('preset');
  const seedInput = document.getElementById('seed');
  if (!(select instanceof HTMLSelectElement) || !(seedInput instanceof HTMLInputElement))
    throw new Error('#preset or #seed is missing');
  let preset = params.get('preset') ?? 'Grand design';
  if (!PRESET_NAMES.includes(preset)) preset = 'Grand design';
  let seed = Math.min(9999, Math.max(1, Math.round(Number(params.get('seed') ?? 7)) || 7));
  for (const name of PRESET_NAMES) select.add(new Option(name, name, false, name === preset));
  seedInput.value = String(seed);

  const assets = await BuiltAssets.load(import.meta.env.BASE_URL);
  const [atlases, paper] = await Promise.all([
    Promise.all(ATLASES.map((n) => assets.atlas(n))),
    assets.paper(),
  ]);
  const by = (n: AtlasName) => {
    const a = atlases.find((x) => x.name === n);
    if (!a) throw new Error(`atlas ${n} missing`);
    return a;
  };
  const scene: Scene = {
    atlases,
    paper,
    meta: drawingsMeta({
      dots: by('dots'),
      knots: by('knots'),
      stars: by('stars'),
      cores: by('cores'),
    }),
  };
  const params0 = () => presetParams(preset, seed, stippleOnly ? STIPPLE_ONLY : {});

  /** the surface the toggle asks for; the plate catches up with it in show() */
  let surface: SurfaceName = 'paper';
  /** the size the plate should be drawn at; applied in show(), before presenting */
  let wantedSize = plateSize(plateCanvas());
  let frames = 0;
  let engine: Engine | undefined;
  /** the parameters wanted, and the engine and parameters last drawn */
  let wanted = { P: params0(), preset };
  let drawnBy: Engine | null = null;
  let drawn: typeof wanted | null = null;
  // frames are shown one after another, never concurrently
  let queue = Promise.resolve();

  const report = (e: unknown) => {
    console.error(e);
    if (note) note.textContent = `Could not draw: ${String(e)}`;
  };
  const toCpu = (why: unknown) => {
    console.warn('Switching to the CPU engine:', why);
    engine?.destroy();
    engine = cpuEngine(scene, wantedSize);
    schedule();
  };
  const show = async () => {
    const e = engine;
    if (!e) return; // the first frame will pick up the current surface and size
    const wantedSurface = surface;
    try {
      if (drawnBy !== e || drawn !== wanted) {
        e.draw(wanted.P);
        drawnBy = e;
        drawn = wanted;
      }
      if (!sameSize(e.size(), wantedSize)) e.resize(wantedSize);
      await e.present(wantedSurface);
    } catch (err) {
      if (e !== engine) return; // a newer engine has taken over
      // a lost device is being recreated, and onRebuilt will show the frame again
      if (!(await e.recovering()) && e === engine) toCpu(err);
      return;
    }
    frames++;
    const shown = drawn;
    const rosse = {
      backend: e.backend,
      surface: wantedSurface,
      frames,
      size: e.size(),
      // what is on the plate, which may lag the controls by a frame
      preset: shown.preset,
      seed: shown.P.seed,
      counts: null as MarkCounts | null,
    };
    window.__rosse = rosse;
    // the counts, after the frame and outside the queue
    void e.counts().then(
      (c) => {
        if (drawn !== shown) return;
        rosse.counts = c;
        if (stats) {
          const n = (x: number) => x.toLocaleString('en-GB');
          stats.textContent = `${n(c.dots)} dots · ${n(c.knots)} knots · ${n(c.stars)} stars`;
        }
      },
      () => undefined,
    );
    document.documentElement.dataset.backend = e.backend;
    if (note) note.textContent = e.backend === 'cpu' ? 'drawn on the CPU' : '';
  };
  function schedule() {
    queue = queue.then(show).catch(report);
  }

  // the toggle works from the start: a click before the first frame sets the surface it shows
  document.querySelectorAll<HTMLButtonElement>('button[data-surface]').forEach((b) => {
    b.addEventListener('click', () => {
      surface = b.dataset.surface === 'chalk' ? 'chalk' : 'paper';
      document.querySelectorAll('button[data-surface]').forEach((o) => {
        o.setAttribute('aria-pressed', String(o === b));
      });
      schedule();
    });
  });

  select.addEventListener('change', () => {
    preset = select.value;
    wanted = { P: params0(), preset };
    schedule();
  });
  seedInput.addEventListener('change', () => {
    seed = Math.min(9999, Math.max(1, Math.round(Number(seedInput.value)) || 1));
    seedInput.value = String(seed);
    wanted = { P: params0(), preset };
    schedule();
  });

  // redraw when the plate's CSS width or the device pixel ratio changes, as v21 does; resizes
  // are coalesced to one per animation frame and applied in the frame queue
  let resizePending = false;
  const resized = () => {
    wantedSize = plateSize(plateCanvas());
    if (resizePending) return;
    resizePending = true;
    requestAnimationFrame(() => {
      resizePending = false;
      schedule();
    });
  };
  const plateBox = plateCanvas().parentElement;
  if (plateBox) new ResizeObserver(resized).observe(plateBox);
  const watchDpr = () => {
    matchMedia(`(resolution: ${String(window.devicePixelRatio)}dppx)`).addEventListener(
      'change',
      () => {
        resized();
        watchDpr();
      },
      { once: true },
    );
  };
  watchDpr();

  const backend = await detectBackend(
    navigator,
    forced === 'cpu' || forced === 'webgpu' ? forced : null,
  );
  engine =
    backend === 'webgpu'
      ? await gpuEngine(scene, wantedSize, copy, {
          onRebuilt: schedule,
          onFailure: () => {
            toCpu('device lost and not recreated');
          },
        }).catch((e: unknown) => {
          console.warn('WebGPU failed, using the CPU engine:', e);
          return cpuEngine(scene, wantedSize);
        })
      : cpuEngine(scene, wantedSize);
  schedule();
  await queue;
}

start().catch((e: unknown) => {
  console.error(e);
  const note = document.getElementById('note');
  if (note) note.textContent = `Could not draw: ${String(e)}`;
});
