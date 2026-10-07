/**
 * Entry point of the page (M2): the plate shows the current preset's stipple, on Paper or
 * Chalkboard, with a preset menu and a seed. The full page is M11.
 *
 * Flow (docs/architecture.md, "Frame"): pick the engine (WebGPU, or the CPU engine of ADR 0011
 * when WebGPU is missing, fails, or `?backend=cpu` is given), load the packed drawings, build the
 * scene description on the CPU, run the model and view tiers (compute passes, or their CPU twins),
 * ink the layers, and composite onto the surface. Switching surface re-runs only the composite (the
 * present tier of ADR 0010), and so does switching plates, which re-inks the existing buffers with
 * the plates' passes (src/render/plates.ts) and runs no compute pass. The plate is drawn at its CSS width × device pixel ratio (capped at
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
 * URL parameters: `preset`, `seed`, `variant=stipple` (the M2 golden overrides: no lines, knots,
 * envelope, drawn stars, deep field or foreground stars), `variant=ribbons` (the M4 overrides),
 * `variant=vectors` (the M5 overrides), `az`, `incl`, `pa`, `zoom`, `backend=cpu|webgpu`,
 * `present=copy`, `cpuworker=off` (the CPU engine on the main thread, for profiling).
 */
import type { Params } from './core/params';
import { presetParams } from './core/presets';
import { buildShellScene } from './model/shells';
import { LocalCpu, WorkerCpu, type CpuBackend } from './fallback/client';
import { GpuMerger } from './render/merger';
import { GpuShells } from './render/shells';
import { CAPABILITIES, type Capabilities } from './render/capabilities';
import type { InkLayer } from './render/layers';
import { pageModelKey } from './render/page-key';
import { Gpu, awaitLoss, detectBackend, type Backend } from './gpu/device';
import { readTexture } from './gpu/readback';
import { BuiltAssets, type AtlasData, type AtlasName, type ImageData8 } from './marks/atlas';
import { VECTOR_ATLASES, type VectorLibrary } from './marks/vector';
import { drawingsMeta, markCounts, type MarkCounts } from './model/scene';
import type { DrawingsMeta } from './model/variation';
import { GpuRenderer, type FrameSize } from './render/frame';
import { inkKey, inkLook } from './render/ink-look';
import type { Plates } from './render/plates';
import { GpuStipple } from './render/stipple';
import { SURFACES, type SurfaceName } from './render/surface';
import { attachOrbit, type OrbitState } from './ui/orbit';
import type { Pixels } from './ui/export';
import { iconSvg } from './ui/icons';
import { mountPage } from './ui/page';
import { thumbUrl } from './ui/thumbs';
import { initialSurface } from './ui/theme';
import { parseUrlState } from './ui/urlstate';
import { PLATE, cameraOf, orientationOf, type Orientation } from './view/camera';

declare global {
  interface Window {
    /** The last frame on the plate: which engine drew it, on which surface, at what size. */
    __rosse?: {
      backend: Backend;
      surface: SurfaceName;
      /** the plates the ink was printed with */
      plates: Plates;
      frames: number;
      size: FrameSize;
      preset: string | null;
      seed: number;
      counts: MarkCounts | null;
      /** the overlays' home orientation: set again for a new preset or seed, never by the camera */
      home: Orientation;
      /** the camera drawn: the parameters' angles and the page's zoom */
      camera: OrbitState;
      /** how many times the model and view tiers have run on this engine (ADR 0010) */
      tiers: { model: number; view: number };
      /** the most frames ever waiting in the queue at once (the orbit coalesces to one) */
      maxQueued: number;
    };
  }
}

const ATLASES: AtlasName[] = ['dots', 'knots', 'stars', 'cores', 'pieces', 'strokes'];
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

/**
 * The M4 golden overrides (tests/golden/extra-cases.json, variant `ribbons`): no drawn stars among
 * the stipple, deep field, foreground stars, bubbles, whole drawings or envelopes (vector and sky
 * marks of later milestones); `Barred spiral` draws its bar and ring as ribbons.
 */
function ribbonsOnly(preset: string): Partial<Params> {
  return {
    starMix: 0,
    field: 0,
    fgstars: 0,
    bubbles: 0,
    whole: 0,
    envelope: 0,
    ...(preset === 'Barred spiral' ? { barStyle: 'ribbon', ringStyle: 'ribbon' } : {}),
  };
}

/**
 * The M5 golden overrides (tests/golden/extra-cases.json, variant `vectors`): no drawn stars among
 * the stipple, deep field or foreground stars (M7); `Shell galaxy` draws its drawn shells instead
 * of its simulated ones (M8).
 */
