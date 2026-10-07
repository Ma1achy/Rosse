/**
 * The SVG export on both engines (milestone M12, src/extras/export/):
 * - the WebGPU engine's export (a read-back of its instance, ribbon and capsule buffers) has the
 *   same layers and, per layer, the same counts as the CPU engine's (L1: within 0.1%, at least 1);
 * - both parse as XML in Chromium's own parser, with the layer groups, and the elements of each
 *   layer are as many as the counts say;
 * - re-rasterised by Chromium, the SVG matches the plate's ink at the structure threshold (b′ of
 *   ADR 0013, the family's parity band): the coarse density maps' SSIM;
 * - a negative control: the SVG of the same galaxy turned 30° is below that threshold.
 */
import { presetParams } from '../../src/core/presets';
import type { Params } from '../../src/core/params';
import { CpuRenderer } from '../../src/fallback';
import { CpuStipple } from '../../src/fallback/stipple';
import { exportSvgCpu, exportSvgGpu } from '../../src/extras/export/engine';
import { SVG_LAYERS, type SvgResult } from '../../src/extras/export/svg';
import { BuiltAssets, type AtlasName } from '../../src/marks/atlas';
import { VECTOR_ATLASES, type VectorLibrary } from '../../src/marks/vector';
import { buildScene, drawingsMeta } from '../../src/model/scene';
import { GpuStipple } from '../../src/render/stipple';
import { cameraOf } from '../../src/view/camera';
import { coarseDensityMap, grey, ssim, type Grey } from '../golden/compare/metrics';
import thresholds from '../golden/thresholds.json';
import { adapterName, device, run } from './harness';

const OVERRIDES = { starMix: 0, field: 0, fgstars: 0 };

/** [name, seed, camera tweak, parity family] */
const CASES: [string, number, (P: Params) => Params, 'spiral' | 'smooth'][] = [
  ['Grand design', 7, (P) => P, 'spiral'],
  ['Flocculent', 7, (P) => P, 'spiral'],
  ['Dusty spiral', 7, (P) => P, 'spiral'],
  ['Smooth, round', 7, (P) => P, 'smooth'],
  ['Edge-on with dust', 7, (P) => P, 'spiral'],
  [
    'Grand design',
    4242,
    (P) => ({ ...P, az: P.az + 35, incl: Math.min(180, P.incl + 20) }),
    'spiral',
  ],
  [
    'Dusty spiral',
    4242,
    (P) => ({ ...P, az: P.az + 35, incl: Math.min(180, P.incl + 20) }),
    'spiral',
  ],
];

/** Chromium rasterises an SVG string at 800 × 800 and returns its alpha as a density input. */
async function rasterise(svg: string): Promise<Grey> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const img = new Image(800, 800);
  img.src = url;
  await img.decode();
  const c = new OffscreenCanvas(800, 800);
  const g = c.getContext('2d');
  if (!g) throw new Error('no 2d context');
  g.drawImage(img, 0, 0, 800, 800);
  URL.revokeObjectURL(url);
  const px = g.getImageData(0, 0, 800, 800).data;
  const out = grey(800, 800);
  for (let i = 0; i < 800 * 800; i++) out.data[i] = (px[i * 4 + 3] ?? 0) / 255;
  return out;
}

function inkAlpha(r: CpuRenderer): Grey {
  const out = grey(r.width, r.height);
  for (let i = 0; i < r.width * r.height; i++)
    out.data[i] = Math.min(1, r.ink.data[i * 4 + 3] ?? 0);
  return out;
}

/** The parse of Chromium: layer groups and the number of elements in each. */
function domCounts(svg: string): { ok: boolean; counts: Record<string, number>; error?: string } {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) return { ok: false, counts: {}, error: err.textContent };
  const counts: Record<string, number> = {};
  for (const g of Array.from(doc.querySelectorAll('g[id]'))) counts[g.id] = g.children.length;
  return { ok: doc.documentElement.localName === 'svg', counts };
}

