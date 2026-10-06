/**
 * Vector drawings' parity (ADR 0004 L1, ADR 0011, 0014): compute/vector-expand.wgsl against its
 * CPU twin (src/fallback/kernels/vector.ts), and the inked vector layers against the software
 * rasteriser, on the same scene descriptions.
 *
 * Per case (the M5 presets, a rewound whole drawing, and every part at once), at the home camera,
 * an orbit and zoom 2:
 * - capsules (before and after the compaction: the same kept slots, in the same order), dots,
 *   blobs, and the streams' dots and knots: positions within 0.05 plate px, the same drawings and
 *   counts;
 * - the inked layers (capsules, dots, blobs, the streams' marks): the GPU's ink target against the
 *   CPU's ink buffer, per pixel, within 1/255.
 */
import { presetParams } from '../../src/core/presets';
import type { Params } from '../../src/core/params';
import { CpuRenderer } from '../../src/fallback';
import { runVectors, vectorInputs } from '../../src/fallback/kernels/vector';
import { streamLayers, vectorLayers } from '../../src/fallback/stipple';
import { BuiltAssets, type AtlasName } from '../../src/marks/atlas';
import { VECTOR_ATLASES, type VectorLibrary } from '../../src/marks/vector';
import { CAPSULE_WORDS } from '../../src/model/ribbons';
import { vectorView } from '../../src/model/vectors';
import { buildScene, drawingsMeta } from '../../src/model/scene';
import { GpuRenderer } from '../../src/render/frame';
import { GpuStipple } from '../../src/render/stipple';
import { cameraOf } from '../../src/view/camera';
import { adapterName, device, halfToFloat, readTexture, run } from './harness';

const POS_TOL = 0.05;
const M5 = { starMix: 0, field: 0, fgstars: 0 };

const BASE: [string, Params][] = [
  ['Hand-drawn arms s7', presetParams('Hand-drawn arms', 7, M5)],
  ['Ringed s4242', presetParams('Ringed', 4242, M5)],
  ['Disc, no arms s7 (envelope)', presetParams('Disc, no arms', 7, M5)],
  ['Barred spiral s7', presetParams('Barred spiral', 7, M5)],
  ['Radio jet s4242', presetParams('Radio jet', 4242, M5)],
  ['Stellar streams s7', presetParams('Stellar streams', 7, M5)],
  ['Shell galaxy s7 (drawn)', presetParams('Shell galaxy', 7, { ...M5, shellsOn: 0, shells: 1 })],
  [
    'Grand design s23 (whole, rewound; hand wobble)',
    presetParams('Grand design', 23, { ...M5, whole: 1, distort: 0.6 }),
  ],
  [
    'every part',
    presetParams('Grand design', 11, {
      ...M5,
      envelope: 1,
      whole: 1,
      nuclear: 1,
      ring: 0.5,
      lens: 0.7,
      shells: 0.5,
      tail: 0.5,
      trails: 0.8,
      bubbles: 1,
      jet: 1,
      streams: 1,
    }),
  ],
];

run('vector kernels and raster (GPU = CPU, L1)', async () => {
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
  const totals = { drawings: 0, caps: 0, dots: 0, blobs: 0, marks: 0 };

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
      const g = await st.vectors.readBack();
      const G = scene.galaxy;
      const D = scene.vectors;
      const vv = vectorView(D, P, scene.variation, meta, camera, G.g.key, G.g.n_dot_pool);
      const c = runVectors(vectorInputs(D.lib, vv, G.pool, G.dotBase, G.noise));
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
      const caps = [0, 1, 2, 3, 4];
      near('capsule slots', g.capsRaw, c.capsRaw, range(D.nCapSlots, CAPSULE_WORDS, caps));
      same('capsule keys', g.capKeys, c.capKeys, range(D.nCapSlots, 1, [0]));
      if (g.nCaps !== c.nCaps) bad.push(`capsules ${String(g.nCaps)} ≠ ${String(c.nCaps)}`);
      else near('capsules', g.caps, c.caps, range(c.nCaps, CAPSULE_WORDS, caps));
      near('dots', new Float32Array(g.dots), c.dots, range(D.nDots, 8, [0, 1, 4, 7]));
      same('dots', new Uint32Array(g.dots), c.dotsU, range(D.nDots, 8, [2]));
      near('blobs', new Float32Array(g.blobs), c.blobs, range(D.nBlobs, 8, [0, 1, 4, 5, 6, 7]));
      same('blobs', new Uint32Array(g.blobs), c.blobsU, range(D.nBlobs, 8, [2]));
      if (g.nSdots !== c.nSdots || g.nSknots !== c.nSknots)
        bad.push(
          `stream marks ${String(g.nSdots)}/${String(g.nSknots)} ≠ ${String(c.nSdots)}/${String(c.nSknots)}`,
        );
      else {
        const cols = [0, 1, 4, 5, 6, 7];
        near('stream dots', new Float32Array(g.sdots), c.sdots, range(c.nSdots, 8, cols));
        same('stream dots', new Uint32Array(g.sdots), c.sdotsU, range(c.nSdots, 8, [2]));
        near('stream knots', new Float32Array(g.sknots), c.sknots, range(c.nSknots, 8, cols));
        same('stream knots', new Uint32Array(g.sknots), c.sknotsU, range(c.nSknots, 8, [2]));
      }

      // the inked vector layers, GPU raster against CPU raster
      gpuR.setLayers([...st.vectors.layers(), ...st.vectors.streamLayers()]);
      gpuR.drawInk();
      cpuR.setLayers([
        ...vectorLayers(c, D.nDots, D.nBlobs),
        ...(D.parts.streams.length ? streamLayers(c) : []),
      ]);
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
      totals.drawings += D.nInst;
      totals.caps += c.nCaps;
      totals.dots += D.nDots;
      totals.blobs += D.nBlobs;
      totals.marks += c.nSdots + c.nSknots;
      const ok = bad.length === 0;
      if (!ok) pass = false;
      lines.push(
        `${ok ? 'ok  ' : 'FAIL'} ${label}: ${String(D.nInst)} drawings, ${String(c.nCaps)} of ${String(D.nCapSlots)} capsules, ${String(D.nDots)} dots, ${String(D.nBlobs)} blobs, ${String(c.nSdots)} + ${String(c.nSknots)} stream marks; max |Δ| ${maxPos.toExponential(2)} px; raster max |Δ| ${maxPx.toFixed(5)} over ${String(inked)} inked px${ok ? '' : `; ${bad.slice(0, 4).join('; ')}`}`,
      );
      data[label] = { maxPos, maxPx, bad, inked };
    }
  lines.push(
    `worst: |Δ| ${worstPos.toExponential(2)} px (≤ ${String(POS_TOL)}), raster ${worstPx.toFixed(5)} (≤ 1/255); compared ${String(totals.drawings)} drawings, ${String(totals.caps)} capsules, ${String(totals.dots)} dots, ${String(totals.blobs)} blobs, ${String(totals.marks)} stream marks`,
  );
  st.destroy();
  gpuR.destroy();
  return { pass, lines, data: { cases: data, worstPos, worstPx, totals } };
});
