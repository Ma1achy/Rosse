/**
 * Plates on the GPU (M6, ADR 0010, 0011): the slipped plates and the colour plate drawn by the
 * sprite, ribbon and capsule pipelines, against the software rasteriser.
 *
 * - v21's own rows (tests/golden/plates, captured by tools/capture-reference/plates.mjs): the same
 *   layers on both engines, each plates mode on both surfaces: the ink target within 1/255 per
 *   channel on every pixel, and the composite within 1/255 of RGBA8.
 * - The engine's galaxies (a line-work galaxy with ribbons, capsules and hatching, and the two
 *   plates presets), each in every plates mode: the layers come from each engine's own compute
 *   (equal at L1, not bit-equal), so the totals per channel are compared (within 0.5%), with the
 *   summed difference small against them.
 * - Switching plates is present-tier work: after the first draw, drawing another plates mode
 *   creates uniform buffers only, no storage buffer (no instance data is rebuilt) and runs no
 *   compute pass (the tier counters stay put).
 */
import { presetParams } from '../../src/core/presets';
import type { Params } from '../../src/core/params';
import { CpuRenderer } from '../../src/fallback';
import { CpuStipple } from '../../src/fallback/stipple';
import { BuiltAssets, type AtlasName } from '../../src/marks/atlas';
import type { Instance } from '../../src/marks/instance';
import { VECTOR_ATLASES, type VectorLibrary } from '../../src/marks/vector';
import { buildScene, drawingsMeta } from '../../src/model/scene';
import { GpuRenderer } from '../../src/render/frame';
import type { InkLayer } from '../../src/render/layers';
import { PALETTES } from '../../src/render/palette';
import type { InkLook, Plates, Pop } from '../../src/render/plates';
import { GpuStipple } from '../../src/render/stipple';
import { SURFACES, type SurfaceName } from '../../src/render/surface';
import { cameraOf } from '../../src/view/camera';
import { adapterName, device, halfToFloat, readTexture, run } from './harness';

const TOL = 1 / 255;
const MODES: Plates[] = ['ink', 'slip', 'colour'];
const look = (plates: Plates, s: SurfaceName): InkLook => ({
  plates,
  palette: s === 'chalk' ? PALETTES.dark : PALETTES.light,
});

interface Call {
  atlas: AtlasName;
  rows: number[][];
}
interface Capture {
  plates: Plates;
  calls: Call[];
}

