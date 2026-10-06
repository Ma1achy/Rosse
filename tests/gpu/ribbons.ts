/**
 * Line-work parity (ADR 0004 L1, ADR 0011, 0014): compute/ribbons.wgsl against its CPU twin
 * (src/fallback/kernels/ribbons.ts), and render/ribbon.wgsl against the software rasteriser
 * (src/fallback/raster.ts), on the same scene descriptions.
 *
 * Per case (presets with ribbons, pieces, hatching, carving lines, the wobble, the edge-on
 * midplane, and a scene with every curve kind on), at the home camera, an orbit and zoom 2:
 * - projected points, arc lengths and per-curve state (total, width, repeats, slots): the same;
 * - textured segments, pieces, capsules, hatch dots and blobs: positions within 0.05 plate px,
 *   the same layers and counts;
 * - the inked line layers (ribbons, capsules, hatch dots and blobs, pieces): the GPU's ink target
 *   against the CPU's ink buffer, per pixel, within 1/255 (as the one-mark test).
 */
import { presetParams } from '../../src/core/presets';
import type { Params } from '../../src/core/params';
import { CpuRenderer } from '../../src/fallback';
import { ribbonModel, runRibbons } from '../../src/fallback/kernels/ribbons';
import { lineLayers } from '../../src/fallback/stipple';
import { BuiltAssets, type AtlasName } from '../../src/marks/atlas';
import {
  CAPSULE_WORDS,
  CURVE_STATE_WORDS,
  RIBBON_SEG_WORDS,
  ribUniform,
} from '../../src/model/ribbons';
import { buildScene, drawingsMeta } from '../../src/model/scene';
import { GpuRenderer } from '../../src/render/frame';
import { GpuStipple } from '../../src/render/stipple';
import { cameraOf, viewDesc } from '../../src/view/camera';
import { classCapacity } from '../../src/fallback/kernels/scan';
import { sampleCount } from '../../src/model/galaxy';
import { adapterName, device, halfToFloat, readTexture, run } from './harness';

const POS_TOL = 0.05;

const M4 = { starMix: 0, field: 0, fgstars: 0, bubbles: 0, whole: 0, envelope: 0 };

const BASE: [string, Params][] = [
  ['Grand design s7', presetParams('Grand design', 7, M4)],
  [
    'Barred spiral s4242 (ribbon bar and ring)',
    presetParams('Barred spiral', 4242, { ...M4, barStyle: 'ribbon', ringStyle: 'ribbon' }),
  ],
  ['Flocculent s7 (pieces)', presetParams('Flocculent', 7, M4)],
  ['Loose, open arms s4242 (beaded)', presetParams('Loose, open arms', 4242, M4)],
  ['Dusty spiral s7 (carving lines)', presetParams('Dusty spiral', 7, M4)],
  ['Hand wobble s7 (the wobble)', presetParams('Hand wobble', 7, M4)],
  ['Edge-on with dust s7 (midplane stroke and hatching)', presetParams('Edge-on with dust', 7)],
  // no stipple samples at all: the line-work must still be drawn (QA D1, minimum binding sizes)
  ['Grand design s7, no stipple', presetParams('Grand design', 7, { ...M4, stipple: 0, vary: 0 })],
  [
    'every curve: outline, tail, ribbon ring and bar, carving lines',
    presetParams('Grand design', 99, {
      ...M4,
      outline: 0.6,
      tail: 0.5,
      ring: 0.5,
      ringStyle: 'ribbon',
      bar: 0.4,
      barStyle: 'ribbon',
      dustLines: 0.7,
      arms: 4,
      flocc: 0.5,
    }),
  ],
];

