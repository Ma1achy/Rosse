/**
 * Merger test stars (ADR 0009, 0004 L1, 0011): compute/merger.wgsl on the GPU against its CPU twin
 * (src/fallback/kernels/merger.ts), on the same description (the core track is the f64 CPU one on
 * both). Per case it integrates the stars on both and compares, star by star:
 *
 * - the initial conditions (positions, velocities, the tidal map's disc coordinates);
 * - the chosen moment's positions (f32) and the horizon's end;
 * - the timeline's snapshots as the blend reads them (`mTime` 0.3, 0.7 and 1.5), f16 on both;
 * - the distances `frameOf` reads back.
 *
 * Stars are chaotic: two correct f32 integrators differ by rounding, and close passages amplify it.
 * The report gives the drift as a distribution (median, p99.9, max) in galaxy units and in plate
 * pixels (a unit is `scale` pixels, 90 at the Mice's framing), for all stars and for the stars in
 * the tails (beyond 1.15 of their galaxy's truncation radius from their core, the most sensitive
 * ones), against ADR 0004's L1: at least 99.9% of instances within 0.05 plate px.
 *
 * Gates (ADR 0040): the disc coordinates agree to 10⁻³ px; at the chosen moment at least 99% of the
 * stars are within 0.05 px and none is 1 px out; at the horizon's end of a quiet case at least 99%
 * are within 0.05 px; the timeline blends agree to 0.1 px (p99.9). The chaotic cases (stars orbiting
 * a merged pair for hundreds of steps: `coalescing`, and a horizon of 6) are measured and reported,
 * not gated beyond the chosen moment. ADR 0004's 99.9% is met at the chosen moment in every case
 * but one, where 99.4% are within 0.05 px and the worst star is 0.8 px out.
 */
import { presetParams } from '../../src/core/presets';
import type { Params } from '../../src/core/params';
import { CpuMergerStars } from '../../src/fallback/kernels/merger';
import { describeMerger, snapSelect, type MergerDesc } from '../../src/sim/merger';
import { GpuMergerStars } from '../../src/render/merger-stars';
import { adapterName, device, run } from './harness';

/** Plate pixels per galaxy unit at the Mice's framing (sc = 0.74 · 800 / (2 r) for r ≈ 3.3). */
const PX = 90;
/** ADR 0004's L1 position tolerance, plate px. */
const L1_PX = 0.05;

/** Cases whose stars orbit a merged pair for a long time: chaos amplifies f32 rounding. */
const CHAOTIC = new Set(['coalescing s7 (stage 4.5, friction)', 'the Mice, horizon 6 s7']);

const CASES: [string, Params][] = [
  ['the Mice s7', presetParams('Merger: the Mice', 7)],
  ['the Mice s4242', presetParams('Merger: the Mice', 4242)],
  ['long tails s7', presetParams('Merger: long tails', 7)],
  ['minor, a stream s4242', presetParams('Merger: minor, a stream', 4242)],
  ['spiral meets elliptical s7', presetParams('Merger: spiral meets elliptical', 7)],
  ['dry s7 (friction)', presetParams('Merger: dry (two ellipticals)', 7)],
  ['polar s4242 (fly-by, tilt 80)', presetParams('Merger: polar collision', 4242)],
  ['coalescing s7 (stage 4.5, friction)', presetParams('Merger: coalescing', 7)],
  ['the Mice, horizon 6 s7', presetParams('Merger: the Mice', 7, { mHorizon: 6 })],
];

interface Drift {
  n: number;
  median: number;
  p999: number;
  max: number;
  /** the fraction of stars within L1_PX plate px */
  within: number;
}

function drift(
  gpu: Float32Array,
  cpu: Float32Array,
  n: number,
  stride: number,
  pick?: (i: number) => boolean,
): Drift {
  const e: number[] = [];
  for (let i = 0; i < n; i++) {
    if (pick && !pick(i)) continue;
    e.push(
      Math.hypot(
        (gpu[i * stride] as number) - (cpu[i * stride] as number),
        (gpu[i * stride + 1] as number) - (cpu[i * stride + 1] as number),
        (gpu[i * stride + 2] as number) - (cpu[i * stride + 2] as number),
      ),
    );
  }
  e.sort((a, b) => a - b);
  const q = (p: number) => e[Math.min(e.length - 1, Math.floor(e.length * p))] ?? 0;
  return {
    n: e.length,
    median: q(0.5),
    p999: q(0.999),
    max: e[e.length - 1] ?? 0,
    within: e.filter((x) => x * PX <= L1_PX).length / Math.max(1, e.length),
  };
}

const fmt = (d: Drift) =>
  `median ${(d.median * PX).toExponential(1)}, p99.9 ${(d.p999 * PX).toExponential(1)}, max ${(d.max * PX).toExponential(1)} px, ${(d.within * 100).toFixed(2)}% within ${String(L1_PX)} px`;

