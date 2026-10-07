/**
 * The headless render page of the README asset script (tools/readme-assets/build.mjs). It draws
 * a preset with the engine's own picks (the same code path as the app's plate, src/main.ts, and
 * for mergers the M8 merger passes) on WebGPU, and hands the result back to Node: either the ink's
 * alpha (8 bits, so the posters can lay it on their own paper) or the plate as the app shows it
 * (ink composited onto Paper or Chalkboard). Read-back is fine here: this is an offline tool,
 * not the frame path.
 *
 * It changes nothing in the engine: it only calls its public classes the way
 * tests/golden/compare/render-gpu.ts and src/main.ts do.
 */
import type { Params } from '../../src/core/params';
import { presetParams } from '../../src/core/presets';
import { requestDevice } from '../../src/gpu/device';
import { readTexture } from '../../src/gpu/readback';
import { BuiltAssets, type AtlasName } from '../../src/marks/atlas';
import { VECTOR_ATLASES, type VectorLibrary } from '../../src/marks/vector';
import { drawingsMeta } from '../../src/model/scene';
import type { DrawingsMeta } from '../../src/model/variation';
import { GpuRenderer } from '../../src/render/frame';
import { GpuMerger } from '../../src/render/merger';
import { PALETTES } from '../../src/render/palette';
import type { Plates } from '../../src/render/plates';
import { GpuStipple } from '../../src/render/stipple';
import { SURFACES, type SurfaceName } from '../../src/render/surface';

export interface Shot {
  preset: string;
  seed: number;
  /** parameter overrides laid over the preset */
  over?: Partial<Params>;
  az?: number;
  incl?: number;
  pa?: number;
  zoom?: number;
  /** the merger's moment, 0 to 1 (`mTime`) */
  mTime?: number;
  plates?: Plates;
}

declare global {
  interface Window {
    __ra?: {
      adapter: string;
      /** the plate size in CSS px and the device pixel ratio the ink is drawn at */
      setSize(plateCss: number, dpr: number): void;
      /** build the scene (model tier) and draw the ink */
      shot(s: Shot): Promise<{ width: number; height: number; counts: Record<string, number> }>;
      /** the ink drawn last: α, 8 bits per pixel, base64 */
      alpha(): Promise<string>;
      /** the ink drawn last, composited onto a surface as the app does: RGBA8, base64 */
      plate(surface: SurfaceName): Promise<string>;
    };
    __raError?: string;
  }
}

function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function main(): Promise<void> {
  const { adapter, device } = await requestDevice(navigator);
  device.addEventListener('uncapturederror', (e) => {
    console.error('WebGPU error:', e.error.message);
  });
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
  const meta: DrawingsMeta = drawingsMeta(
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
  let size = { plateCss: 800, dpr: 1 };
  const renderer = new GpuRenderer(device, size, paper);
  for (const a of atlases) renderer.addAtlas(a);
  const stipple = GpuStipple.create(device);
  const merger = GpuMerger.create(device);
  let out: GPUTexture | null = null;
  let plates: Plates = 'ink';
  // the merger's built scene is kept between shots with the same preset, seed and overrides, so a
  // timeline only runs the view tier per frame
  let mergerKey = '';

  window.__ra = {
    adapter: [adapter.info.vendor, adapter.info.architecture, adapter.info.description]
      .filter(Boolean)
      .join(' / '),
    setSize(plateCss, dpr) {
      size = { plateCss, dpr };
      renderer.resize(size);
      out?.destroy();
      out = null;
    },
    async shot(s) {
      const base = presetParams(s.preset, s.seed, s.over ?? {});
      const P: Params = {
        ...base,
        ...(s.az !== undefined ? { az: s.az } : {}),
        ...(s.incl !== undefined ? { incl: s.incl } : {}),
        ...(s.pa !== undefined ? { pa: s.pa } : {}),
        ...(s.mTime !== undefined ? { mTime: s.mTime } : {}),
        ...(s.plates ? { plates: s.plates } : {}),
      };
      const zoom = s.zoom ?? 1;
      plates = P.plates as Plates;
      let counts: Record<string, number>;
      if (P.merger) {
        const key = JSON.stringify([s.preset, s.seed, s.over]);
        if (key !== mergerKey) {
          await merger.build({ ...P }, meta);
          mergerKey = key;
        }
        merger.view(zoom, P.mTime);
        renderer.setLayers(merger.inkLayers());
        counts = { ...(await merger.readCounts()).counts };
      } else {
        mergerKey = '';
        stipple.frame(P, zoom, meta);
        renderer.setLayers(stipple.inkLayers());
        counts = { ...(await stipple.readCounts()).counts };
      }
      renderer.drawInk({
        plates,
        palette: PALETTES.light,
      });
      return { width: renderer.width, height: renderer.height, counts };
    },
    async alpha() {
      const half = new Uint16Array((await readTexture(device, renderer.ink, 8)).buffer);
      const n = renderer.width * renderer.height;
      const alpha = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const a = halfToFloat(half[i * 4 + 3] ?? 0);
        alpha[i] = Math.round(Math.min(1, Math.max(0, a)) * 255);
      }
      return base64(alpha);
    },
    async plate(surface) {
      const w = renderer.width;
      out ??= device.createTexture({
        size: [w, w],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      renderer.drawInk({
        plates,
        palette: surface === 'chalk' ? PALETTES.dark : PALETTES.light,
      });
      renderer.present(out.createView(), 'rgba8unorm', SURFACES[surface]);
      const px = await readTexture(device, out, 4);
      return base64(new Uint8Array(px.buffer, px.byteOffset, px.byteLength));
    },
  };
}

main().catch((e: unknown) => {
  window.__raError = String(e instanceof Error ? (e.stack ?? e) : e);
});
