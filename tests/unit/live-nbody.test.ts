/**
 * The live N-body behind the cores' orbit (ADR 0099): `nbody` 0 leaves v21's two-point-mass track
 * untouched; 1 integrates each galaxy's core and massive tracers together, so momentum is conserved,
 * a lone disc stays a disc and the track is reproducible.
 */
import { describe, expect, it } from 'vitest';
import { DEF } from '../../src/core/params';
import { presetParams } from '../../src/core/presets';
import { SCHEMA } from '../../src/core/schema';
import { LiveSystem, liveCount, type LiveGalaxy } from '../../src/sim/live';
import { coreTrack, mergerParamsOf } from '../../src/sim/merger';

const gal = (core: number[]): LiveGalaxy => ({
  mass: 1,
  soft: 0.22,
  rd: 0.32,
  rmax: 1.7,
  halo: 0,
  elliptical: false,
  n: [0, 0, 1],
  e1: [1, 0, 0],
  e2: [0, 1, 0],
  core,
});
const opts = { seed: 7, haloRc2: 0.5, coreSoft2: 0.02, friction: 0, steps: 400 };

const step = (S: LiveSystem, n: number, dt = 0.012) => {
  S.kick(dt / 2);
  for (let i = 0; i < n; i++) {
    S.drift(dt);
    S.kick(i === n - 1 ? dt / 2 : dt);
  }
};

describe('nbody is off in the core', () => {
  it('is a model-tier on/off choice defaulting to 0, and absent from the merger key then', () => {
    expect(DEF.nbody).toBe(0);
    expect(SCHEMA.nbody).toMatchObject({ kind: 'choice', tier: 'model', control: true });
    expect(mergerParamsOf(presetParams('Merger: the Mice', 7)).nbody).toBeUndefined();
    expect(mergerParamsOf(presetParams('Merger: the Mice', 7, { nbody: 1 })).nbody).toBe(1);
  });

  it('gives v21’s track unchanged with 0 and another with 1', () => {
    const a = coreTrack(mergerParamsOf(presetParams('Merger: the Mice', 7)));
    const b = coreTrack(mergerParamsOf(presetParams('Merger: the Mice', 7, { nbody: 1 })));
    expect(a.chosen.steps).toBe(b.chosen.steps);
    // the same start, a different orbit
    expect(Array.from(b.chosen.pos.slice(0, 6))).toEqual(Array.from(a.chosen.pos.slice(0, 6)));
    const k = a.chosen.steps * 6;
    const dx = Math.hypot(
      ...[0, 1, 2].map((d) => (a.chosen.pos[k + d] ?? 0) - (b.chosen.pos[k + d] ?? 0)),
    );
    expect(dx).toBeGreaterThan(0.01);
    expect(b.chosen.pos.every(Number.isFinite)).toBe(true);
  });
});

describe('the live system', () => {
  const pair = () =>
    new LiveSystem([gal([-0.8, 0, 0, 0, 0.3, 0]), gal([0.8, 0, 0, 0, -0.3, 0])], 80, opts);

  it('conserves momentum without halos or friction', () => {
    const S = pair();
    const mom = () => {
      const p = [0, 0, 0];
      for (let i = 0; i < S.n; i++)
        for (let d = 0; d < 3; d++) p[d] = (p[d] ?? 0) + (S.m[i] ?? 0) * (S.v[3 * i + d] ?? 0);
      return p;
    };
    // every pair force is equal and opposite, so every kick leaves the total unchanged
    const before = mom();
    step(S, 200);
    const after = mom();
    for (let d = 0; d < 3; d++) expect(after[d]).toBeCloseTo(before[d] ?? 0, 9);
  });

  it('keeps a lone disc a disc', () => {
    const S = new LiveSystem([gal([0, 0, 0, 0, 0, 0])], 120, opts);
    const med = () => {
      const r: number[] = [];
      for (let i = 1; i < S.n; i++)
        r.push(Math.hypot(S.x[3 * i] ?? 0, S.x[3 * i + 1] ?? 0, S.x[3 * i + 2] ?? 0));
      return r.sort((a, b) => a - b)[Math.floor(r.length / 2)] ?? 0;
    };
    const flat = () => {
      let z = 0;
      for (let i = 1; i < S.n; i++) z += Math.abs(S.x[3 * i + 2] ?? 0);
      return z / (S.n - 1);
    };
    const r0 = med();
    step(S, 400);
    expect(med() / r0).toBeGreaterThan(0.7);
    expect(med() / r0).toBeLessThan(1.4);
    expect(flat()).toBeLessThan(0.25);
    expect(S.x.every(Number.isFinite)).toBe(true);
  });

  it('is reproducible and keeps its tracer count inside the pair budget', () => {
    const a = pair();
    const b = pair();
    step(a, 50);
    step(b, 50);
    expect(Array.from(a.x)).toEqual(Array.from(b.x));
    expect(liveCount(100)).toBe(400);
    expect(liveCount(1e7)).toBe(60);
  });
});