run('plates (GPU = CPU, present tier)', async () => {
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
  const gpu = new GpuRenderer(dev, size, paper);
  const cpu = new CpuRenderer(size, paper);
  for (const a of atlases) {
    gpu.addAtlas(a);
    cpu.addAtlas(a);
  }
  const lines = [`adapter: ${adapterName(adapter)}`];
  let pass = true;
  const data: Record<string, unknown> = {};
  const ink = async () => new Uint16Array((await readTexture(dev, gpu.ink, 8)).buffer);

  // 1. v21's rows on both engines
  let worstPx = 0;
  let worstRgb = 0;
  for (const name of ['slip-paper', 'colour-chalk']) {
    const cap = (await (await fetch(`/tests/golden/plates/${name}.json`)).json()) as Capture;
    const n = MODES.indexOf(cap.plates) === 1 ? 4 : 1;
    const pops: Pop[] =
      cap.plates === 'colour' ? ['old', 'disc', 'young', 'hii', 'young', 'old'] : [];
    const layers: InkLayer[] = cap.calls.slice(0, cap.calls.length / n).map((c, i) => ({
      kind: 'sprites',
      atlas: c.atlas,
      gain: 1,
      pop: pops[i] ?? 'line',
      instances: c.rows.map((w): Instance => ({
        x: w[0] ?? 0,
        y: w[1] ?? 0,
        layer: w[2] ?? 0,
        alpha: w[3] ?? 0,
        m: [w[4] ?? 0, w[5] ?? 0, w[6] ?? 0, w[7] ?? 0],
      })),
    }));
    gpu.setLayers(layers);
    cpu.setLayers(layers);
    for (const mode of MODES)
      for (const s of ['paper', 'chalk'] as SurfaceName[]) {
        gpu.drawInk(look(mode, s));
        cpu.drawInk(look(mode, s));
        const half = await ink();
        let max = 0;
        let inked = 0;
        for (let i = 0; i < half.length; i++) {
          const d = Math.abs(halfToFloat(half[i] ?? 0) - (cpu.ink.data[i] ?? 0));
          max = Math.max(max, d);
          if (i % 4 === 3 && (cpu.ink.data[i] ?? 0) > 0) inked++;
        }
        const out = dev.createTexture({
          size: [gpu.width, gpu.height],
          format: 'rgba8unorm',
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        });
        gpu.present(out.createView(), 'rgba8unorm', SURFACES[s]);
        const g = await readTexture(dev, out, 4);
        const c = cpu.present(SURFACES[s]);
        let rgb = 0;
        for (let i = 0; i < g.length; i++) rgb = Math.max(rgb, Math.abs((g[i] ?? 0) - (c[i] ?? 0)));
        out.destroy();
        worstPx = Math.max(worstPx, max);
        worstRgb = Math.max(worstRgb, rgb);
        const ok = max <= TOL && rgb <= 1 && inked > 0;
        if (!ok) pass = false;
        lines.push(
          `${ok ? 'ok  ' : 'FAIL'} v21 rows ${name}, plates ${mode} on ${s}: ink max |Δ| ${(max * 255).toFixed(4)}/255 over ${String(inked)} inked px, composite max ${String(rgb)}/255`,
        );
        data[`${name} ${mode} ${s}`] = { max, rgb, inked };
      }
  }

  // 2. the engine's galaxies, every layer kind, in every mode
  const st = GpuStipple.create(dev);
  const cases: [string, Params, number][] = [
    [
      'Dusty spiral s7 (ribbons, capsules, hatching)',
      presetParams('Dusty spiral', 7, { starMix: 0, field: 0, fgstars: 0 }),
      1,
    ],
    [
      'Hand-drawn arms s4242 (vector drawings), zoom 2',
      presetParams('Hand-drawn arms', 4242, { starMix: 0, field: 0, fgstars: 0 }),
      2,
    ],
    [
      'Plates slipped s7',
      presetParams('Plates slipped', 7, { starMix: 0, field: 0, fgstars: 0 }),
      1,
    ],
    [
      'Stellar populations s4242',
      presetParams('Stellar populations', 4242, { starMix: 0, field: 0, fgstars: 0 }),
      1,
    ],
    [
      'Stellar populations s7, tinted dots (ADR 0091)',
      presetParams('Stellar populations', 7, { starMix: 0, field: 0, fgstars: 0, popAuto: 1 }),
      1,
    ],
  ];
  let worstTotal = 0;
  for (const [label, P, zoom] of cases) {
    const scene = buildScene(P, meta);
    const cam = cameraOf(P, zoom);
    st.setScene(scene);
    st.setView(cam);
    gpu.setLayers(st.inkLayers());
    cpu.setLayers(new CpuStipple(scene).view(cam).layers);
    for (const mode of MODES) {
      gpu.drawInk(look(mode, 'paper'));
      cpu.drawInk(look(mode, 'paper'));
      const half = await ink();
      const tg = [0, 0, 0, 0];
      const tc = [0, 0, 0, 0];
      let diff = 0;
      for (let i = 0; i < half.length; i++) {
        const g = halfToFloat(half[i] ?? 0);
        const c = cpu.ink.data[i] ?? 0;
        tg[i % 4] = (tg[i % 4] ?? 0) + g;
        tc[i % 4] = (tc[i % 4] ?? 0) + c;
        diff += Math.abs(g - c);
      }
      const rel = tg.map((g, k) => Math.abs(g / (tc[k] || 1) - 1));
      const worst = Math.max(...rel);
      const err = diff / ((tc[3] || 1) * 4);
      worstTotal = Math.max(worstTotal, worst);
      const ok = worst < 0.005 && err < 0.05 && (tc[3] ?? 0) > 0;
      if (!ok) pass = false;
      lines.push(
        `${ok ? 'ok  ' : 'FAIL'} ${label}, plates ${mode}: totals RGBα differ by ≤ ${(100 * worst).toFixed(3)}%, summed |Δ| ${(100 * err).toFixed(2)}% of the ink`,
      );
      data[`${label} ${mode}`] = { rel, err };
    }
  }

  // 3. switching plates is present-tier work
  {
    const P = presetParams('Dusty spiral', 7, { starMix: 0, field: 0, fgstars: 0 });
    const first = st.frame(P, 1, meta);
    gpu.setLayers(st.inkLayers());
    gpu.drawInk(look('ink', 'paper'));
    await dev.queue.onSubmittedWorkDone();
    const made: { usage: number; size: number }[] = [];
    const original = dev.createBuffer.bind(dev);
    dev.createBuffer = (d: GPUBufferDescriptor) => {
      made.push({ usage: d.usage, size: d.size });
      return original(d);
    };
    const runs = { ...st.tiers.runs };
    let tiersRun = false;
    for (const mode of ['slip', 'colour', 'slip', 'ink'] as Plates[]) {
      // the frame of the same galaxy with other plates: dirtyTier says `present`
      const w = st.frame({ ...P, plates: mode }, 1, meta);
      if (w.model || w.view) tiersRun = true;
      gpu.drawInk(look(mode, 'paper'));
      gpu.drawInk(look(mode, 'chalk'));
    }
    await dev.queue.onSubmittedWorkDone();
    dev.createBuffer = original;
    const storage = made.filter((b) => b.usage & GPUBufferUsage.STORAGE).length;
    const uniforms = made.filter((b) => b.usage & GPUBufferUsage.UNIFORM).length;
    const same = JSON.stringify(runs) === JSON.stringify(st.tiers.runs);
    const ok = first.model && first.view && !tiersRun && storage === 0 && same && uniforms > 0;
    if (!ok) pass = false;
    lines.push(
      `${ok ? 'ok  ' : 'FAIL'} switching plates and surface: ${String(uniforms)} uniform buffers made, ${String(storage)} storage buffers, tier runs ${JSON.stringify(st.tiers.runs)} (before ${JSON.stringify(runs)})`,
    );
    data['switching'] = { uniforms, storage, same, tiersRun };
  }
  lines.push(
    `worst: v21 rows ink ${(worstPx * 255).toFixed(4)}/255, composite ${String(worstRgb)}/255; galaxies' totals ${(100 * worstTotal).toFixed(3)}%`,
  );
  st.destroy();
  gpu.destroy();
  return { pass, lines, data };
});
