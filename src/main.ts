/**
 * Entry point of the page (M1): the plate, on Paper or Chalkboard, with one dot at its centre
 * and a few more marks around it (render/sample-scene.ts).
 *
 * Flow (docs/architecture.md, "Frame"): pick the engine (WebGPU, or the CPU engine of ADR 0011
 * when WebGPU is missing, fails, or `?backend=cpu` is given), load the packed drawings, ink the
 * scene, and composite it onto the surface. Switching surface re-runs only the composite (the
 * present tier of ADR 0010). The plate is drawn at its CSS width × device pixel ratio (capped at
 * 2, as v21) and redrawn when either changes. If the GPU device is lost it is recreated and
 * everything rebuilt; if that fails, or a frame fails for another reason, the page carries on
 * with the CPU engine.
 */
import { CpuRenderer } from './fallback';
import { Gpu, detectBackend, type Backend } from './gpu/device';
import { readTexture } from './gpu/readback';
import { BuiltAssets, type AtlasData, type AtlasName, type ImageData8 } from './marks/atlas';
import { GpuRenderer, type FrameSize } from './render/frame';
import type { InkLayer } from './render/layers';
import { PLATE_UNITS, sampleScene } from './render/sample-scene';
import { SURFACES, type SurfaceName } from './render/surface';

declare global {
  interface Window {
    /** The last frame on the plate: which engine drew it, on which surface, at what size. */
    __rosse?: { backend: Backend; surface: SurfaceName; frames: number; size: FrameSize };
  }
}

const ATLASES: AtlasName[] = ['dots', 'knots', 'stars', 'cores', 'pieces'];
/** v21 caps the device pixel ratio at 2 (app23.js:L1224). */
const MAX_DPR = 2;

interface Scene {
  atlases: AtlasData[];
  paper: ImageData8;
  layers: InkLayer[];
}

