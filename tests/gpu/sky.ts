/**
 * The deep field and the foreground stars (ADR 0004 L1, ADR 0011, 0014): compute/sky.wgsl against
 * its CPU twin (src/fallback/kernels/sky.ts), and the inked background and foreground layers
 * against the software rasteriser.
 *
 * Per case (a deep field of up to 1,793 galaxies, with foreground stars and companions, at the
 * home camera, an orbit, a zoomed-out and a zoomed-in view, and under the mass shear):
 * - the galaxies that survive the cull: the same count (and so the same set, in catalogue order);
 * - their dots, slot by slot: positions within 0.05 plate px, the same drawings;
 * - the foreground stars: the same ones kept, positions within 0.05 px;
 * - the galaxies' drawings (the dynamic vector set): the same capsules, within 0.05 px;
 * - the ink: the GPU's ink target against the CPU's, per pixel, within 1/255.
 */
import { presetParams } from '../../src/core/presets';
import type { Params } from '../../src/core/params';
import { CpuRenderer } from '../../src/fallback';
import { CpuStipple } from '../../src/fallback/stipple';
import { INSTANCE_WORDS } from '../../src/fallback/kernels/project';
import { BuiltAssets, type AtlasName } from '../../src/marks/atlas';
import { VECTOR_ATLASES, type VectorLibrary } from '../../src/marks/vector';
import { CAPSULE_WORDS } from '../../src/model/ribbons';
import { buildScene, drawingsMeta } from '../../src/model/scene';
import { SKY_DOTS_PER_GALAXY } from '../../src/model/sky';
import { GpuRenderer } from '../../src/render/frame';
import { GpuStipple } from '../../src/render/stipple';
import { cameraOf } from '../../src/view/camera';
import { adapterName, device, halfToFloat, readTexture, run } from './harness';

const POS_TOL = 0.05;

const BASE: [string, Params][] = [
  ['Deep field s7 (massive)', presetParams('Deep field', 7)],
  [
    'Star: bright s4242, field 0.5',
    presetParams('Star: bright, with spikes', 4242, { companions: 0.6 }),
  ],
  [
    'Grand design s7, field 1, companions',
    presetParams('Grand design', 7, { field: 1, fgstars: 0.8, companions: 1 }),
  ],
  ['Hand wobble s11, field 0.6', presetParams('Hand wobble', 11, { field: 0.6 })],
];

