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
 * The plate orbits, rolls and zooms as v21's does (src/ui/orbit.ts). A camera move re-runs only
 * the view tier (ADR 0010), and moves are coalesced: at most one frame waits in the queue, drawn
 * on the next animation frame with the latest camera. Changing the preset resets the angles to the
 * preset's; the seed keeps them; the zoom is kept, as in v21.
 *
 * The plate shows every drawn part M5 places (envelopes, whole drawings, drawn arms, bars and rings,
 * bubbles, arcs, shells, the tail, trails, the jet and the streams, expanded on the GPU), the
 * drawn core and the nuclear spiral, with the engine's own picks.
 *
 * URL parameters: `preset`, `seed`, `variant=stipple` (the M2 golden overrides: no lines, knots or
 * envelope), `variant=ribbons` (the M4 overrides),
 * `variant=vectors` (the M5 overrides), `az`, `incl`, `pa`, `zoom`, `backend=cpu|webgpu`,
 * `present=copy`.
 */
import type { Params } from './core/params';
import { PRESET_NAMES, presetParams } from './core/presets';
import { CpuRenderer } from './fallback';
import { CpuStippleTiers } from './fallback/stipple';
import { Gpu, awaitLoss, detectBackend, type Backend } from './gpu/device';
import { readTexture } from './gpu/readback';
import { BuiltAssets, type AtlasData, type AtlasName, type ImageData8 } from './marks/atlas';
import { VECTOR_ATLASES, type VectorLibrary } from './marks/vector';
import { drawingsMeta, markCounts, type MarkCounts } from './model/scene';
import type { DrawingsMeta } from './model/variation';
import { GpuRenderer, type FrameSize } from './render/frame';
import { GpuStipple } from './render/stipple';
import { SURFACES, type SurfaceName } from './render/surface';
import { attachOrbit, type OrbitState } from './ui/orbit';
import { parseUrlView } from './ui/url';
import { PLATE, cameraOf, orientationOf, type Orientation } from './view/camera';

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
      /** the camera drawn: the parameters' angles and the page's zoom */
      camera: OrbitState;
      /** how many times the model and view tiers have run on this engine (ADR 0010) */
      tiers: { model: number; view: number };
      /** the most frames ever waiting in the queue at once (the orbit coalesces to one) */
      maxQueued: number;
    };
  }
}

const ATLASES: AtlasName[] = ['dots', 'knots', 'stars', 'cores', 'fgstars', 'pieces', 'strokes'];
/** v21 caps the device pixel ratio at 2 (app23.js:L1224). */
const MAX_DPR = 2;

/**
 * The M2 golden overrides (tests/golden/extra-cases.json). The drawn stars, the deep field and the
 * foreground stars they once switched off are drawn since M7 (ADR 0031).
 */
const STIPPLE_ONLY: Partial<Params> = {
  lines: 0,
  knots: 0,
  envelope: 0,
};

/**
 * The M4 golden overrides (tests/golden/extra-cases.json, variant `ribbons`): no bubbles, whole
 * drawings or envelopes (vector parts M5 draws and these cases leave to its own); `Barred spiral`
 * draws its bar and ring as ribbons.
 */
function ribbonsOnly(preset: string): Partial<Params> {
  return {
    bubbles: 0,
    whole: 0,
    envelope: 0,
    ...(preset === 'Barred spiral' ? { barStyle: 'ribbon', ringStyle: 'ribbon' } : {}),
  };
}

/**
 * The M5 golden overrides (tests/golden/extra-cases.json, variant `vectors`): `Shell galaxy` draws
 * its drawn shells instead of its simulated ones (M8).
 */
function vectorsOnly(preset: string): Partial<Params> {
  return {
    ...(preset === 'Shell galaxy' ? { shellsOn: 0, shells: 1 } : {}),
  };
}

interface Scene {
  atlases: AtlasData[];
  paper: ImageData8;
  meta: DrawingsMeta;
}

