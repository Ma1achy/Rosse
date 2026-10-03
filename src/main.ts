/**
 * Entry point of the page (M1): the plate, on Paper or Chalkboard, with one dot at its centre
 * and a few more marks around it (render/sample-scene.ts).
 *
 * Flow (docs/architecture.md, "Frame"): pick the engine (WebGPU, or the CPU engine of ADR 0011
 * when WebGPU is missing, fails, or `?backend=cpu` is given), load the packed drawings, ink the
 * scene, and composite it onto the surface. Switching surface re-runs only the composite (the
 * present tier of ADR 0010). If the GPU device is lost it is recreated and everything rebuilt;
 * if that fails, the page carries on with the CPU engine.
 */
import { CpuRenderer } from './fallback';
import { Gpu, detectBackend, type Backend } from './gpu/device';
import { readTexture } from './gpu/readback';
import { BuiltAssets, type AtlasData, type AtlasName, type ImageData8 } from './marks/atlas';
import { GpuRenderer } from './render/frame';
import type { InkLayer } from './render/layers';
import { PLATE_UNITS, sampleScene } from './render/sample-scene';
import { SURFACES, type SurfaceName } from './render/surface';

declare global {
  interface Window {
    /** Set once the first frame is on the plate: which engine drew it. For tests and screenshots. */
    __rosse?: { backend: Backend; surface: SurfaceName; frames: number };
  }
}

const ATLASES: AtlasName[] = ['dots', 'knots', 'stars', 'cores', 'pieces'];

interface Engine {
  backend: Backend;
  present(surface: SurfaceName): Promise<void>;
}

function plateSize() {
  return { plateCss: PLATE_UNITS, dpr: Math.min(2, window.devicePixelRatio || 1) };
}

function freshCanvas(old: HTMLCanvasElement, width: number): HTMLCanvasElement {
  // a canvas keeps its first context type, so switching engine needs a new element
  const c = old.cloneNode() as HTMLCanvasElement;
  c.width = c.height = width;
  old.replaceWith(c);
  return c;
}

function cpuEngine(
  canvas: HTMLCanvasElement,
  atlases: AtlasData[],
  paper: ImageData8,
  layers: InkLayer[],
): Engine {
  const r = new CpuRenderer(plateSize(), paper);
  atlases.forEach((a) => {
    r.addAtlas(a);
  });
  r.setLayers(layers);
  r.drawInk();
  const c = freshCanvas(canvas, r.width);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no 2D canvas');
  return {
    backend: 'cpu',
    present(surface) {
      const out = r.present(SURFACES[surface]);
      ctx.putImageData(new ImageData(out, r.width, r.height), 0, 0);
      return Promise.resolve();
    },
  };
}

async function gpuEngine(
  canvas: HTMLCanvasElement,
  atlases: AtlasData[],
  paper: ImageData8,
  layers: InkLayer[],
  copy: boolean,
  onFailure: () => void,
  onRebuilt: () => void,
): Promise<Engine> {
  const gpu = await Gpu.create();
  const format = copy ? 'rgba8unorm' : navigator.gpu.getPreferredCanvasFormat();
  let renderer!: GpuRenderer;
  let present!: (surface: SurfaceName) => Promise<void>;
  let c = canvas;
  const build = (device: GPUDevice) => {
    renderer = new GpuRenderer(device, plateSize(), paper);
    atlases.forEach((a) => {
      renderer.addAtlas(a);
    });
    renderer.setLayers(layers);
    renderer.drawInk();
    c = freshCanvas(c, renderer.width);
    if (copy) {
      // composite into a texture, read it back and put it on a 2D canvas (see start())
      const ctx2d = c.getContext('2d');
      if (!ctx2d) throw new Error('no 2D canvas');
      const out = device.createTexture({
        size: [renderer.width, renderer.height],
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      present = async (surface) => {
        renderer.present(out.createView(), format, SURFACES[surface]);
        const px = new Uint8ClampedArray((await readTexture(device, out, 4)).buffer);
        ctx2d.putImageData(new ImageData(px, renderer.width, renderer.height), 0, 0);
      };
    } else {
      const ctx = c.getContext('webgpu');
      if (!ctx) throw new Error('no WebGPU canvas context');
      ctx.configure({ device, format, alphaMode: 'opaque' });
      present = (surface) => {
        renderer.present(ctx.getCurrentTexture().createView(), format, SURFACES[surface]);
        return Promise.resolve();
      };
    }
  };
  build(gpu.device);
  gpu.onDevice((device) => {
    build(device);
    onRebuilt();
  });
  gpu.onFailure(onFailure);
  return { backend: 'webgpu', present: (surface) => present(surface) };
}

async function start(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const forced = params.get('backend');
  // `?present=copy` reads the composite back onto a 2D canvas instead of presenting a WebGPU
  // canvas. Chromium's SwiftShader WebGPU loses the device when a WebGPU canvas is presented
  // headless, so the screenshot tool uses this; it is never the default.
  const copy = params.get('present') === 'copy';
  const note = document.getElementById('note');
  const canvas = document.getElementById('plate');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('#plate is missing');

  const assets = await BuiltAssets.load(import.meta.env.BASE_URL);
  const [atlases, paper] = await Promise.all([
    Promise.all(ATLASES.map((n) => assets.atlas(n))),
    assets.paper(),
  ]);
  const layerCount = (n: AtlasName) => atlases.find((a) => a.name === n)?.layers ?? 1;
  const dotSizes = (atlases[0]?.meta.size ?? []) as number[];
  const layers = sampleScene(dotSizes, {
    dots: layerCount('dots'),
    knots: layerCount('knots'),
    stars: layerCount('stars'),
    cores: layerCount('cores'),
    pieces: layerCount('pieces'),
  });

  let surface: SurfaceName = 'paper';
  let frames = 0;
  let engine: Engine;
  const show = async () => {
    await engine.present(surface);
    frames++;
    window.__rosse = { backend: engine.backend, surface, frames };
    document.documentElement.dataset.backend = engine.backend;
    if (note) note.textContent = engine.backend === 'cpu' ? 'drawn on the CPU' : '';
  };
  const toCpu = () => {
    const current = document.getElementById('plate');
    if (current instanceof HTMLCanvasElement) {
      engine = cpuEngine(current, atlases, paper, layers);
      void show();
    }
  };

  const backend = await detectBackend(
    navigator,
    forced === 'cpu' || forced === 'webgpu' ? forced : null,
  );
  if (backend === 'webgpu') {
    try {
      engine = await gpuEngine(canvas, atlases, paper, layers, copy, toCpu, () => {
        void show();
      });
    } catch (e) {
      console.warn('WebGPU failed, using the CPU engine:', e);
      engine = cpuEngine(canvas, atlases, paper, layers);
    }
  } else {
    engine = cpuEngine(canvas, atlases, paper, layers);
  }
  await show();

  document.querySelectorAll<HTMLButtonElement>('button[data-surface]').forEach((b) => {
    b.addEventListener('click', () => {
      surface = b.dataset.surface === 'chalk' ? 'chalk' : 'paper';
      document.querySelectorAll('button[data-surface]').forEach((o) => {
        o.setAttribute('aria-pressed', String(o === b));
      });
      void show();
    });
  });
}

start().catch((e: unknown) => {
  console.error(e);
  const note = document.getElementById('note');
  if (note) note.textContent = `Could not draw: ${String(e)}`;
});