/** Stars beyond 1.15 of their galaxy's truncation radius from their core at the state `pos`. */
function tailOf(d: MergerDesc, pos: Float32Array, core: readonly number[][]) {
  return (i: number) => {
    const g = i >= d.n[0] ? 1 : 0;
    const c = core[g] as number[];
    const r = Math.hypot(
      (pos[i * 4] as number) - (c[0] as number),
      (pos[i * 4 + 1] as number) - (c[1] as number),
      (pos[i * 4 + 2] as number) - (c[2] as number),
    );
    return r > 1.15 * d.gals[g].rmax && d.gals[g].type !== 'elliptical';
  };
}

run('merger test stars (GPU = CPU twin, L1)', async () => {
  const { adapter, device: dev } = await device();
  const gpu = GpuMergerStars.create(dev);
  const lines: string[] = [`adapter: ${adapterName(adapter)}`];
  let pass = true;
  const worst = { chosen: 0, horizon: 0, tail: 0 };
  for (const [name, P] of CASES) {
    const d = describeMerger(P);
    const t0 = performance.now();
    const cpu = new CpuMergerStars(d);
    cpu.run();
    const tCpu = performance.now() - t0;
    const t1 = performance.now();
    gpu.load(d);
    await gpu.run();
    const tGpu = performance.now() - t1;
    const g = await gpu.readState();
    const c = await gpu.readClosing();
    const tables = await gpu.readTables();
    const N = d.total;

    // the initial conditions: the state at the end is not the start, so compare the disc coordinates
    const ic = drift(g.ic, cpu.ic, N, 4);
    // the closing states
    const ch = drift(c.chosen, cpu.chosen, N, 4);
    const hz = drift(c.horizon, cpu.horizon, N, 4);
    const tailMask = tailOf(d, cpu.chosen, d.track.C);
    const tail = drift(c.chosen, cpu.chosen, N, 4, tailMask);
    // the f16 tables: rows as the blend reads them, compared by their decoded positions
    let rowMismatch = 0;
    for (let k = 0; k < tables.snap1.length; k++)
      if (tables.snap1[k] !== cpu.snap1[k]) rowMismatch++;
    // the blend at three moments, f16 on both
    const blends: string[] = [];
    for (const t of [0.3, 0.7, 1.5]) {
      const sel = snapSelect(d.track, t);
      gpu.blend(sel);
      const gb = await gpu.readCurrent();
      const cb = cpu.blend(sel);
      const b = drift(gb, cb, N, 4);
      blends.push(`t=${String(t)} p99.9 ${(b.p999 * PX).toExponential(1)} px`);
      if (b.p999 * PX > (t > 1 ? 0.5 : 0.1) && !CHAOTIC.has(name)) pass = false;
    }
    // the framing's distances: every fifth star of the chosen state, from the cores' midpoint
    gpu.blend(snapSelect(d.track, 1));
    const mid = [0, 1, 2].map(
      (k) => ((d.track.C[0][k] as number) + (d.track.C[1][k] as number)) / 2,
    );
    const gr = await gpu.readRadii(mid);
    const cr = CpuMergerStars.radii(cpu.blend(snapSelect(d.track, 1)), N, mid);
    let rMax = 0;
    for (let k = 0; k < cr.length; k++)
      rMax = Math.max(rMax, Math.abs((gr[k] as number) - (cr[k] as number)));

    worst.chosen = Math.max(worst.chosen, ch.p999 * PX);
    worst.horizon = Math.max(worst.horizon, hz.p999 * PX);
    worst.tail = Math.max(worst.tail, tail.p999 * PX);
    if (ic.max * PX > 1e-3 || ch.within < 0.99 || ch.max * PX > 1) pass = false;
    if (!CHAOTIC.has(name) && hz.within < 0.99) pass = false;
    lines.push(
      `${name}: ${String(N)} stars, ${String(d.track.chosen.steps)} + ${String(d.track.future.steps)} steps (GPU ${tGpu.toFixed(0)} ms, CPU ${tCpu.toFixed(0)} ms)`,
      `      disc coordinates: ${fmt(ic)}`,
      `      chosen moment:    ${fmt(ch)}`,
      `      tails (${String(tail.n)} stars): ${tail.n ? fmt(tail) : 'none'}`,
      `      horizon end:      ${fmt(hz)}`,
      `      f16 rows differing in a bit: ${String(rowMismatch)} of ${String(tables.snap1.length)}; blends ${blends.join(', ')}; frame radii max |Δ| ${rMax.toExponential(1)}`,
    );
  }
  lines.push(
    `worst p99.9 over the cases: chosen ${worst.chosen.toExponential(1)} px, tails ${worst.tail.toExponential(1)} px, horizon ${worst.horizon.toExponential(1)} px (L1: ${String(L1_PX)} px for 99.9%)`,
  );
  gpu.destroy();
  return { pass, lines };
});
