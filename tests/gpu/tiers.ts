/**
 * ADR 0010 on the GPU: orbiting changes no model buffer. For each scene, the stipple's model tier
 * (`GpuStipple.frame`, the path the page uses) is built once; then the camera moves inside its
 * incE bucket (az, pa, winding, zoom, mTime, incl). After every move:
 * - the tier rule ran the view tier only;
 * - the sample buffer is the same GPU buffer, and its contents hash the same (SHA-256 read back);
 * - the projected instances moved, and without dust (extinction, lanes, carving lines) the
 *   per-class counts did not change.
 * Crossing an incE bucket rebuilds the model once.
 *
 * Also an indicative timing on SwiftShader: one orbit frame (view tier + ink) against one
 * parameter change (scene description, model tier, view tier + ink), wall time to queue
 * completion, median of 15. The CPU twin of the hash test is tests/unit/tiers.test.ts.
 */
import type { Params } from '../../src/core/params';
import { presetParams } from '../../src/core/presets';
import { BuiltAssets, type AtlasName } from '../../src/marks/atlas';
import { coreInstances } from '../../src/model/parts';
import { hasDustCulls } from '../../src/model/ribbons';
import { drawingsMeta } from '../../src/model/scene';
import type { DrawingsMeta } from '../../src/model/variation';
import { GpuRenderer } from '../../src/render/frame';
import type { InkLayer } from '../../src/render/layers';
import { GpuStipple } from '../../src/render/stipple';
import { cameraOf, inclBucket } from '../../src/view/camera';
import { adapterName, device, run } from './harness';

const STIPPLE_ONLY = { lines: 0, knots: 0, envelope: 0, starMix: 0, field: 0, fgstars: 0 };

const CASES: [string, Params][] = [
  ['Smooth, round (stipple) s7', presetParams('Smooth, round', 7, STIPPLE_ONLY)],
  ['Cigar-shaped (stipple) s4242', presetParams('Cigar-shaped', 4242, STIPPLE_ONLY)],
  ['Disc, no arms (stipple) s7', presetParams('Disc, no arms', 7, STIPPLE_ONLY)],
  ['Grand design s7', presetParams('Grand design', 7)],
  ['Edge-on with dust s7 (the dust cull)', presetParams('Edge-on with dust', 7)],
];

function moves(P: Params): { what: string; P: Params; zoom: number }[] {
  const list = [
    { what: 'az + 35', P: { ...P, az: (P.az + 35) % 360 }, zoom: 1 },
    { what: 'pa + 47', P: { ...P, pa: (P.pa + 47) % 360 }, zoom: 1 },
    { what: 'winding', P: { ...P, winding: -P.winding }, zoom: 1 },
    { what: 'zoom 2', P, zoom: 2 },
    { what: 'zoom 12', P, zoom: 12 },
    { what: 'mTime', P: { ...P, mTime: 0.7 }, zoom: 1 },
  ];
  for (const d of [-3.15, 2.7, 180 - 2 * P.incl])
    if (inclBucket(P.incl + d) === inclBucket(P.incl) && P.incl + d >= 0 && P.incl + d <= 180)
      list.push({
        what: `incl ${(P.incl + d).toFixed(2)}`,
        P: { ...P, incl: P.incl + d },
        zoom: 1,
      });
  return list;
}

