/**
 * The CPU engine's profile (M10), in Node on one thread: for each scenario, the model tier
 * (`buildScene` and the stipple kernel), the view tier (projection, culls, compaction, the line-work
 * and vector kernels), the rasteriser (`CpuRenderer.drawInk`) and the composite
 * (`CpuRenderer.present`). An orbit frame is view + ink + present; a parameter change adds the
 * model tier. Loaded by tools/perf/perf.mjs through Vite's SSR loader.
 *
 * The page runs the same code in a worker (src/fallback/worker.ts); the worker's own cost is the
 * same, and what the worker changes (the main thread is not blocked) is measured in the browser by
 * tools/perf/worker.mjs.
 */
import type { Params } from '../../src/core/params';
import { presetParams } from '../../src/core/presets';
import { CpuRenderer } from '../../src/fallback';
import { CpuStipple } from '../../src/fallback/stipple';
import { PALETTES } from '../../src/render/palette';
import { SURFACES } from '../../src/render/surface';
import { buildScene } from '../../src/model/scene';
import { cameraOf } from '../../src/view/camera';
import { loadAtlases, loadVectors, metaOf } from '../golden/compare/engine-cpu';
import type { Scenario, Stat } from './perf';

export interface CpuScenarioResult {
  name: string;
  preset: string;
  marks: number;
  sceneMs: Stat;
  modelMs: Stat;
  viewMs: Stat;
  inkMs: Stat;
  presentMs: Stat;
  /** view + ink + present */
  orbitFrameMs: Stat;
  /** scene + model + view + ink + present */
  firstFrameMs: Stat;
}

function stat(xs: number[]): Stat {
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number) =>
    s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))] ?? 0;
  return { median: at(0.5), p95: at(0.95), min: s[0] ?? 0, max: s[s.length - 1] ?? 0, n: s.length };
}

export function benchCpu(
  root: string,
  scenarios: Scenario[],
  opts: { orbitFrames: number; modelRuns: number; plateCss: number; dpr: number },
): CpuScenarioResult[] {
  const atlases = loadAtlases(root);
  const vectors = loadVectors(root);
  const meta = metaOf(atlases, vectors.penlines, vectors);
  // the paper's size matters to the composite (a 512 × 512 tile, as the packed one); its pixels do not
  const paper = { width: 512, height: 512, data: new Uint8Array(512 * 512 * 4).fill(236) };
  const out: CpuScenarioResult[] = [];
  for (const sc of scenarios) {
    // the merger's simulation has no CPU path in this bench (its twin is checked in tests/gpu/merger.ts)
    if (presetParams(sc.preset, 7, sc.overrides ?? {}).merger) continue;
    const renderer = new CpuRenderer({ plateCss: opts.plateCss, dpr: opts.dpr }, paper);
    for (const a of atlases) renderer.addAtlas(a);
    const seed0 = sc.seed ?? 7;
    const params = (seed: number): Params => presetParams(sc.preset, seed, sc.overrides ?? {});
    const ink = (view: ReturnType<CpuStipple['view']>) => {
      const t = performance.now();
      renderer.setLayers(view.layers);
      renderer.drawInk({ plates: 'ink', palette: PALETTES.light });
      return performance.now() - t;
    };
    const present = () => {
      const t = performance.now();
      renderer.present(SURFACES.paper);
      return performance.now() - t;
    };
    // warm up (JIT, the first atlas touch)
    {
      const P = params(seed0);
      const s = new CpuStipple(buildScene(P, meta, {}));
      ink(s.view(cameraOf(P, 1)));
      present();
    }
    const sceneMs: number[] = [];
    const modelMs: number[] = [];
    const viewMs: number[] = [];
    const inkMs: number[] = [];
    const presentMs: number[] = [];
    const first: number[] = [];
    let marks = 0;
    for (let k = 0; k < opts.modelRuns; k++) {
      const P = params(seed0 + 1 + k);
      const t0 = performance.now();
      const scene = buildScene(P, meta, {});
      const t1 = performance.now();
      const s = new CpuStipple(scene);
      const t2 = performance.now();
      const view = s.view(cameraOf(P, 1));
      const t3 = performance.now();
      const ti = ink(view);
      const tp = present();
      sceneMs.push(t1 - t0);
      modelMs.push(t2 - t1);
      viewMs.push(t3 - t2);
      inkMs.push(ti);
      presentMs.push(tp);
      first.push(t1 - t0 + (t2 - t1) + (t3 - t2) + ti + tp);
      marks = view.counts.dots + view.counts.knots + view.counts.stars;
    }
    // the orbit, on one model
    const P0 = params(seed0);
    const s = new CpuStipple(buildScene(P0, meta, {}));
    const orbit: number[] = [];
    const oView: number[] = [];
    const oInk: number[] = [];
    const oPresent: number[] = [];
    for (let k = 0; k < opts.orbitFrames; k++) {
      const P = { ...P0, az: (P0.az + 3 * (k + 1)) % 360 };
      const t0 = performance.now();
      const view = s.view(cameraOf(P, 1));
      const t1 = performance.now();
      const ti = ink(view);
      const tp = present();
      orbit.push(performance.now() - t0);
      oView.push(t1 - t0);
      oInk.push(ti);
      oPresent.push(tp);
    }
    out.push({
      name: sc.name,
      preset: sc.preset,
      marks,
      sceneMs: stat(sceneMs),
      modelMs: stat(modelMs),
      viewMs: stat(oView.length ? oView : viewMs),
      inkMs: stat(oInk.length ? oInk : inkMs),
      presentMs: stat(oPresent.length ? oPresent : presentMs),
      orbitFrameMs: stat(orbit),
      firstFrameMs: stat(first),
    });
  }
  return out;
}