function vectorsOnly(preset: string): Partial<Params> {
  return {
    starMix: 0,
    field: 0,
    fgstars: 0,
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
  /** what this engine draws: the page offers controls and presets for these only */
  capabilities: Readonly<Capabilities>;
  /**
   * True when the engine lost what it had drawn (a new device) and the next frame must draw
   * again although the parameters are the same.
   */
  stale(): boolean;
  /** the size the engine draws at now */
  size(): FrameSize;
  /**
   * The model and view tiers these parameters and zoom need (only the view tier when just the
   * camera moved, ADR 0010), then the ink. A merger's or a shell galaxy's model tier is built here
   * (an integration, asynchronous on the GPU): the frame queue waits for it, so the previous frame
   * stays on the plate meanwhile, and `busy` tells the page it has begun and ended. `home` is the
   * overlays' home orientation, for the engines that draw overlays (M7).
   */
  draw(P: Params, zoom: number, home: Orientation, busy: (on: boolean) => void): Promise<void>;
  /** how many times each tier has run */
  tierRuns(): { model: number; view: number };
  /**
   * The mark counts of the last draw, for the line under the plate. On the GPU this reads the
   * indirect draw arguments back (`mapAsync`), so the page asks for it after presenting, outside
   * the frame queue.
   */
  counts(): Promise<MarkCounts>;
  /**
   * Inks the target for the plates if they or the surface's palette changed since the last ink
   * (the present tier), composites onto the surface and shows it. Rejects if the frame could not
   * be shown.
   */
  present(surface: SurfaceName, plates: Plates): Promise<void>;
  /**
   * The plate as pixels, composited for this surface and plates at the size drawn: the PNG export.
   * Reads back on demand (never on the frame path); the page asks for it in the frame queue.
   */
  snapshot(surface: SurfaceName, plates: Plates): Promise<Pixels>;
  /** The ink layers of the last draw (an export may read their buffers back on demand). */
  layers(): readonly InkLayer[];
  /** The GPU device drawing now, or null on the CPU engine. */
  device(): GPUDevice | null;
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

/**
 * The CPU engine's backend: a worker (ADR 0071), so that no frame, and above all no merger or
 * shell integration, blocks the page, or the page's own thread where a worker cannot be made or
 * `?cpuworker=off` is given.
 */
async function cpuBackend(scene: Scene, size: FrameSize): Promise<CpuBackend> {
  const off = new URLSearchParams(location.search).get('cpuworker') === 'off';
  if (!off && typeof Worker !== 'undefined') {
    try {
      return await WorkerCpu.create(import.meta.env.BASE_URL, size);
    } catch (e) {
      console.warn('The CPU worker failed, drawing on the main thread:', e);
    }
  }
  return new LocalCpu(scene.atlases, scene.paper, scene.meta, size);
}

async function cpuEngine(scene: Scene, size: FrameSize): Promise<Engine> {
  const backend = await cpuBackend(scene, size);
  const canvas = freshCanvas();
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2D canvas');
  let current = size;
  /** a resize in flight (the backend handles requests in order; this surfaces its failure) */
  let pending: Promise<unknown> = Promise.resolve();
  let counts: MarkCounts = markCounts([]);
  let tiers = { model: 0, view: 0 };
  /** the key of the merger or shells the backend holds; null for a single galaxy */
  let builtKey: string | null = null;
  document.documentElement.dataset.cpuWhere = backend.where;
  return {
    backend: 'cpu',
    capabilities: CAPABILITIES,
    size: () => current,
    stale: () => false,
    async draw(P, zoom, _home, busy) {
      await pending;
      // a merger's integration, or the shells' simulation, is this frame's model tier: say so
      const key = P.merger || P.shellsOn ? pageModelKey(P) : null;
      const building = key !== null && key !== builtKey;
      if (building) busy(true);
      try {
        const d = await backend.draw(P, zoom);
        counts = d.counts;
        tiers = d.tiers;
        builtKey = key;
      } finally {
        if (building) busy(false);
      }
    },
    tierRuns: () => ({ ...tiers }),
    counts: () => Promise.resolve(counts),
    async present(surface, plates) {
      await pending;
      const f = await backend.present(surface, plates);
      // a canvas is cleared when it is resized, so only when the size changed
      if (canvas.width !== f.width || canvas.height !== f.height) {
        canvas.width = f.width;
        canvas.height = f.height;
      }
      ctx.putImageData(new ImageData(f.pixels, f.width, f.height), 0, 0);
    },
    async snapshot(surface, plates) {
      // the visible canvas is not touched
      await pending;
      const f = await backend.present(surface, plates);
      return { px: f.pixels, width: f.width, height: f.height };
    },
    resize(s) {
      current = s;
      pending = backend.resize(s);
      pending.catch(() => undefined);
    },
    // the layers live in the worker: M12's SVG export asks `CpuBackend.layers()` (asynchronous)
    layers: () => [],
    device: () => null,
    recovering: () => Promise.resolve(false),
    destroy: () => {
      backend.destroy();
    },
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
    /** a new device has no drawing: the next frame draws again */
    let stale = false;
    /** tier runs on earlier devices */
    const pastRuns = { model: 0, view: 0 };
    /** the merger and the shells of this device, what they were built for, and their tier runs */
    let merger: GpuMerger | null = null;
    let shellsPass: GpuShells | null = null;
    let builtKey: string | null = null;
    let shellsKey: string | null = null;
    const pageRuns = { model: 0, view: 0 };
    /** what the ink layers are now: the stipple's, the stipple's with shells, or the merger's */
    let mode: 'stipple' | 'shells' | 'merger' = 'stipple';
    let layers: readonly InkLayer[] = [];
    let readCounts: () => Promise<MarkCounts> = () => Promise.resolve(markCounts([]));
    let out: GPUTexture | null = null;
    /** the key of the look the ink target holds; null when it is stale */
    let inked: string | null = null;
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
      merger?.destroy();
      shellsPass?.destroy();
      merger = shellsPass = null;
      builtKey = shellsKey = null;
      mode = 'stipple';
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
      stale = true;
      if (ctxGpu) ctxGpu.configure({ device, format, alphaMode: 'opaque' });
      fitOutput(r);
    };
    /**
     * The tiers that changed, on the GPU, then the ink. A merger or simulated shells are built
     * first (asynchronously, in chunks), serialised by the frame queue; the device may be replaced
     * while they are, and then the frame fails as a lost device does and is drawn again.
     */
    const inkScene = async (P: Params, zoom: number, busy: (on: boolean) => void) => {
      const r = current();
      const st = stipple;
      if (!st) throw new Error('no stipple passes');
      stale = false;
      const lost = () => new Error('the device was lost during the build');
      if (P.merger) {
        const m = (merger ??= GpuMerger.create(r.device));
        const key = pageModelKey(P);
        if (builtKey !== key) {
          builtKey = null;
          busy(true);
          try {
            await m.build({ ...P }, scene.meta);
          } finally {
            busy(false);
          }
          if (merger !== m || renderer !== r) throw lost();
          builtKey = key;
          pageRuns.model++;
        }
        // the camera is the view tier's: it is set on the built scene, `view` takes the moment
        if (m.scene)
          Object.assign(m.scene.P, { az: P.az, incl: P.incl, pa: P.pa, winding: P.winding });
        m.view(zoom, P.mTime);
        pageRuns.view++;
        layers = m.inkLayers();
        r.setLayers(layers);
        readCounts = async () => (await m.readCounts()).counts;
        mode = 'merger';
      } else {
        const work = st.frame(P, zoom, scene.meta);
        let sh: GpuShells | null = null;
        if (P.shellsOn && st.current) {
          sh = shellsPass ??= GpuShells.create(r.device);
          const key = pageModelKey(P);
          if (shellsKey !== key) {
            shellsKey = null;
            busy(true);
            try {
              await sh.build(buildShellScene(P, scene.meta, st.current.variation));
            } finally {
              busy(false);
            }
            if (shellsPass !== sh || renderer !== r) throw lost();
            shellsKey = key;
            pageRuns.model++;
          }
          sh.view(zoom);
          pageRuns.view++;
        }
        // every layer in scene() order: line-work, drawn parts, stipple, streams, cores
        if (work.view || sh || mode !== 'stipple') {
          layers = sh ? [...st.inkLayers(), ...sh.layers()] : st.inkLayers();
          r.setLayers(layers);
        }
        const shown = sh;
        readCounts = shown
          ? async () => {
              const c = (await st.readCounts()).counts;
              return { ...c, dots: c.dots + shown.count };
            }
          : async () => (await st.readCounts()).counts;
        mode = sh ? 'shells' : 'stipple';
      }
      inked = null;
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
      capabilities: CAPABILITIES,
      stale: () => stale,
      draw(P, zoom, _home, busy) {
        return inkScene(P, zoom, busy);
      },
      tierRuns() {
        const now = stipple?.tiers.runs ?? { model: 0, view: 0 };
        return {
          model: pastRuns.model + now.model + pageRuns.model,
          view: pastRuns.view + now.view + pageRuns.view,
        };
      },
      // a read-back of the indirect draw arguments: never awaited by the frame queue
      counts: () => readCounts(),
      layers: () => layers,
      device: () => renderer?.device ?? null,
      async present(surface, plates) {
        const r = current();
        const look = inkLook(plates, surface);
        if (inkKey(look) !== inked) {
          r.drawInk(look);
          inked = inkKey(look);
        }
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
      async snapshot(surface, plates) {
        const r = current();
        const look = inkLook(plates, surface);
        if (inkKey(look) !== inked) {
          r.drawInk(look);
          inked = inkKey(look);
        }
        // composite into a texture of its own and read it back: nothing depends on the canvas
        // keeping what it showed
        const tex = r.device.createTexture({
          size: [r.width, r.height],
          format: 'rgba8unorm',
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        });
        try {
          r.present(tex.createView(), 'rgba8unorm', SURFACES[surface]);
          const px = new Uint8ClampedArray((await readTexture(r.device, tex, 4)).buffer);
          return { px, width: r.width, height: r.height };
        } finally {
          tex.destroy();
        }
      },
      resize(s) {
        // keep the atlases and pipelines: a new ink target, batches and composite uniforms
        const r = current();
        r.resize(s);
        inked = null;
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

/** What the page wants drawn: the parameters, the zoom, and the overlays' home orientation. */
interface Wanted {
  P: Params;
  preset: string | null;
  from?: string;
  zoom: number;
  /** the orientation overlays are fixed at (open question Q3); set again for a new drawing only */
  home: Orientation;
}

/** Text only when it differs: the live regions are not rewritten every frame. */
function say(e: HTMLElement | null, text: string): void {
  if (e && e.textContent !== text) e.textContent = text;
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
        strokes: by('strokes'),
      },
      vectors.penlines,
      vectors,
    ),
  };
  /** the golden variants' overrides (`?variant=`), which the page applies to every preset */
  const variantOverrides = (name: string): Partial<Params> =>
    variant === 'stipple'
      ? STIPPLE_ONLY
      : variant === 'ribbons'
        ? ribbonsOnly(name)
        : variant === 'vectors'
          ? vectorsOnly(name)
          : {};
  const makeParams = (name: string, sd: number) => presetParams(name, sd, variantOverrides(name));

  /** the surface the toggle asks for; the plate catches up with it in show() */
  let surface: SurfaceName = 'paper';
  /** the size the plate should be drawn at; applied in show(), before presenting */
  let wantedSize = plateSize(plateCanvas());
  let frames = 0;
  let engine: Engine | undefined;
  /** what is wanted (set once the engine has said what it draws), and what was last drawn */
  let wanted!: Wanted;
  let drawnBy: Engine | null = null;
  let drawn: Wanted | null = null;
  /** the scene whose counts were last read back, and that read */
  let counted: { engine: Engine; scene: Wanted; read: Promise<MarkCounts> } | null = null;
  // frames are shown one after another, never concurrently
  let queue = Promise.resolve();
  /** frames scheduled and not yet started (0 or 1), and the most there have ever been */
  let queued = 0;
  let maxQueued = 0;
  /** what the engine is building (a merger's integration), for the line under the plate */
  let building = false;

  const report = (e: unknown) => {
    console.error(e);
    say(note, `Could not draw: ${String(e)}`);
  };
  const toCpu = (why: unknown) => {
    console.warn('Switching to the CPU engine:', why);
    engine?.destroy();
    engine = undefined;
    cpuEngine(scene, wantedSize).then((e) => {
      engine = e;
      bindOrbit();
      schedule();
    }, report);
  };
  const busy = (on: boolean) => {
    building = on;
    if (on) say(stats, 'Simulating the merger…');
  };
  const show = async () => {
    queued--;
    frameRequested = false;
    const e = engine;
    if (!e) return; // the first frame will pick up the current surface and size
    // the size as it is now: a DPR change can reach a frame before its media-query event has
    // updated wantedSize, which drew (and reported in __rosse.size) the old DPR for one frame
    wantedSize = plateSize(plateCanvas());
    const wantedSurface = surface;
    // what this frame draws: the page may change `wanted` while a build is awaited
    const want = wanted;
    const wantedPlates = want.P.plates as Plates;
    try {
      if (drawnBy !== e || drawn !== want || e.stale()) {
        await e.draw(want.P, want.zoom, want.home, busy);
        drawnBy = e;
        drawn = want;
      }
      if (!sameSize(e.size(), wantedSize)) e.resize(wantedSize);
      await e.present(wantedSurface, wantedPlates);
    } catch (err) {
      building = false;
      if (e !== engine) return; // a newer engine has taken over
      // a lost device is being recreated, and onRebuilt will show the frame again
      if (!(await e.recovering(err)) && e === engine) toCpu(err);
      return;
    }
    frames++;
    const shown = want;
    const rosse = {
      backend: e.backend,
      surface: wantedSurface,
      plates: wantedPlates,
      frames,
      size: e.size(),
      // what is on the plate, which may lag the controls by a frame
      preset: shown.preset,
      seed: shown.P.seed,
      counts: null as MarkCounts | null,
      home: shown.home,
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
        if (drawn !== shown || building) return;
        rosse.counts = c;
        const n = (x: number) => x.toLocaleString('en-GB');
        say(stats, `${n(c.dots)} dots · ${n(c.knots)} knots · ${n(c.stars)} stars`);
      },
      () => undefined,
    );
    document.documentElement.dataset.backend = e.backend;
    say(note, e.backend === 'cpu' ? 'drawn on the CPU' : '');
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
        const { P, zoom } = wanted;
        return { az: P.az || 0, incl: P.incl, pa: P.pa, zoom };
      },
      set: (c) => {
        page.setCamera(c);
      },
    });
  };

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
      : await cpuEngine(scene, wantedSize);

  // What the engine draws decides what the page offers, what a link may ask for and which presets
  // there are. Both engines draw the same set, so a switch to the CPU engine keeps the page.
  const capabilities = engine.capabilities;
  const urlState = parseUrlState(params, capabilities);
  surface = initialSurface(urlState.surface);
  const startPreset = urlState.from === undefined ? (urlState.preset ?? 'Grand design') : null;
  wanted = (() => {
    const P = {
      ...makeParams(startPreset ?? 'Grand design', urlState.seed ?? 7),
      ...urlState.overrides,
    };
    const { az = P.az, incl = P.incl, pa = P.pa, zoom = 1 } = urlState.view;
    // zoom is the page's (v21's ZOOM: not a parameter, a view input)
    const start = { ...P, az, incl, pa };
    return {
      P: start,
      preset: startPreset,
      ...(urlState.from !== undefined ? { from: urlState.from } : {}),
      zoom,
      // the camera the page starts at is the overlays' home (M7 reads it; the engines of M11 do not
      // draw overlays yet)
      home: orientationOf(cameraOf(start)),
    };
  })();

  // The page (src/ui/page.ts): the controls, the preset cards, the seed, the surface, the timeline
  // and the buttons. It owns what the viewer edits and reports each change here; this file draws.
  const page = mountPage({
    initial: { P: wanted.P, preset: wanted.preset, zoom: wanted.zoom, surface },
    makeParams,
    variantOverrides,
    features: capabilities,
    icon: (spec) => iconSvg(vectors, spec),
    thumb: thumbUrl,
    source: {
      backend: () => (engine ? engine.backend : 'cpu'),
      layers: () => engine?.layers() ?? [],
      device: () => engine?.device() ?? null,
      snapshot() {
        // after any frame waiting, in the queue: the pixels of what is shown
        return new Promise((resolve, reject) => {
          queue = queue
            .then(async () => {
              if (!engine) throw new Error('nothing is drawn yet');
              resolve(await engine.snapshot(surface, wanted.P.plates as Plates));
            })
            .catch(reject);
        });
      },
    },
    onChange(s, kind) {
      if (kind === 'surface') {
        // the toggle works from the start: a click before the first frame sets the surface it shows
        surface = s.surface;
        schedule();
        return;
      }
      wanted = {
        P: s.P,
        preset: s.preset,
        ...(s.from !== undefined ? { from: s.from } : {}),
        zoom: s.zoom,
        // a new drawing (a preset, a seed, Surprise me) is placed at its own orientation, which
        // becomes the overlays' home; moving the View controls or the plate does not move it
        home: kind === 'preset' ? orientationOf(cameraOf(s.P)) : wanted.home,
      };
      // a camera move waits for the next animation frame, as the orbit always did
      if (kind === 'camera') requestFrame();
      else schedule();
    },
  });
  bindOrbit();
  schedule();
  await queue;
}

start().catch((e: unknown) => {
  console.error(e);
  say(document.getElementById('note'), `Could not draw: ${String(e)}`);
});
