/**
 * The sky of a merger (ADR 0004 L1, ADR 0011): a merging pair carries the main parameters' own deep
 * field, foreground stars, trails and overlay stars, placed once by the real camera (a `skyHost`
 * scene on both engines). The GPU merger (src/render/merger.ts) against the CPU one
 * (src/fallback/merger.ts), on the same description, at the home camera, an orbit, and zoomed out
 * and in. Per case:
 *
 * - the layers: the same count, in the same order, of the same kind and atlas;
 * - the sky's own layers (the background first, the foreground stars last), drawn alone on each
 *   engine's rasteriser: the ink target per pixel within 1/255 (they depend on no simulated star);
 * - the whole picture's ink, debris and galaxies included: the totals per channel within 1%
 *   (the stars are two correct integrators, ADR 0040), as plates.ts compares engine-built layers.
 */
import { presetParams } from '../../src/core/presets';
import type { Params } from '../../src/core/params';
import { CpuRenderer } from '../../src/fallback';
import { CpuMerger } from '../../src/fallback/merger';
import { BuiltAssets, type AtlasName } from '../../src/marks/atlas';
import { VECTOR_ATLASES, type VectorLibrary } from '../../src/marks/vector';
import { drawingsMeta } from '../../src/model/scene';
import { GpuRenderer } from '../../src/render/frame';
import { GpuMerger } from '../../src/render/merger';
import { GpuStipple } from '../../src/render/stipple';
import { INSTANCE_WORDS } from '../../src/fallback/kernels/project';
import { SKY_DOTS_PER_GALAXY } from '../../src/model/sky';
import { cameraOf } from '../../src/view/camera';
import { adapterName, device, halfToFloat, readTexture, run } from './harness';

const TOL = 1 / 255;
const POS_TOL = 0.05;
const TOTAL_TOL = 0.01;
/** the values (a channel of a pixel) allowed past 1/255: a dot on a coverage edge flips one pixel */
const MAX_OVER = 8;

const CASES: [string, Params][] = [
  [
    'the Mice s7, field and foreground stars',
    presetParams('Merger: the Mice', 7, { field: 0.6, fgstars: 0.6, ovStar: 0 }),
  ],
  [
    'the Mice s7, overlay star, trail, companions',
    presetParams('Merger: the Mice', 7, {
      field: 0.5,
      fgstars: 0.5,
      companions: 0.8,
      ovStar: 1,
      trails: 1,
    }),
  ],
  [
    'lensed merger s4242, field and foreground stars',
    presetParams('Layered: lensed merger', 4242, { field: 0.6, fgstars: 0.6, ovStar: 0 }),
  ],
  [
    'spiral meets elliptical s7, natural dust and bulge',
    presetParams('Merger: spiral meets elliptical', 7, {
      field: 0.6,
      fgstars: 0.6,
      dustAuto: 1,
      bulgeAuto: 1,
    }),
  ],
];

