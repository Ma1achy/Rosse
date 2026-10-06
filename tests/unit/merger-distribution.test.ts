/**
 * The engine's own galaxy-level draws of a merger against v21's, over 2,000 seeds: each galaxy's spin
 * azimuth and log-spiral pitch (v21 draws them from the stream that also draws its stars), the draws of
 * `mergerGalaxyParams` (the arms' pitch, the Sérsic index and the flattening), and `mWarp`'s whole
 * drawings. The goldens replay v21's draws (tests/golden/compare/v21-merger.ts); these tests check
 * that the engine's own are the same distributions, as tests/unit/parts-distribution.test.ts does for
 * the parts.
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { presetParams } from '../../src/core/presets';
import { mwarpPool } from '../../src/model/merger';
import { galaxyPicks, icPicks } from '../../src/sim/merger';
import { mulberry32 } from '../golden/compare/v21';
import { v21GalaxyPicks, v21MergerIC } from '../golden/compare/v21-merger';
import { Draws } from '../../src/core/rng';
import { Stream } from '../../src/core/streams';
import { META } from './support/vectors';

const ROOT = resolve(import.meta.dirname, '../..');
const SEEDS = Array.from({ length: 2000 }, (_, i) => 1 + i * 7);

/** The two-sample Kolmogorov–Smirnov statistic and its 0.1% critical value. */
function ks(a: number[], b: number[]): { d: number; crit: number } {
  const x = a.slice().sort((p, q) => p - q);
  const y = b.slice().sort((p, q) => p - q);
  let i = 0;
  let j = 0;
  let d = 0;
  while (i < x.length && j < y.length) {
    const vi = x[i] as number;
    const vj = y[j] as number;
    if (vi <= vj) i++;
    if (vj <= vi) j++;
    d = Math.max(d, Math.abs(i / x.length - j / y.length));
  }
  return { d, crit: 1.95 * Math.sqrt((a.length + b.length) / (a.length * b.length)) };
}

describe("the engine's own merger draws against v21's, over 2,000 seeds", () => {
  it('the spin azimuth and the log-spiral pitch of each galaxy', () => {
    const mine: Record<string, number[]> = { az0: [], az1: [], pitch0: [], pitch1: [] };
    const theirs: Record<string, number[]> = { az0: [], az1: [], pitch0: [], pitch1: [] };
    for (const seed of SEEDS) {
      // a small simulation is enough to draw the initial conditions' galaxy-level numbers
      const P = presetParams('Merger: the Mice', seed, { mStars: 4000 });
      const v = v21MergerIC(ROOT, P);
      for (const g of [0, 1] as const) {
        (theirs[`az${String(g)}`] as number[]).push(v.az[g]);
        (theirs[`pitch${String(g)}`] as number[]).push(v.pitch[g]);
        const o = icPicks(seed, g);
        (mine[`az${String(g)}`] as number[]).push(o.az);
        (mine[`pitch${String(g)}`] as number[]).push(o.pitch);
      }
    }
    for (const k of Object.keys(mine)) {
      const { d, crit } = ks(mine[k] as number[], theirs[k] as number[]);
      expect(d, k).toBeLessThan(crit);
    }
  });

  it("mergerGalaxyParams' draws: the arms' pitch, the Sérsic index, the flattening", () => {
    const mine: Record<string, number[]> = { pitch: [], sersic: [], flat: [] };
    const theirs: Record<string, number[]> = { pitch: [], sersic: [], flat: [] };
    for (const seed of SEEDS)
      for (const g of [0, 1] as const) {
        const a = galaxyPicks(seed, g);
        const b = v21GalaxyPicks(presetParams('Merger: the Mice', seed), g);
        (mine.pitch as number[]).push(a.pitchDeg);
        (mine.sersic as number[]).push(a.sersicN);
        (mine.flat as number[]).push(a.bulgeFlat);
        (theirs.pitch as number[]).push(b.pitchDeg);
        (theirs.sersic as number[]).push(b.sersicN);
        (theirs.flat as number[]).push(b.bulgeFlat);
      }
    for (const k of Object.keys(mine)) {
      const { d, crit } = ks(mine[k] as number[], theirs[k] as number[]);
      expect(d, k).toBeLessThan(crit);
    }
  });

  it("mWarp's whole drawings: every candidate with the same odds (χ² at 0.1%)", () => {
    const pool = mwarpPool(META.vectors?.whole?.type ?? []);
    expect(pool.length).toBeGreaterThan(10);
    const count = (picks: number[]) => {
      const c = new Map<number, number>();
      for (const p of picks) c.set(p, (c.get(p) ?? 0) + 1);
      return pool.map((p) => c.get(p) ?? 0);
    };
    const mine: number[] = [];
    const theirs: number[] = [];
    for (const seed of SEEDS) {
      for (const g of [0, 1]) {
        const u = new Draws(seed >>> 0, Stream.parts, 2000 + g).f32();
        mine.push(pool[Math.floor(u * pool.length)] as number);
      }
      const r = mulberry32(seed * 211 + 7);
      for (let g = 0; g < 2; g++) theirs.push(pool[Math.floor(r() * pool.length)] as number);
    }
    const a = count(mine);
    const b = count(theirs);
    let chi = 0;
    for (let k = 0; k < pool.length; k++) {
      const s = (a[k] as number) + (b[k] as number);
      if (s) chi += ((a[k] as number) - (b[k] as number)) ** 2 / s;
    }
    // χ² with pool.length − 1 degrees of freedom: its 0.1% point is below df + 4.2 √(2 df) + 12 for these sizes
    const df = pool.length - 1;
    expect(chi).toBeLessThan(df + 4.2 * Math.sqrt(2 * df) + 12);
  });
});