run('deep field and foreground stars (GPU = CPU, L1)', async () => {
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
  const size = { plateCss: 800, dpr: 1 };
  const gpuR = new GpuRenderer(dev, size, paper);
  const cpuR = new CpuRenderer(size, paper);
  for (const a of atlases) {
    gpuR.addAtlas(a);
    cpuR.addAtlas(a);
  }
  const st = GpuStipple.create(dev);
  const lines = [`adapter: ${adapterName(adapter)}`];
  let pass = true;
  const data: Record<string, unknown> = {};
  let worstPos = 0;
  let worstPx = 0;
  const totals = { galaxies: 0, dots: 0, caps: 0, fg: 0 };

  for (const [name, P0] of BASE)
    for (const [cam, P, zoom] of [
      ['home', P0, 1],
      ['orbit', { ...P0, az: P0.az + 35, incl: Math.min(180, P0.incl + 20) }, 1],
      ['zoom 0.4', P0, 0.4],
      ['zoom 2.5', P0, 2.5],
    ] as [string, Params, number][]) {
      const label = `${name}, ${cam}`;
      const scene = buildScene(P, meta);
      const camera = cameraOf(P, zoom);
      st.setScene(scene);
      // the cost of a view: the passes of the whole scene, to the end of the queue (SwiftShader)
      const t0 = performance.now();
      st.setView(camera);
      await dev.queue.onSubmittedWorkDone();
      const gpuMs = performance.now() - t0;
      const g = await st.sky.readBack();
      const gv = await st.sky.vectors.readBack();
      const t1 = performance.now();
      const cv = new CpuStipple(scene).view(camera);
      const cpuMs = performance.now() - t1;
      const c = cv.sky;
      const bad: string[] = [];
      let maxPos = 0;
      if (!c) throw new Error('no sky');
      if (g.nVis !== c.visible.length)
        bad.push(`visible galaxies ${String(g.nVis)} ≠ ${String(c.visible.length)}`);
      else {
        let at = 0;
        c.visible.forEach((v, k) => {
          for (let j = 0; j < v.np; j++, at++) {
            const og = (k * SKY_DOTS_PER_GALAXY + j) * INSTANCE_WORDS;
            const oc = at * INSTANCE_WORDS;
            const d = Math.hypot(
              (g.dots[og] ?? 0) - (c.dots[oc] ?? 0),
              (g.dots[og + 1] ?? 0) - (c.dots[oc + 1] ?? 0),
            );
            maxPos = Math.max(maxPos, d);
            if (!(d <= POS_TOL) && bad.length < 3)
              bad.push(`dot ${String(k)}.${String(j)} off by ${d.toFixed(3)}`);
            if (g.dotsU[og + 2] !== c.dotsU[oc + 2] && bad.length < 3)
              bad.push(`dot ${String(k)}.${String(j)} drawing`);
          }
        });
        // the foreground stars: kept ones in order
        let kept = 0;
        for (let i = 0; i < (scene.sky?.nFg ?? 0); i++) {
          const og = i * INSTANCE_WORDS;
          if ((g.fg[og + 4] ?? 0) === 0 && (g.fg[og + 7] ?? 0) === 0) continue;
          const oc = kept * INSTANCE_WORDS;
          const d = Math.hypot(
            (g.fg[og] ?? 0) - (c.fg[oc] ?? 0),
            (g.fg[og + 1] ?? 0) - (c.fg[oc + 1] ?? 0),
          );
          maxPos = Math.max(maxPos, d);
          if (!(d <= POS_TOL) && bad.length < 3)
            bad.push(`fg star ${String(i)} off by ${d.toFixed(3)}`);
          kept++;
        }
        if (kept !== c.nFg) bad.push(`foreground stars ${String(kept)} ≠ ${String(c.nFg)}`);
        const cvd = cv.skyDrawings;
        if (!cvd) bad.push('no drawings');
        else if (gv.nCaps !== cvd.nCaps)
          bad.push(`capsules ${String(gv.nCaps)} ≠ ${String(cvd.nCaps)}`);
        else
          for (let k = 0; k < cvd.nCaps * CAPSULE_WORDS; k++) {
            if (k % CAPSULE_WORDS > 4) continue;
            const d = Math.abs((gv.caps[k] ?? 0) - (cvd.caps[k] ?? 0));
            maxPos = Math.max(maxPos, d);
            if (!(d <= POS_TOL)) {
              bad.push(`capsule word ${String(k)}`);
              break;
            }
          }
        totals.caps += cvd?.nCaps ?? 0;
      }
      // the inked background and foreground
      gpuR.setLayers([...st.sky.background(), ...st.sky.foreground()]);
      gpuR.drawInk();
      cpuR.setLayers(cv.skyLayers);
      cpuR.drawInk();
      const half = new Uint16Array((await readTexture(dev, gpuR.ink, 8)).buffer);
      let maxPx = 0;
      let inked = 0;
      for (let i = 0; i < half.length; i++) {
        const d = Math.abs(halfToFloat(half[i] ?? 0) - (cpuR.ink.data[i] ?? 0));
        maxPx = Math.max(maxPx, d);
        if (i % 4 === 3 && (cpuR.ink.data[i] ?? 0) > 0) inked++;
      }
      if (maxPx > 1 / 255) bad.push(`raster: max |Δ| ${maxPx.toFixed(4)} > 1/255`);
      worstPos = Math.max(worstPos, maxPos);
      worstPx = Math.max(worstPx, maxPx);
      totals.galaxies += c.visible.length;
      totals.dots += c.nDots;
      totals.fg += c.nFg;
      const ok = bad.length === 0;
      if (!ok) pass = false;
      lines.push(
        `${ok ? 'ok  ' : 'FAIL'} ${label}: ${String(c.visible.length)} galaxies, ${String(c.nDots)} dots, ${String(cv.skyDrawings?.nCaps ?? 0)} capsules, ${String(c.nFg)} foreground stars; view ${gpuMs.toFixed(0)} ms (GPU), ${cpuMs.toFixed(0)} ms (CPU); max |Δ| ${maxPos.toExponential(2)} px; raster max |Δ| ${maxPx.toFixed(5)} over ${String(inked)} inked px${ok ? '' : `; ${bad.slice(0, 4).join('; ')}`}`,
      );
      data[label] = { maxPos, maxPx, bad, inked, gpuMs, cpuMs };
    }
  lines.push(
    `worst: |Δ| ${worstPos.toExponential(2)} px (≤ ${String(POS_TOL)}), raster ${worstPx.toFixed(5)} (≤ 1/255); compared ${String(totals.galaxies)} galaxies, ${String(totals.dots)} dots, ${String(totals.caps)} capsules, ${String(totals.fg)} foreground stars`,
  );
  st.destroy();
  gpuR.destroy();
  return { pass, lines, data: { cases: data, worstPos, worstPx, totals } };
});
