/**
 * Offline replays of v21's own random choices, for the golden comparison (ADR 0015).
 *
 * `v21Variation` is v21's `makeVariation` (app23.js:L96–119) line for line, on v21's own
 * `mulberry32(seed * 7919 + 13)` stream and `gauss`: the arms' pitch, amplitude, phase and wiggle,
 * the spurs, clumps and dust patches, the lopsidedness and warp, and the hand (dot pool) and knot
 * pool. The golden runner gives it to the new engine, so that both engines draw the same galaxy
 * with the same pens and only the dots differ, which is what the metric's thresholds are
 * calibrated for (re-keyed placement, everything structural kept). It needs no capture-time
 * record, so every capture can be compared this way; tests/unit/v21-replay.test.ts checks it
 * against the hands recorded by the capture tool.
 *
 * It is a test oracle, not engine code: the engine's own variation (src/model/variation.ts) uses
 * the counter RNG of ADR 0004.
 */
import type { Params } from '../../../src/core/params';
import type { DrawingsMeta, Variation } from '../../../src/model/variation';

/** v21's `mulberry32` (app23.js:L71). */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** v21's `gauss` (app23.js:L72): two draws, one normal. */
export function gauss(r: () => number): number {
  const u = 1 - r();
  const v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** v21's `makeVariation`, as data for the new engine. */
export function v21Variation(P: Params, meta: DrawingsMeta): Variation {
  const r = mulberry32(P.seed * 7919 + 13);
  const v = P.vary;
  const arms: Variation['arms'] = [];
  for (let k = 0; k < Math.max(1, P.arms); k++)
    arms.push({
      pitch: 1 + 0.28 * v * gauss(r),
      amp: 1 - 0.55 * v * r(),
      phase: 0.35 * v * gauss(r),
      rmax: 2.1 + 0.6 * r(),
      wig: 0.3 * v * r(),
      wf: 1.5 + 3 * r(),
      wp: r() * 6.28,
    });
  const spurs: Variation['spurs'] = [];
  const ns = Math.round(v * (2 + r() * 4) * Math.min(1, P.arms));
  for (let i = 0; i < ns; i++)
    spurs.push({
      k: Math.floor(r() * Math.max(1, P.arms)),
      R0: 0.8 + 1.6 * r(),
      len: 0.5 + 0.9 * r(),
      pk: 1.7 + 0.8 * r(),
    });
  const clumps: Variation['clumps'] = [];
  const nc = Math.round(v * (4 + r() * 10) * (1 + 2 * P.patchy));
  for (let j = 0; j < nc; j++)
    clumps.push({ R: 0.7 + 2.2 * r(), t: r(), s: 0.05 + 0.08 * r(), n: 20 + Math.floor(60 * r()) });
  const dust: Variation['dust'] = [];
  const nd = Math.round(v * r() * 5);
  for (let d = 0; d < nd; d++) dust.push({ R: 0.8 + 2 * r(), th: r() * 6.28, s: 0.18 + 0.3 * r() });
  // the hand: v21 groups sizes by source with a plain object, so its key order is insertion order
  const bySrc = new Map<string, number[]>();
  meta.dots.src.forEach((s, i) => {
    let a = bySrc.get(s);
    if (!a) bySrc.set(s, (a = []));
    a.push(meta.dots.size[i] ?? 0);
  });
  let srcs = [...bySrc.keys()].filter((s) => {
    const a = (bySrc.get(s) ?? []).slice().sort((p, q) => p - q);
    return (a[Math.floor(a.length / 2)] ?? 0) >= 7 && a.length >= 8;
  });
  if (!srcs.length) srcs = [...bySrc.keys()];
  const pickN = 1 + Math.floor(r() * 3);
  const chosen = new Set<string>();
  for (let c = 0; c < pickN; c++) chosen.add(srcs[Math.floor(r() * srcs.length)] ?? '');
  let dotPool: number[] = [];
  meta.dots.src.forEach((s, i) => {
    if (chosen.has(s) || v < 0.15) dotPool.push(i);
  });
  if (dotPool.length < 12) dotPool = meta.dots.src.map((_, i) => i);
  const knotPool: number[] = [];
  for (let q = 0; q < 24; q++) knotPool.push(Math.floor(r() * meta.knots.count));
  const spike = (r() - 0.5) * 0.5;
  const lop = v * (0.22 + 0.7 * P.patchy) * (0.5 + 0.5 * r());
  const lopA = r() * 6.28;
  const warp = v * 0.35 * r();
  const warpA = r() * 6.28;
  const strokeSeed = Math.floor(r() * 1e6);
  return {
    arms,
    spurs,
    clumps,
    dust,
    lop,
    lopA,
    warp,
    warpA,
    dotPool,
    hand: [...chosen],
    knotPool,
    spike,
    strokeSeed,
  };
}