run('SVG export (both engines, re-rasterised)', async () => {
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
  const cpuR = new CpuRenderer({ plateCss: 800, dpr: 1 }, paper);
  for (const a of atlases) cpuR.addAtlas(a);
  const st = GpuStipple.create(dev);
  const lines = [`adapter: ${adapterName(adapter)}`];
  let pass = true;
  const data: Record<string, unknown> = {};
  const fail = (s: string) => {
    pass = false;
    lines.push(`FAIL ${s}`);
  };

  for (const [name, seed, tweak, family] of CASES) {
    const P = tweak(presetParams(name, seed, OVERRIDES));
    const label = `${name} s${String(seed)}${P.az === presetParams(name, seed).az ? '' : ' orbit'}`;
    const camera = cameraOf(P, 1);
    // CPU engine
    const scene = buildScene(P, meta);
    const cpu = new CpuStipple(scene);
    const view = cpu.view(camera);
    cpuR.setLayers(view.layers);
    cpuR.drawInk();
    const ink = inkAlpha(cpuR);
    const a: SvgResult = exportSvgCpu(cpu, view);
    // WebGPU engine: a read-back of the buffers the frame drew
    st.setScene(buildScene(P, meta));
    st.setView(camera);
    const b: SvgResult = await exportSvgGpu(st, 1);

    const counts: string[] = [];
    for (const k of SVG_LAYERS) {
      const ref = a.counts[k];
      const got = b.counts[k];
      counts.push(`${k} ${String(got)}/${String(ref)}`);
      if (Math.abs(got - ref) > Math.max(1, Math.ceil(0.001 * ref)))
        fail(`${label}: layer ${k} has ${String(got)} on WebGPU, ${String(ref)} on the CPU`);
    }
    for (const [engine, r] of [
      ['CPU', a],
      ['WebGPU', b],
    ] as const) {
      const dom = domCounts(r.svg);
      if (!dom.ok) fail(`${label} ${engine}: does not parse (${dom.error ?? 'no svg root'})`);
      for (const k of SVG_LAYERS)
        if ((dom.counts[k] ?? 0) !== r.counts[k])
          fail(
            `${label} ${engine}: layer ${k} holds ${String(dom.counts[k] ?? 0)} elements, counts say ${String(r.counts[k])}`,
          );
    }

    // re-rasterised: the structure measure against the plate's ink
    const band = thresholds.parity[family].ssimCoarse;
    const inkMap = coarseDensityMap(ink);
    const rasterCpu = await rasterise(a.svg);
    const rasterGpu = await rasterise(b.svg);
    const sum = (g: Grey) => g.data.reduce((x, y) => x + y, 0);
    const inkRatio = sum(rasterCpu) / sum(ink);
    const sCpu = ssim(coarseDensityMap(rasterCpu), inkMap);
    const sGpu = ssim(coarseDensityMap(rasterGpu), inkMap);
    // the control: the same galaxy turned 30 degrees (not for a round galaxy)
    let control = NaN;
    if (family === 'spiral') {
      const Q = { ...P, pa: P.pa + 30 };
      const sc = new CpuStipple(buildScene(Q, meta));
      const turned = exportSvgCpu(sc, sc.view(cameraOf(Q, 1)));
      control = ssim(coarseDensityMap(await rasterise(turned.svg)), inkMap);
      if (!(control < band))
        fail(`${label}: the turned galaxy scores ${control.toFixed(3)}, not under ${String(band)}`);
    }
    if (!(sCpu >= band))
      fail(`${label}: CPU SVG structure ${sCpu.toFixed(3)} under ${String(band)}`);
    if (!(sGpu >= band))
      fail(`${label}: WebGPU SVG structure ${sGpu.toFixed(3)} under ${String(band)}`);
    lines.push(
      `${label}: ${counts.join(', ')}; ink ${inkRatio.toFixed(2)}×; structure SSIM CPU ${sCpu.toFixed(3)}, WebGPU ${sGpu.toFixed(3)} (band ${String(band)}${Number.isNaN(control) ? '' : `, turned 30°: ${control.toFixed(3)}`}); ${String(Math.round(b.svg.length / 1024))} KB`,
    );
    data[label] = { cpu: a.counts, gpu: b.counts, sCpu, sGpu, control };
  }
  st.destroy();
  return { pass, lines, data };
});
