/**
 * Shell galaxies (ADR 0009, 0004 L1, 0011): compute/shells.wgsl on the GPU against its CPU twin
 * (src/fallback/kernels/shells.ts, src/sim/shells.ts `detectArcsCpu`): the satellite's stars after
 * the infall, the shells the detection finds, and the stars as dots instances. The stars follow
 * near-radial orbits, so f32 on the two sides agrees closely (no close passages as in a merger).
 */
import { presetParams } from '../../src/core/presets';
import { CpuShells } from '../../src/fallback/kernels/shells';
import { BuiltAssets } from '../../src/marks/atlas';
import { drawingsMeta } from '../../src/model/scene';
import { buildShellScene } from '../../src/model/shells';
import { makeVariation } from '../../src/model/variation';
import { GpuShells } from '../../src/render/shells';
import { VECTOR_ATLASES, type VectorLibrary } from '../../src/marks/vector';
import { adapterName, device, run } from './harness';

/** Plate px per galaxy unit at zoom 1. */
const PX = 84;

const CASES: [string, ReturnType<typeof presetParams>][] = [
  ['Shell galaxy s7', presetParams('Shell galaxy', 7)],
  ['Shell galaxy s4242', presetParams('Shell galaxy', 4242)],
  [
    'a short infall, 3,000 stars',
    presetParams('Shell galaxy', 11, { shellTime: 40, shellStars: 3000 }),
  ],
  [
    '12,000 stars, long, other axis',
    presetParams('Shell galaxy', 3, { shellTime: 120, shellAxis: 80, shellStars: 12000 }),
  ],
];

run('shell galaxy (GPU = CPU twin, L1)', async () => {
  const { adapter, device: dev } = await device();
  const assets = await BuiltAssets.load('/');
  const names = ['dots', 'knots', 'stars', 'cores', 'pieces', 'strokes'] as const;
  const atlases = await Promise.all(names.map((n) => assets.atlas(n)));
  const sheets = await Promise.all(VECTOR_ATLASES.map((n) => assets.vector(n)));
  const vectors = Object.fromEntries(VECTOR_ATLASES.map((n, i) => [n, sheets[i]])) as VectorLibrary;
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
    vectors.penlines,
    vectors,
  );
  const gpu = GpuShells.create(dev);
  const lines = [`adapter: ${adapterName(adapter)}`];
  let pass = true;
  for (const [name, P] of CASES) {
    const scene = buildShellScene(P, meta, makeVariation(P, meta));
    const t0 = performance.now();
    const cpu = new CpuShells(scene.p, scene.key);
    cpu.run();
    const tCpu = performance.now() - t0;
    const t1 = performance.now();
    const arcs = await gpu.build(scene);
    gpu.view(1);
    const tGpu = performance.now() - t1;
    const g = await gpu.readPositions();
    const n = scene.p.shellStars;
    const e: number[] = [];
    for (let i = 0; i < n; i++)
      e.push(
        Math.hypot(
          (g[i * 4] as number) - (cpu.xs[i * 4] as number),
          (g[i * 4 + 1] as number) - (cpu.xs[i * 4 + 1] as number),
          (g[i * 4 + 2] as number) - (cpu.xs[i * 4 + 2] as number),
        ) * PX,
      );
    e.sort((a, b) => a - b);
    const q = (p: number) => e[Math.min(n - 1, Math.floor(n * p))] as number;
    const fmt = (a: { R: number; side: number; open: number }[]) =>
      a.map((x) => `${x.R.toFixed(3)}${x.side > 0 ? '+' : '-'}${x.open.toFixed(2)}`).join(' ');
    const same =
      arcs.length === cpu.arcs.length &&
      arcs.every(
        (a, i) =>
          a.side === cpu.arcs[i]?.side &&
          Math.abs(a.R - (cpu.arcs[i]?.R ?? 0)) < 1e-4 &&
          Math.abs(a.open - (cpu.arcs[i]?.open ?? 0)) < 5e-3,
      );
    // the dots: tiles and turns exactly, places within the drift
    const gd = await gpu.readDots();
    const cd = cpu.dots(scene.pool, scene.dotBase, PX);
    const gu = new Uint32Array(gd.buffer);
    const cu = new Uint32Array(cd.buffer);
    let tiles = 0;
    let dm = 0;
    for (let i = 0; i < n; i++) {
      if (gu[i * 8 + 2] !== cu[i * 8 + 2]) tiles++;
      dm = Math.max(
        dm,
        Math.hypot(
          (gd[i * 8] as number) - (cd[i * 8] as number),
          (gd[i * 8 + 1] as number) - (cd[i * 8 + 1] as number),
        ),
      );
    }
    lines.push(
      `${name}: ${String(n)} stars, ${String(Math.ceil(scene.p.shellTime / 0.02))} steps (GPU ${tGpu.toFixed(0)} ms, CPU ${tCpu.toFixed(0)} ms)`,
      `      positions: median ${q(0.5).toExponential(1)}, p99.9 ${q(0.999).toExponential(1)}, max ${(e[n - 1] as number).toExponential(1)} px`,
      `      shells: GPU ${fmt(arcs)} | CPU ${fmt(cpu.arcs)} ${same ? '(same)' : '(DIFFER)'}`,
      `      dots: ${String(tiles)} tiles differ, max |Δ| of a place ${dm.toExponential(1)} px`,
    );
    // L1 (ADR 0004): 99.9% within 0.05 px; the 6,000-step case is measured against twice that
    if (q(0.999) > (name.startsWith('12,000') ? 0.1 : 0.05) || tiles > 0 || !same) pass = false;
  }
  gpu.destroy();
  return { pass, lines };
});