run('line-work kernels and raster (GPU = CPU, L1)', async () => {
  const { adapter, device: dev } = await device();
  const assets = await BuiltAssets.load('/');
  const names: AtlasName[] = ['dots', 'knots', 'stars', 'cores', 'pieces', 'strokes'];
  const [atlases, paper, penlines] = await Promise.all([
    Promise.all(names.map((n) => assets.atlas(n))),
    assets.paper(),
    assets.vector('penlines'),
  ]);
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
    penlines,
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
  const totals = { segs: 0, pieces: 0, caps: 0, hdots: 0, hblobs: 0 };

  for (const [name, P0] of BASE)
    for (const [cam, P, zoom] of [
      ['home', P0, 1],
      ['orbit', { ...P0, az: P0.az + 35, incl: Math.min(180, P0.incl + 20) }, 1],
      ['zoom 2', P0, 2],
    ] as [string, Params, number][]) {
      const label = `${name}, ${cam}`;
      const scene = buildScene(P, meta);
      const camera = cameraOf(P, zoom);
      st.setScene(scene);
      st.setView(camera);
      const g = await st.ribbons.readBack();
      const G = scene.galaxy;
      const R = scene.ribbons;
      const n = sampleCount(G);
      const V = viewDesc(camera, G.g.dust, n, classCapacity(n));
      const M = ribbonModel(R, G.pool, G.dotBase);
      const c = runRibbons(M, V, ribUniform(R, camera, P, G.g.n_dot_pool));
      const bad: string[] = [];
      let maxPos = 0;
      const near = (what: string, a: ArrayLike<number>, b: ArrayLike<number>, idx: number[]) => {
        for (const i of idx) {
          const d = Math.abs((a[i] ?? 0) - (b[i] ?? 0));
          maxPos = Math.max(maxPos, d);
          if (!(d <= POS_TOL)) {
            bad.push(`${what}[${String(i)}] ${String(a[i])} ≠ ${String(b[i])}`);
            return;
          }
        }
      };
      const same = (what: string, a: ArrayLike<number>, b: ArrayLike<number>, idx: number[]) => {
        for (const i of idx)
          if (a[i] !== b[i]) {
            bad.push(`${what}[${String(i)}] ${String(a[i])} ≠ ${String(b[i])}`);
            return;
          }
      };
      const range = (count: number, words: number, cols: number[]) =>
        Array.from({ length: count }, (_, k) => cols.map((x) => k * words + x)).flat();
      near('points', g.points, c.points, range(R.nPoints, 2, [0, 1]));
      near('arc', g.arc, c.arc, range(R.nPoints, 1, [0]));
      const gsF = new Float32Array(g.state);
      const gsU = new Uint32Array(g.state);
      near('state', gsF, c.stateF, range(R.nCurves, CURVE_STATE_WORDS, [0, 1, 2, 5]));
      same('state', gsU, c.stateU, range(R.nCurves, CURVE_STATE_WORDS, [3, 4]));
      near(
        'segments',
        new Float32Array(g.segs),
        c.segs,
        range(R.nSegs, RIBBON_SEG_WORDS, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11]),
      );
      same('segments', new Uint32Array(g.segs), c.segsU, range(R.nSegs, RIBBON_SEG_WORDS, [10]));
      if (g.nPieces !== c.nPieces) bad.push(`pieces ${String(g.nPieces)} ≠ ${String(c.nPieces)}`);
      else {
        near(
          'pieces',
          new Float32Array(g.pieces),
          c.pieces,
          range(c.nPieces, 8, [0, 1, 3, 4, 5, 6, 7]),
        );
        same('pieces', new Uint32Array(g.pieces), c.piecesU, range(c.nPieces, 8, [2]));
      }
      near('capsules', g.caps, c.caps, range(R.nCaps, CAPSULE_WORDS, [0, 1, 2, 3, 4]));
      near('hatch dots', new Float32Array(g.hdots), c.hdots, range(R.nHDots, 8, [0, 1, 4, 7]));
      same('hatch dots', new Uint32Array(g.hdots), c.hdotsU, range(R.nHDots, 8, [2]));
      near(
        'hatch blobs',
        new Float32Array(g.hblobs),
        c.hblobs,
        range(R.nHBlobs, 8, [0, 1, 4, 5, 6, 7]),
      );
      same('hatch blobs', new Uint32Array(g.hblobs), c.hblobsU, range(R.nHBlobs, 8, [2]));

      // the inked line layers, GPU raster against CPU raster
      gpuR.setLayers(st.lineLayers());
      gpuR.drawInk();
      cpuR.setLayers(lineLayers(c, M));
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
      totals.segs += R.nSegs;
      totals.pieces += c.nPieces;
      totals.caps += R.nCaps;
      totals.hdots += R.nHDots;
      totals.hblobs += R.nHBlobs;
      const ok = bad.length === 0;
      if (!ok) pass = false;
      lines.push(
        `${ok ? 'ok  ' : 'FAIL'} ${label}: ${String(R.nCurves)} curves, ${String(R.nSegs)} segments, ${String(c.nPieces)} pieces, ${String(R.nHatch)} hatches (${String(R.nCaps)} capsules, ${String(R.nHDots)} dots, ${String(R.nHBlobs)} blobs); max |Δ| ${maxPos.toExponential(2)} px; raster max |Δ| ${maxPx.toFixed(5)} over ${String(inked)} inked px${ok ? '' : `; ${bad.slice(0, 4).join('; ')}`}`,
      );
      data[label] = { maxPos, maxPx, bad, inked };
    }
  lines.push(
    `worst: |Δ| ${worstPos.toExponential(2)} px (≤ ${String(POS_TOL)}), raster ${worstPx.toFixed(5)} (≤ 1/255); compared ${String(totals.segs)} segments, ${String(totals.pieces)} pieces, ${String(totals.caps)} capsules, ${String(totals.hdots + totals.hblobs)} hatch dots and blobs`,
  );
  st.destroy();
  gpuR.destroy();
  return { pass, lines, data: { cases: data, worstPos, worstPx, totals } };
});