interface Engine {
  backend: Backend;
  /** the size the engine draws at now */
  size(): FrameSize;
  /**
   * The model and view tiers these parameters and zoom need (only the view tier when just the
   * camera moved, ADR 0010), then the ink.
   */
  draw(P: Params, zoom: number, home: Orientation): void;
  /** how many times each tier has run */
  tierRuns(): { model: number; view: number };
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
   * rebuild and show it again (no CPU fallback needed). `err` is the failure: one that looks like a
   * loss (an AbortError from `mapAsync`) waits longer for the loss to be reported.
   */
  recovering(err: unknown): Promise<boolean>;
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

/**
 * A canvas keeps its first context type, so switching engine needs a new element. It keeps the
 * old one's attributes (tab stop, label) and, if the old one had focus, the focus.
 */
function freshCanvas(): HTMLCanvasElement {
  const old = plateCanvas();
  const hadFocus = document.activeElement === old;
  const c = old.cloneNode() as HTMLCanvasElement;
  old.replaceWith(c);
  if (hadFocus) c.focus();
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
  const stipple = new CpuStippleTiers(scene.meta);
  return {
    backend: 'cpu',
    size: () => r.size,
    draw(P, zoom, home) {
      const { view, work } = stipple.frame(P, zoom, { home });
      if (work.view) r.setLayers(view.layers);
      ink();
      counts = view.counts;
    },
    tierRuns: () => ({ ...stipple.tiers.runs }),
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
    /** the parameters and zoom drawn last, redrawn on a new device */
    let drawn: { P: Params; zoom: number; home: Orientation } | null = null;
    /** tier runs on earlier devices */
    const pastRuns = { model: 0, view: 0 };
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
      if (stipple) {
        pastRuns.model += stipple.tiers.runs.model;
        pastRuns.view += stipple.tiers.runs.view;
        stipple.destroy();
      }
      const r = new GpuRenderer(device, s, scene.paper);
      renderer = r;
      stipple = GpuStipple.create(device);
      scene.atlases.forEach((a) => {
        r.addAtlas(a);
      });
      if (drawn) inkScene(drawn.P, drawn.zoom, drawn.home);
      if (ctxGpu) ctxGpu.configure({ device, format, alphaMode: 'opaque' });
      fitOutput(r);
    };
    /** the tiers that changed, on the GPU, then the ink */
    const inkScene = (P: Params, zoom: number, home: Orientation) => {
      const r = current();
      const st = stipple;
      if (!st) throw new Error('no stipple passes');
      const work = st.frame(P, zoom, scene.meta, { home });
      // every layer in scene() order: line-work, drawn parts, stipple, streams, cores
      if (work.view) r.setLayers(st.inkLayers());
      r.drawInk();
      drawn = { P, zoom, home };
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
      draw(P, zoom, home) {
        inkScene(P, zoom, home);
      },
      tierRuns() {
        const now = stipple?.tiers.runs ?? { model: 0, view: 0 };
        return { model: pastRuns.model + now.model, view: pastRuns.view + now.view };
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
      recovering(err) {
        // the loss may be reported well after the failed call that revealed it (awaitLoss)
        const device = renderer?.device;
        if (!device) return Promise.resolve(false);
        if (lostDevices.has(device)) return Promise.resolve(true);
        return awaitLoss(device, err);
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
  const variant = params.get('variant');
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
  const [atlases, paper, sheets] = await Promise.all([
    Promise.all(ATLASES.map((n) => assets.atlas(n))),
    assets.paper(),
    Promise.all(VECTOR_ATLASES.map((n) => assets.vector(n))),
  ]);
  const vectors = Object.fromEntries(VECTOR_ATLASES.map((n, i) => [n, sheets[i]])) as VectorLibrary;
  const by = (n: AtlasName) => {
    const a = atlases.find((x) => x.name === n);
    if (!a) throw new Error(`atlas ${n} missing`);
    return a;
  };
  const scene: Scene = {
    atlases,
    paper,
    meta: drawingsMeta(
      {
        dots: by('dots'),
        knots: by('knots'),
        stars: by('stars'),
        cores: by('cores'),
        fgstars: by('fgstars'),
        strokes: by('strokes'),
      },
      vectors.penlines,
      vectors,
    ),
  };
  const params0 = () =>
    presetParams(
      preset,
      seed,
      variant === 'stipple'
        ? STIPPLE_ONLY
        : variant === 'ribbons'
          ? ribbonsOnly(preset)
          : variant === 'vectors'
            ? vectorsOnly(preset)
            : {},
    );
  /** the camera from the URL, if given (src/ui/url.ts) */
  const urlView = parseUrlView(params);

  /** the surface the toggle asks for; the plate catches up with it in show() */
  let surface: SurfaceName = 'paper';
  /** the size the plate should be drawn at; applied in show(), before presenting */
  let wantedSize = plateSize(plateCanvas());
  let frames = 0;
  let engine: Engine | undefined;
  /** the parameters and zoom wanted, and the engine and parameters last drawn */
  let wanted = (() => {
    const P = params0();
    const { az = P.az, incl = P.incl, pa = P.pa, zoom = 1 } = urlView;
    // zoom is the page's (v21's ZOOM: not a parameter, a view input)
    const start = { ...P, az, incl, pa };
    // the overlays' home orientation (open question Q3): the camera the page starts at
    return { P: start, preset, zoom, home: orientationOf(cameraOf(start)) };
  })();
  let drawnBy: Engine | null = null;
  let drawn: typeof wanted | null = null;
  /** the scene whose counts were last read back, and that read */
  let counted: { engine: Engine; scene: typeof wanted; read: Promise<MarkCounts> } | null = null;
  // frames are shown one after another, never concurrently
  let queue = Promise.resolve();
  /** frames scheduled and not yet started (0 or 1), and the most there have ever been */
  let queued = 0;
  let maxQueued = 0;

  const report = (e: unknown) => {
    console.error(e);
    if (note) note.textContent = `Could not draw: ${String(e)}`;
  };
  const toCpu = (why: unknown) => {
    console.warn('Switching to the CPU engine:', why);
    engine?.destroy();
    engine = cpuEngine(scene, wantedSize);
    bindOrbit();
    schedule();
  };
  const show = async () => {
    queued--;
    frameRequested = false;
    const e = engine;
    if (!e) return; // the first frame will pick up the current surface and size
    const wantedSurface = surface;
    try {
      if (drawnBy !== e || drawn !== wanted) {
        e.draw(wanted.P, wanted.zoom, wanted.home);
        drawnBy = e;
        drawn = wanted;
      }
      if (!sameSize(e.size(), wantedSize)) e.resize(wantedSize);
      await e.present(wantedSurface);
    } catch (err) {
      if (e !== engine) return; // a newer engine has taken over
      // a lost device is being recreated, and onRebuilt will show the frame again
      if (!(await e.recovering(err)) && e === engine) toCpu(err);
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
      camera: { az: shown.P.az || 0, incl: shown.P.incl, pa: shown.P.pa, zoom: shown.zoom },
      tiers: e.tierRuns(),
      maxQueued,
    };
    window.__rosse = rosse;
    // The counts, after the frame and outside the queue, read back only once per drawn scene:
    // a surface toggle or a resize shows the same scene and reuses them (no mapAsync).
    if (!counted || counted.engine !== e || counted.scene !== shown) {
      const read = e.counts();
      counted = { engine: e, scene: shown, read };
      read.catch(() => {
        if (counted?.read === read) counted = null;
      });
    }
    void counted.read.then(
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
  /**
   * Asks for a frame. Every change (camera, surface, preset, seed, size, engine) comes through
   * here, and at most one frame waits in the queue: if one is already waiting, it will draw the
   * latest state when it starts, so another is not added.
   */
  function schedule() {
    if (queued > 0) return;
    queued++;
    maxQueued = Math.max(maxQueued, queued);
    queue = queue.then(show).catch(report);
  }
  /**
   * A camera move or resize: one frame on the next animation frame, unless one is already
   * requested (schedule() then coalesces it with any frame waiting in the queue).
   */
  let frameRequested = false;
  function requestFrame() {
    if (frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(schedule);
  }

  // orbit, roll and zoom (v21's controls); re-attached when a new engine replaces the canvas
  let detachOrbit: (() => void) | null = null;
  const bindOrbit = () => {
    detachOrbit?.();
    detachOrbit = attachOrbit(plateCanvas(), {
      get: () => {
        const P = wanted.P;
        return { az: P.az || 0, incl: P.incl, pa: P.pa, zoom: wanted.zoom };
      },
      set: (c) => {
        wanted = { ...wanted, P: { ...wanted.P, az: c.az, incl: c.incl, pa: c.pa }, zoom: c.zoom };
        requestFrame();
      },
    });
  };

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
    // a new preset is placed at its own orientation, which becomes the overlays' home
    const P = params0();
    wanted = { P, preset, zoom: wanted.zoom, home: orientationOf(cameraOf(P)) };
    schedule();
  });
  seedInput.addEventListener('change', () => {
    seed = Math.min(9999, Math.max(1, Math.round(Number(seedInput.value)) || 1));
    seedInput.value = String(seed);
    // a new seed keeps the camera
    const { az, incl, pa } = wanted.P;
    // (v21 re-homes its overlays when the seed changes: the camera it keeps is their home)
    const P = { ...params0(), az, incl, pa };
    wanted = { P, preset, zoom: wanted.zoom, home: orientationOf(cameraOf(P)) };
    schedule();
  });

  // redraw when the plate's CSS width or the device pixel ratio changes, as v21 does; resizes
  // are coalesced with camera moves (requestFrame) and applied in the frame queue
  const resized = () => {
    wantedSize = plateSize(plateCanvas());
    requestFrame();
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
  bindOrbit();
  schedule();
  await queue;
}

start().catch((e: unknown) => {
  console.error(e);
  const note = document.getElementById('note');
  if (note) note.textContent = `Could not draw: ${String(e)}`;
});
