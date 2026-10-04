/**
 * The WebGPU engine for the golden runner: a page (tests/golden/render.html) that renders a
 * case's parameters with the compute passes and the sprite pipeline, and hands the ink's α back
 * to ./compare.mjs through `window.__golden`. Read-back is fine here: this is a test, not the
 * frame path.
 */
import type { Params } from '../../../src/core/params';
import { requestDevice } from '../../../src/gpu/device';
import { readTexture } from '../../../src/gpu/readback';
import { BuiltAssets, type AtlasName } from '../../../src/marks/atlas';
import { coreInstances } from '../../../src/model/parts';
import {
  buildScene,
  drawingsMeta,
  type MarkCounts,
  type SceneOptions,
} from '../../../src/model/scene';
import { GpuRenderer } from '../../../src/render/frame';
import type { InkLayer } from '../../../src/render/layers';
import { GpuStipple } from '../../../src/render/stipple';
import { cameraOf } from '../../../src/view/camera';

export interface GoldenRender {
  /** α, 8 bits per pixel, base64 */
  alpha: string;
  width: number;
  height: number;
  counts: MarkCounts;
  ms: number;
}

declare global {
  interface Window {
    __golden?: {
      adapter: string;
      render(P: Params, opts: SceneOptions, zoom?: number): Promise<GoldenRender>;
    };
    __goldenError?: string;
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
  const names: AtlasName[] = ['dots', 'knots', 'stars', 'cores'];
  const [atlases, paper] = await Promise.all([
    Promise.all(names.map((n) => assets.atlas(n))),
    assets.paper(),
  ]);
  const by = (n: string) => {
    const a = atlases.find((x) => x.name === n);
    if (!a) throw new Error(`atlas ${n} missing`);
    return a;
  };
  const meta = drawingsMeta({
    dots: by('dots'),
    knots: by('knots'),
    stars: by('stars'),
    cores: by('cores'),
  });
  const renderer = new GpuRenderer(device, { plateCss: 800, dpr: 1 }, paper);
  for (const a of atlases) renderer.addAtlas(a);
  const stipple = GpuStipple.create(device);
  const info = adapter.info;
  window.__golden = {
    adapter: [info.vendor, info.architecture, info.description].filter(Boolean).join(' / '),
    async render(P, opts, zoom = 1) {
      const t0 = performance.now();
      const scene = buildScene(P, meta, opts);
      const cam = cameraOf(P, zoom);
      stipple.setScene(scene);
      stipple.setView(cam);
      const layers: InkLayer[] = [...stipple.layers()];
      const cores = coreInstances(P, meta, cam);
      if (cores.length) layers.push({ kind: 'sprites', atlas: 'cores', gain: 1, instances: cores });
      renderer.setLayers(layers);
      renderer.drawInk();
      const half = new Uint16Array((await readTexture(device, renderer.ink, 8)).buffer);
      const n = renderer.width * renderer.height;
      const alpha = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const a = halfToFloat(half[i * 4 + 3] ?? 0);
        alpha[i] = Math.round(Math.min(1, Math.max(0, a)) * 255);
      }
      const { counts } = await stipple.readCounts();
      return {
        alpha: base64(alpha),
        width: renderer.width,
        height: renderer.height,
        counts,
        ms: performance.now() - t0,
      };
    },
  };
}

main().catch((e: unknown) => {
  window.__goldenError = String(e instanceof Error ? (e.stack ?? e) : e);
});