run('merger sky and overlays (GPU = CPU, L1)', async () => {
  const { adapter, device: dev } = await device();
  const assets = await BuiltAssets.load('/');
  const names: AtlasName[] = ['dots', 'knots', 'stars', 'cores', 'fgstars', 'pieces', 'strokes'];
  const [atlases, paper, sheets] = await Promise.all([
    Promise.all(names.map((n) => assets.atlas(n))),
    assets.paper(),
    Promise.all(VECTOR_ATLASES.map((n) => assets.vector(n))),
  ]);
  const lib = Object.fromEntries(VECTOR_ATLASES.map((n, i) => [n, sheets[i]])) as VectorLibrary;
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
      fgstars: by('fgstars'),
      strokes: by('strokes'),
    },
    lib.penlines,
    lib,
  );
  const strict = /swiftshader/i.test(adapterName(adapter));
  const size = { plateCss: 800, dpr: 1 };
  const gpuR = new GpuRenderer(dev, size, paper);
  const cpuR = new CpuRenderer(size, paper);
  for (const a of atlases) {
    gpuR.addAtlas(a);
    cpuR.addAtlas(a);
  }
  const lines = [`adapter: ${adapterName(adapter)}`];
  let pass = true;
  const data: Record<string, unknown> = {};
  let worstSky = 0;
  let worstTotal = 0;

  /** the GPU ink target, as floats */
  const gpuInk = async () =>
    new Uint16Array((await readTexture(dev, gpuR.ink, 8)).buffer).map((h) => h);
  const compareInk = async (): Promise<{
    max: number;
    over: number;
    gpu: number[];
    cpu: number[];
  }> => {
    const half = await gpuInk();
    let max = 0;
    let over = 0;
    const gpu = [0, 0, 0, 0];
    const cpu = [0, 0, 0, 0];
    for (let i = 0; i < half.length; i++) {
      const g = halfToFloat(half[i] ?? 0);
      const c = cpuR.ink.data[i] ?? 0;
      max = Math.max(max, Math.abs(g - c));
      if (Math.abs(g - c) > TOL) over++;
      gpu[i % 4] = (gpu[i % 4] ?? 0) + g;
      cpu[i % 4] = (cpu[i % 4] ?? 0) + c;
    }
    return { max, over, gpu, cpu };
  };

  for (const [name, P0] of CASES) {
    const az0 = P0.az;
    const incl0 = P0.incl;
    const cpuM = new CpuMerger(P0, meta);
    const gpuM = GpuMerger.create(dev);
    await gpuM.build(P0, meta);
    for (const [cam, zoom, az, incl] of [
      ['home', 1, 0, 0],
      ['orbit', 1, 35, 20],
      ['zoom 0.4', 0.4, 0, 0],
      ['zoom 2.5', 2.5, 0, 0],
    ] as [string, number, number, number][]) {
      const label = `${name}, ${cam}`;
      const bad: string[] = [];
      // an orbit moves the main parameters' camera; both engines read it from the scene's P
      for (const m of [cpuM.scene.P, gpuM.scene?.P]) {
        if (!m) continue;
        m.az = az0 + az;
        m.incl = Math.min(180, incl0 + incl);
      }
      const cv = cpuM.view(zoom);
      gpuM.view(zoom);
      await dev.queue.onSubmittedWorkDone();
      const gl = gpuM.inkLayers();
      const cl = cv.layers;
      // the CPU leaves out a layer with nothing in it (zoomed in, a list can be empty); the GPU
      // keeps its fixed list, so it may hold more. The order of the kinds still agrees where both
      // have a layer, and the ink says whether an empty one is empty.
      const kind = (k: string) => k.replace(/^gpu-/, '');
      if (gl.length < cl.length) bad.push(`layers ${String(gl.length)} < ${String(cl.length)}`);
      else if (gl.length === cl.length)
        gl.forEach((g, i) => {
          const c = cl[i];
          if (c && kind(g.kind) !== kind(c.kind) && bad.length < 3)
            bad.push(`layer ${String(i)}: ${g.kind} ≠ ${c.kind}`);
        });
      // the sky host's own list, as tests/gpu/sky.ts reads it: the galaxies that survive the cull,
      // and their dots
      const host = (gpuM as unknown as { skyHost: GpuStipple | null }).skyHost;
      const cView = cpuM.skyHost?.view(cameraOf(cpuM.scene.P, zoom), cpuM.scene.P.mTime);
      const cHost = cView?.sky;
      if (host && cHost) {
        const g = await host.sky.readBack();
        if (g.nVis !== cHost.visible.length)
          bad.push(`visible galaxies ${String(g.nVis)} ≠ ${String(cHost.visible.length)}`);
        else {
          let at = 0;
          let maxPos = 0;
          cHost.visible.forEach((v, k) => {
            for (let j = 0; j < v.np; j++, at++) {
              const og = (k * SKY_DOTS_PER_GALAXY + j) * INSTANCE_WORDS;
              const oc = at * INSTANCE_WORDS;
              maxPos = Math.max(
                maxPos,
                Math.hypot(
                  (g.dots[og] ?? 0) - (cHost.dots[oc] ?? 0),
                  (g.dots[og + 1] ?? 0) - (cHost.dots[oc + 1] ?? 0),
                ),
              );
            }
          });
          if (!(maxPos <= POS_TOL)) bad.push(`sky dots off by ${maxPos.toFixed(3)} px`);
          lines.push(
            `  ${label}: ${String(g.nVis)} galaxies, dots within ${maxPos.toExponential(2)} px`,
          );
        }
      }
      let sky = 0;
      let overN = 0;
      let total = 0;
      if (bad.length === 0) {
        // the sky's own layers: the background first and the foreground stars last
        // the sky host's own lists, from each engine: the background first, the foreground stars last
        const isFg = (l: unknown) => (l as { atlas?: string }).atlas === 'fgstars';
        const hl = host?.hostLayers();
        const gb = hl?.back ?? [];
        const gf = (hl?.front ?? []).filter(isFg).slice(-1);
        const cb = cView?.layers.slice(0, cView.nBack) ?? [];
        const cf = (cView?.layers.slice(cView.nBack) ?? []).filter(isFg).slice(-1);
        if (gb.length < cb.length || gf.length < cf.length)
          bad.push(`sky layers: background ${String(gb.length)}/${String(cb.length)}`);
        for (const [tag, a, b] of [
          ['background', gb, cb],
          ['foreground', gf, cf],
        ] as const) {
          gpuR.setLayers(a);
          gpuR.drawInk();
          cpuR.setLayers(b);
          cpuR.drawInk();
          const one = await compareInk();
          if (strict && one.over > MAX_OVER)
            lines.push(
              `  ${label}: ${tag} ${String(one.over)} past 1/255, max ${one.max.toFixed(4)}`,
            );
        }
        gpuR.setLayers([...gb, ...gf]);
        gpuR.drawInk();
        cpuR.setLayers([...cb, ...cf]);
        cpuR.drawInk();
        const skyInk = await compareInk();
        sky = skyInk.max;
        overN = skyInk.over;
        // the raster is held to 1/255 where it was established, on SwiftShader; a hardware adapter
        // filters the atlas differently (the same gap as tests/gpu/sky.ts), and only the totals
        // below are gated there (ADR 0015)
        if (strict && skyInk.over > MAX_OVER)
          bad.push(
            `sky raster: ${String(skyInk.over)} values off by more than 1/255 (max ${sky.toFixed(4)})`,
          );
        // the whole picture
        gpuR.setLayers(gl);
        gpuR.drawInk();
        cpuR.setLayers(cl);
        cpuR.drawInk();
        const t = await compareInk();
        for (let k = 0; k < 4; k++) {
          const c = t.cpu[k] ?? 0;
          const d = c > 0 ? Math.abs((t.gpu[k] ?? 0) - c) / c : 0;
          total = Math.max(total, d);
        }
        if (total > TOTAL_TOL) bad.push(`ink total differs by ${(100 * total).toFixed(2)}%`);
      }
      worstSky = Math.max(worstSky, sky);
      worstTotal = Math.max(worstTotal, total);
      const ok = bad.length === 0;
      if (!ok) pass = false;
      lines.push(
        `${ok ? 'ok  ' : 'FAIL'} ${label}: ${String(cl.length)} layers; sky raster max |Δ| ${sky.toFixed(5)} (${String(overN)} past 1/255); ink total Δ ${(100 * total).toFixed(3)}%${ok ? '' : `; ${bad.join('; ')}`}`,
      );
      data[label] = { sky, total, bad };
    }
  }
  lines.push(
    `worst: sky raster ${worstSky.toFixed(5)} (≤ 1/255 on SwiftShader), ink total ${(100 * worstTotal).toFixed(3)}% (≤ 1%)`,
  );
  gpuR.destroy();
  return { pass, lines, data: { cases: data, worstSky, worstTotal } };
});
