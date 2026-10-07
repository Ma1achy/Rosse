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
import { PRESET_NAMES, presetParams } from '../../src/core/presets';
import { requestDevice } from '../../src/gpu/device';
import { readTexture } from '../../src/gpu/readback';
import { BuiltAssets, type AtlasName } from '../../src/marks/atlas';
import { VECTOR_ATLASES, type VectorLibrary } from '../../src/marks/vector';
import { drawingsMeta } from '../../src/model/scene';
import type { DrawingsMeta } from '../../src/model/variation';
import { GpuRenderer } from '../../src/render/frame';
import { GpuMerger } from '../../src/render/merger';
import { GpuShells } from '../../src/render/shells';
import { lensOpts } from '../../src/render/page-key';
import type { InkLayer } from '../../src/render/layers';
import { buildShellScene } from '../../src/model/shells';
import { cameraOf, orientationOf } from '../../src/view/camera';
import { CatalogueService } from '../../src/extras/catalogue/service';
import { ofType, type GalaxyType } from '../../src/extras/catalogue/tools';
import { fieldValue, type Field } from '../../src/extras/catalogue/fields';
import { realCards } from '../../src/extras/real/real-galaxies';
import { PALETTES } from '../../src/render/palette';
import type { Plates } from '../../src/render/plates';
import { GpuStipple } from '../../src/render/stipple';
import { SURFACES, type SurfaceName } from '../../src/render/surface';

/** how a catalogue galaxy is picked: the category, and the vote fields its score is the maximum of */
export interface Rule {
  id: string;
  type: GalaxyType;
  fields: Field[];
}

export interface Shot {
  preset: string;
  seed: number;
  /** a full parameter set (a real or catalogue galaxy), instead of the preset's */
  params?: Params;
  /** parameter overrides laid over the preset */
  over?: Partial<Params>;
  az?: number;
  incl?: number;
  pa?: number;
  zoom?: number;
  /** the merger's moment, 0 to 1 (`mTime`) */
  mTime?: number;
  plates?: Plates;
  /**
   * Keep only these kinds of mark (the mark-anatomy figure): `dots`, `knots`, `strokes` (arm
   * ribbons and arm pieces), `drawings` (pen lines and whole drawings), `stars` (drawn stars and
   * cores). Absent: every layer.
   */
  only?: string[];
}

/** which kind of mark a layer is, for the anatomy figure */
function roleOf(l: InkLayer): string {
  if (l.kind === 'ribbons' || l.kind === 'gpu-ribbons') return 'strokes';
  if (l.kind === 'capsules' || l.kind === 'gpu-capsules') return 'drawings';
  switch (l.atlas) {
    case 'dots':
      return 'dots';
    case 'knots':
      return 'knots';
    case 'pieces':
      return 'strokes';
    case 'stars':
    case 'cores':
      return 'stars';
    default:
      return l.svgLayer === 'background' ? 'sky' : 'drawings';
  }
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
      presetNames(): string[];
      /** the 42 real galaxies: id, caption, description and the parameters Rosse draws */
      reals(): unknown[];
      /** per rule: the catalogue galaxy of the highest vote fraction, with its card */
      gz2(url: string, rules: Rule[]): Promise<unknown[]>;
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
  let shells: GpuShells | null = null;
  let shellsKey = '';

  window.__ra = {
    adapter: [adapter.info.vendor, adapter.info.architecture, adapter.info.description]
      .filter(Boolean)
      .join(' / '),
    presetNames: () => [...PRESET_NAMES],
    reals() {
      return realCards().map((c, i) => ({
        index: i,
        id: c.galaxy.id,
        ra: c.galaxy.ra,
        dec: c.galaxy.dec,
        photo: c.galaxy.photo,
        caption: c.caption,
        description: c.description,
        votes: c.galaxy.votes,
        params: c.params,
      }));
    },
    async gz2(url, rules) {
      const svc = new CatalogueService();
      await svc.load(url);
      const cat = svc.cat;
      if (!cat) throw new Error('no catalogue');
      const out: unknown[] = [];
      for (const r of rules) {
        let best = -1;
        let bs = -1;
        let bn = -1;
        let bid = 0n;
        const idx = ofType(cat, r.type);
        for (const i of idx) {
          // the score: the largest of the fields' vote fractions, clamped to 1 (a byte is /15, and
          // 16 or 17 are rounding headroom); ties go to the most volunteers, then the lowest id
          const sc = Math.min(1, Math.max(...r.fields.map((f) => fieldValue(cat, f, i) ?? 0)));
          const n = (cat.cols.nvotes as Uint8Array)[i] as number;
          const id = cat.objid[i] as bigint;
          if (sc > bs || (sc === bs && (n > bn || (n === bn && id < bid)))) {
            best = i;
            bs = sc;
            bn = n;
            bid = id;
          }
        }
        const card = svc.card(best);
        out.push({
          id: r.id,
          type: r.type,
          fields: r.fields,
          matches: idx.length,
          score: bs,
          card: {
            objid: card.galaxy.objid,
            ra: card.galaxy.ra,
            dec: card.galaxy.dec,
            n: card.galaxy.n,
            seed: card.galaxy.seed,
            votes: card.galaxy.votes,
            q: card.galaxy.q,
            pa: card.galaxy.pa,
            caption: card.caption.shortType,
            sentence: card.caption.text,
          },
          params: card.mapping.p,
        });
      }
      return out;
    },
    setSize(plateCss, dpr) {
      size = { plateCss, dpr };
      renderer.resize(size);
      out?.destroy();
      out = null;
    },
    async shot(s) {
      const base = s.params ?? presetParams(s.preset, s.seed, s.over ?? {});
      // the overlays' home: the preset's own camera, whatever the shot's angles (as the page)
      const home = orientationOf(cameraOf(base));
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
      let layers: readonly InkLayer[];
      if (P.merger) {
        const key = JSON.stringify([s.preset, s.seed, s.over, s.params]);
        if (key !== mergerKey) {
          await merger.build({ ...P }, meta, P.lensOn ? { lens: lensOpts(P, home) } : {});
          mergerKey = key;
        }
        if (merger.scene)
          Object.assign(merger.scene.P, { az: P.az, incl: P.incl, pa: P.pa, winding: P.winding });
        merger.view(zoom, P.mTime);
        layers = merger.inkLayers();
        counts = { ...(await merger.readCounts()).counts };
      } else {
        mergerKey = '';
        stipple.frame(P, zoom, meta, { home, ...lensOpts(P, home) });
        layers = stipple.inkLayers();
        counts = { ...(await stipple.readCounts()).counts };
        if (P.shellsOn && stipple.current) {
          shells ??= GpuShells.create(device);
          const key = JSON.stringify([s.preset, s.seed, s.over, s.params]);
          if (shellsKey !== key) {
            await shells.build(buildShellScene(P, meta, stipple.current.variation));
            shellsKey = key;
          }
          shells.view(zoom);
          layers = [...layers, ...shells.layers()];
        }
      }
      const only = s.only;
      renderer.setLayers(only ? layers.filter((l) => only.includes(roleOf(l))) : layers);
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
