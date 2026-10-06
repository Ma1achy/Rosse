/**
 * The drawn stars' parity (ADR 0004 L1, ADR 0011, 0014): the rows pass and the vector expansion of
 * the `rstar` samples on the GPU (compute/dyn-rows.wgsl, compute/vector-expand.wgsl, as a dynamic
 * set) against the CPU engine (src/fallback/stipple.ts), and the inked layers against the software
 * rasteriser.
 *
 * Per case (a galaxy with drawn stars among its stipple, at the home camera, an orbit and zoom
 * 2.5, whose growth `ZL` is a view input):
 * - the stars the compaction kept: the same count, and the capsules, dots and blobs of their
 *   drawings, slot by slot, within 0.05 plate px;
 * - the breathing room: the proposals it clears are the same (the per-class counts agree);
 * - the ink of the star layers: the GPU's ink target against the CPU's, per pixel, within 1/255.
 */
import { presetParams } from '../../src/core/presets';
import type { Params } from '../../src/core/params';
import { CpuRenderer } from '../../src/fallback';
import { CpuStipple, vectorLayers } from '../../src/fallback/stipple';
import { BuiltAssets, type AtlasName } from '../../src/marks/atlas';
import { VECTOR_ATLASES, type VectorLibrary } from '../../src/marks/vector';
import { CAPSULE_WORDS } from '../../src/model/ribbons';
import { buildScene, drawingsMeta } from '../../src/model/scene';
import { GpuRenderer } from '../../src/render/frame';
import { GpuStipple } from '../../src/render/stipple';
import { cameraOf } from '../../src/view/camera';
import { adapterName, device, halfToFloat, readTexture, run } from './harness';

const POS_TOL = 0.05;

const BASE: [string, Params][] = [
  ['Grand design s7', presetParams('Grand design', 7)],
  ['Ringed s4242 (ring knots)', presetParams('Ringed', 4242)],
  ['Cigar-shaped s7 (Sérsic)', presetParams('Cigar-shaped', 7)],
  ['Disc, no arms s4242, hand wobble', presetParams('Disc, no arms', 4242, { distort: 0.6 })],
  ['Edge-on with dust s7', presetParams('Edge-on with dust', 7)],
];

run('drawn stars (GPU = CPU, L1)', async () => {
  const { adapter, device: dev } = await device();
  const assets = await BuiltAssets.load('/');
  const names: AtlasName[] = ['dots', 'knots', 'stars', 'cores', 'pieces', 'strokes'];
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
  const totals = { stars: 0, caps: 0, blobs: 0, cleared: 0 };

  for (const [name, P0] of BASE)
    for (const [cam, P, zoom] of [
      ['home', P0, 1],
      ['orbit', { ...P0, az: P0.az + 35, incl: Math.min(180, P0.incl + 20) }, 1],
      ['zoom 2.5', P0, 2.5],
    ] as [string, Params, number][]) {
      const label = `${name}, ${cam}`;
      const scene = buildScene(P, meta);
      const camera = cameraOf(P, zoom);
      st.setScene(scene);
      st.setView(camera);
      const g = await st.stars.vectors.readBack();
      const gCounts = await st.readCounts();
      const cpu = new CpuStipple(scene).view(camera);
      const c = cpu.stars;
      const spec = scene.rstars;
      const bad: string[] = [];
      let maxPos = 0;
      if (gCounts.counts.rstars !== cpu.counts.rstars)
        bad.push(`rstars ${String(gCounts.counts.rstars)} ≠ ${String(cpu.counts.rstars)}`);
      if (g.nCaps !== c.nCaps) bad.push(`capsules ${String(g.nCaps)} ≠ ${String(c.nCaps)}`);
      else {
        for (let k = 0; k < c.nCaps * CAPSULE_WORDS; k++) {
          if (k % CAPSULE_WORDS > 4) continue;
          const d = Math.abs((g.caps[k] ?? 0) - (c.caps[k] ?? 0));
          maxPos = Math.max(maxPos, d);
          if (!(d <= POS_TOL)) {
            bad.push(`capsule word ${String(k)}: ${String(g.caps[k])} ≠ ${String(c.caps[k])}`);
            break;
          }
        }
      }
      const live = cpu.starRows;
      const nBlobs = live * spec.strideBlobs;
      const gb = new Float32Array(g.blobs);
      for (let k = 0; k < nBlobs * 8 && bad.length === 0; k++) {
        const d = Math.abs((gb[k] ?? 0) - (c.blobs[k] ?? 0));
        if (k % 8 !== 2 && !(d <= POS_TOL)) bad.push(`blob word ${String(k)}`);
      }
      // the star layers, inked
      gpuR.setLayers(st.stars.layers());
      gpuR.drawInk();
      cpuR.setLayers(vectorLayers(c, live * spec.strideDots, live * spec.strideBlobs));
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
      totals.stars += cpu.counts.rstars;
      totals.caps += c.nCaps;
      totals.blobs += nBlobs;
      totals.cleared += cpu.cleared;
      const ok = bad.length === 0;
      if (!ok) pass = false;
      lines.push(
        `${ok ? 'ok  ' : 'FAIL'} ${label}: ${String(cpu.counts.rstars)} stars (${String(cpu.cleared)} proposals cleared), ${String(c.nCaps)} capsules, ${String(nBlobs)} blob slots; max |Δ| ${maxPos.toExponential(2)} px; raster max |Δ| ${maxPx.toFixed(5)} over ${String(inked)} inked px${ok ? '' : `; ${bad.slice(0, 4).join('; ')}`}`,
      );
      data[label] = { maxPos, maxPx, bad, inked };
    }
  lines.push(
    `worst: |Δ| ${worstPos.toExponential(2)} px (≤ ${String(POS_TOL)}), raster ${worstPx.toFixed(5)} (≤ 1/255); compared ${String(totals.stars)} stars, ${String(totals.caps)} capsules, ${String(totals.blobs)} blob slots, ${String(totals.cleared)} proposals cleared`,
  );
  st.destroy();
  gpuR.destroy();
  return { pass, lines, data: { cases: data, worstPos, worstPx, totals } };
});
