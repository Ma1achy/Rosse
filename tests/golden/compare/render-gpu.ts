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
import { VECTOR_ATLASES, type VectorLibrary } from '../../../src/marks/vector';
import {
  buildScene,
  drawingsMeta,
  type MarkCounts,
  type SceneOptions,
} from '../../../src/model/scene';
import { GpuRenderer } from '../../../src/render/frame';
import { GpuStipple } from '../../../src/render/stipple';
import { GpuMerger } from '../../../src/render/merger';
import { GpuShells } from '../../../src/render/shells';
import { buildShellScene } from '../../../src/model/shells';
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
  const renderer = new GpuRenderer(device, { plateCss: 800, dpr: 1 }, paper);
  for (const a of atlases) renderer.addAtlas(a);
  const stipple = GpuStipple.create(device);
  const merger = GpuMerger.create(device);
  const shells = GpuShells.create(device);
  const info = adapter.info;
  window.__golden = {
    adapter: [info.vendor, info.architecture, info.description].filter(Boolean).join(' / '),
    async render(P, opts, zoom = 1) {
      const t0 = performance.now();
      let layers;
      let readCounts: () => Promise<{ counts: MarkCounts }>;
      if (P.merger) {
        // a merger (M8): the simulation, then each galaxy carried by its tides
        const { merger: mopts, placementKey, shells: sopts, dotScale } = opts;
        await merger.build(P, meta, {
          ...mopts,
          ...(dotScale !== undefined ? { dotScale } : {}),
          ...(sopts ? { shells: sopts } : {}),
          ...(placementKey !== undefined ? { placementKey } : {}),
        });
        merger.view(zoom);
        layers = merger.inkLayers();
        readCounts = () => merger.readCounts();
      } else {
        const scene = buildScene(P, meta, opts);
        stipple.setScene(scene);
        stipple.setView(cameraOf(P, zoom));
        layers = stipple.inkLayers();
        readCounts = () => stipple.readCounts();
        if (P.shellsOn && stipple.current) {
          // the simulated shells (M8): the satellite's dots and the arcs, which ignore the camera
          await shells.build(
            buildShellScene(P, meta, stipple.current.variation, {
              ...opts.shells,
              ...(opts.placementKey !== undefined ? { placementKey: opts.placementKey } : {}),
            }),
          );
          shells.view(zoom);
          layers = [...layers, ...shells.layers()];
          readCounts = async () => {
            const r = await stipple.readCounts();
            return { counts: { ...r.counts, dots: r.counts.dots + shells.count } };
          };
        }
      }
      renderer.setLayers(layers);
      renderer.drawInk();
      const half = new Uint16Array((await readTexture(device, renderer.ink, 8)).buffer);
      const n = renderer.width * renderer.height;
      const alpha = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const a = halfToFloat(half[i * 4 + 3] ?? 0);
        alpha[i] = Math.round(Math.min(1, Math.max(0, a)) * 255);
      }
      const { counts } = await readCounts();
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