interface Engine {
  backend: Backend;
  /** Composites onto the surface and shows it. Rejects if the frame could not be shown. */
  present(surface: SurfaceName): Promise<void>;
  /** Rebuilds at a new plate size or DPR. */
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
    plateCss: canvas.clientWidth || PLATE_UNITS,
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
  let r: CpuRenderer;
  const build = (s: FrameSize) => {
    r = new CpuRenderer(s, scene.paper);
    scene.atlases.forEach((a) => {
      r.addAtlas(a);
    });
    r.setLayers(scene.layers);
    r.drawInk();
    canvas.width = canvas.height = r.width;
  };
  build(size);
  return {
    backend: 'cpu',
    present(surface) {
      const out = r.present(SURFACES[surface]);
      ctx.putImageData(new ImageData(out, r.width, r.height), 0, 0);
      return Promise.resolve();
    },
    resize: build,
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
    let current = size;
    let renderer: GpuRenderer | null = null;
    let out: GPUTexture | null = null;
    const build = (device: GPUDevice, s: FrameSize) => {
      renderer?.destroy();
      out?.destroy();
      renderer = new GpuRenderer(device, s, scene.paper);
      scene.atlases.forEach((a) => renderer?.addAtlas(a));
      renderer.setLayers(scene.layers);
      renderer.drawInk();
      canvas.width = canvas.height = renderer.width;
      if (ctxGpu) ctxGpu.configure({ device, format, alphaMode: 'opaque' });
      out = copy
        ? device.createTexture({
            size: [renderer.width, renderer.height],
            format,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
          })
        : null;
    };
    build(gpu.device, size);
    gpu.onDevice((device) => {
      build(device, current);
      events.onRebuilt();
    });
    gpu.onFailure(events.onFailure);
    return {
      backend: 'webgpu',
      async present(surface) {
        const r = renderer;
        if (!r) throw new Error('no renderer');
        if (out && ctx2d) {
          r.present(out.createView(), format, SURFACES[surface]);
          const px = new Uint8ClampedArray((await readTexture(r.device, out, 4)).buffer);
          ctx2d.putImageData(new ImageData(px, r.width, r.height), 0, 0);
        } else if (ctxGpu) {
          r.present(ctxGpu.getCurrentTexture().createView(), format, SURFACES[surface]);
          await r.device.queue.onSubmittedWorkDone();
        }
        // a frame is on screen: the recovery budget counts losses in a row
        gpu.markHealthy();
      },
      resize(s) {
        current = s;
        build(gpu.device, s);
      },
      recovering() {
        // the loss may be reported just after the failed call that revealed it
        const device = renderer?.device;
        if (!device) return Promise.resolve(false);
        return Promise.race([
          device.lost.then(() => true),
          new Promise<boolean>((r) =>
            setTimeout(() => {
              r(false);
            }, 200),
          ),
        ]);
      },
      destroy() {
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
  const note = document.getElementById('note');

  const assets = await BuiltAssets.load(import.meta.env.BASE_URL);
  const [atlases, paper] = await Promise.all([
    Promise.all(ATLASES.map((n) => assets.atlas(n))),
    assets.paper(),
  ]);
  const layerCount = (n: AtlasName) => atlases.find((a) => a.name === n)?.layers ?? 1;
  const dotSizes = (atlases[0]?.meta.size ?? []) as number[];
  const scene: Scene = {
    atlases,
    paper,
    layers: sampleScene(dotSizes, {
      dots: layerCount('dots'),
      knots: layerCount('knots'),
      stars: layerCount('stars'),
      cores: layerCount('cores'),
      pieces: layerCount('pieces'),
    }),
  };

  /** the surface the toggle asks for; the plate catches up with it in show() */
  let surface: SurfaceName = 'paper';
  let size = plateSize(plateCanvas());
  let frames = 0;
  let engine: Engine;
  // frames are shown one after another, never concurrently
  let queue = Promise.resolve();

  const toCpu = (why: unknown) => {
    console.warn('Switching to the CPU engine:', why);
    engine.destroy();
    engine = cpuEngine(scene, size);
    schedule();
  };
  const show = async () => {
    const e = engine;
    const wanted = surface;
    try {
      await e.present(wanted);
    } catch (err) {
      if (e !== engine) return; // a newer engine has taken over
      // a lost device is being recreated, and onRebuilt will show the frame again
      if (!(await e.recovering()) && e === engine) toCpu(err);
      return;
    }
    frames++;
    window.__rosse = { backend: e.backend, surface: wanted, frames, size };
    document.documentElement.dataset.backend = e.backend;
    if (note) note.textContent = e.backend === 'cpu' ? 'drawn on the CPU' : '';
  };
  const schedule = () => {
    queue = queue.then(show, show);
  };

  const backend = await detectBackend(
    navigator,
    forced === 'cpu' || forced === 'webgpu' ? forced : null,
  );
  engine =
    backend === 'webgpu'
      ? await gpuEngine(scene, size, copy, {
          onRebuilt: schedule,
          onFailure: () => {
            toCpu('device lost and not recreated');
          },
        }).catch((e: unknown) => {
          console.warn('WebGPU failed, using the CPU engine:', e);
          return cpuEngine(scene, size);
        })
      : cpuEngine(scene, size);
  schedule();
  await queue;

  document.querySelectorAll<HTMLButtonElement>('button[data-surface]').forEach((b) => {
    b.addEventListener('click', () => {
      surface = b.dataset.surface === 'chalk' ? 'chalk' : 'paper';
      document.querySelectorAll('button[data-surface]').forEach((o) => {
        o.setAttribute('aria-pressed', String(o === b));
      });
      schedule();
    });
  });

  // redraw when the plate's CSS width or the device pixel ratio changes, as v21 does
  const resized = () => {
    const s = plateSize(plateCanvas());
    if (sameSize(s, size)) return;
    size = s;
    engine.resize(s);
    schedule();
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
}

start().catch((e: unknown) => {
  console.error(e);
  const note = document.getElementById('note');
  if (note) note.textContent = `Could not draw: ${String(e)}`;
});