async function sha(buf: ArrayBuffer): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return Array.from(h.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

run('tiers: orbiting changes no model buffer (GPU), and the orbit frame cost', async () => {
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
  const meta: DrawingsMeta = drawingsMeta(
    {
      dots: by('dots'),
      knots: by('knots'),
      stars: by('stars'),
      cores: by('cores'),
      strokes: by('strokes'),
    },
    penlines,
  );
  const renderer = new GpuRenderer(dev, { plateCss: 800, dpr: 1 }, paper);
  for (const a of atlases) renderer.addAtlas(a);
  const lines = [`adapter: ${adapterName(adapter)}`];
  let pass = true;
  const data: Record<string, unknown> = {};

  /** One frame as the page draws it (src/main.ts inkScene), to queue completion. */
  const frame = async (st: GpuStipple, P: Params, zoom: number) => {
    const t0 = performance.now();
    const w = st.frame(P, zoom, meta);
    if (w.view) {
      const layers: InkLayer[] = [...st.lineLayers(), ...st.layers()];
      const cores = coreInstances(P, meta, cameraOf(P, zoom));
      if (cores.length) layers.push({ kind: 'sprites', atlas: 'cores', gain: 1, instances: cores });
      renderer.setLayers(layers);
    }
    // the compute passes, then the ink, each timed to queue completion
    await dev.queue.onSubmittedWorkDone();
    const t1 = performance.now();
    renderer.drawInk();
    await dev.queue.onSubmittedWorkDone();
    const t2 = performance.now();
    return { work: w, ms: t2 - t0, compute: t1 - t0, ink: t2 - t1 };
  };

  for (const [name, P] of CASES) {
    const st = GpuStipple.create(dev);
    await frame(st, P, 1);
    const buf = st.samplesBuffer;
    const h0 = await sha(await st.readSamples());
    const pos0 = await sha((await st.readProjected()).instances);
    const n0 = Array.from((await st.readCounts()).perClass);
    const bad: string[] = [];
    let moved = 0;
    const ms = moves(P);
    for (const m of ms) {
      const { work } = await frame(st, m.P, m.zoom);
      if (work.model || !work.view) bad.push(`${m.what}: ran ${JSON.stringify(work)}`);
      if (st.samplesBuffer !== buf) bad.push(`${m.what}: a new sample buffer`);
      const h = await sha(await st.readSamples());
      if (h !== h0) bad.push(`${m.what}: samples hash ${h} ≠ ${h0}`);
      const pos = await sha((await st.readProjected()).instances);
      if (pos !== pos0) moved++;
      else if (m.what !== 'mTime') bad.push(`${m.what}: the marks did not move`);
      const n = Array.from((await st.readCounts()).perClass);
      const culls = st.current ? hasDustCulls(st.current.ribbons) : true;
      if (!P.dust && !culls && n.join() !== n0.join())
        bad.push(`${m.what}: counts ${n.join()} ≠ ${n0.join()}`);
    }
    if (st.tiers.runs.model !== 1) bad.push(`model ran ${String(st.tiers.runs.model)} times`);
    // across a bucket
    const across = { ...P, incl: inclBucket(P.incl) === inclBucket(75) ? 30 : 75 };
    const a1 = (await frame(st, across, 1)).work;
    const a2 = (await frame(st, { ...across, az: 3 }, 1)).work;
    if (!a1.model || a2.model || st.tiers.runs.model !== 2)
      bad.push(`crossing a bucket: ${JSON.stringify(a1)} then ${JSON.stringify(a2)}`);

    // timing (indicative, SwiftShader): orbit steps against parameter changes
    const orbit: number[] = [];
    const param: number[] = [];
    const orbitCompute: number[] = [];
    const paramCompute: number[] = [];
    const ink: number[] = [];
    let p = { ...across };
    for (let k = 0; k < 15; k++) {
      p = { ...p, az: (p.az + 0.45) % 360 };
      const t = await frame(st, p, 1);
      orbit.push(t.ms);
      orbitCompute.push(t.compute);
      ink.push(t.ink);
    }
    for (let k = 0; k < 15; k++) {
      p = { ...p, bulgeSize: k % 2 ? 0.5 : 0.52 };
      const t = await frame(st, p, 1);
      param.push(t.ms);
      paramCompute.push(t.compute);
      ink.push(t.ink);
    }
    const ok = bad.length === 0;
    if (!ok) pass = false;
    lines.push(
      `${ok ? 'ok  ' : 'FAIL'} ${name}: ${String(ms.length)} camera moves in one bucket, samples ${h0} unchanged, marks moved in ${String(moved)}; ` +
        `orbit frame ${median(orbit).toFixed(1)} ms (compute ${median(orbitCompute).toFixed(1)}), parameter change ${median(param).toFixed(1)} ms (compute ${median(paramCompute).toFixed(1)}), ink ${median(ink).toFixed(1)} ms (medians of 15, SwiftShader)`,
    );
    for (const b of bad) lines.push(`      ${b}`);
    data[name] = {
      samplesHash: h0,
      moves: ms.map((m) => m.what),
      moved,
      failures: bad,
      orbitMs: orbit,
      paramMs: param,
      orbitMedian: median(orbit),
      paramMedian: median(param),
      orbitComputeMedian: median(orbitCompute),
      paramComputeMedian: median(paramCompute),
      inkMedian: median(ink),
    };
    st.destroy();
  }
  renderer.destroy();
  return { pass, lines, data };
});
