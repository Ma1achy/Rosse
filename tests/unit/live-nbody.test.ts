/**
 * The live N-body behind the cores' orbit (ADR 0099): `nbody` 0 leaves v21's two-point-mass track
 * untouched; 1 integrates each galaxy's core and massive tracers together, so momentum is conserved,
 * a lone disc stays a disc and the track is reproducible.
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEF } from '../../src/core/params';
import { presetParams } from '../../src/core/presets';
import { SCHEMA } from '../../src/core/schema';
import { LiveSystem, liveCount, type LiveGalaxy } from '../../src/sim/live';
import { buildMergerScene } from '../../src/model/merger';
import { CpuMergerStars, circularSpeed, simUniform } from '../../src/fallback/kernels/merger';
import { coreTrack, mergerParamsOf } from '../../src/sim/merger';
import { GoldenNode } from '../golden/compare/node';

const node = new GoldenNode(resolve(import.meta.dirname, '../..'));

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

describe('live stars (ADR 0100)', () => {
  const merger = (extra: object, exact = false) => {
    const P = presetParams('Merger: the Mice', 7, { mStars: 1500, nbody: 1, ...extra });
    const d = buildMergerScene(P, node.cpu.meta, node.referenceOptions(P, 1).merger).desc;
    const s = new CpuMergerStars(d);
    s.exactSelf = exact;
    return { d, s };
  };

  it('gives the stars the rest of the mass, and the core the rest', () => {
    const { d } = merger({});
    const u = simUniform(d);
    expect(u.live).toBe(1);
    // core mass plus all the stars' = the galaxy's
    expect((u.m0 as number) + (u.ms0 as number) * d.n[0]).toBeCloseTo(d.track.M[0], 3);
    expect((u.m1 as number) + (u.ms1 as number) * d.n[1]).toBeCloseTo(d.track.M[1], 3);
    const off = simUniform(merger({ nbody: 0 }).d);
    expect(off.live).toBe(0);
    expect(off.m0).toBe(d.track.M[0]);
  });

  it('starts the disc on the speed its enclosed mass gives: as fast outside as the point mass', () => {
    const live = merger({}).d.gals[0];
    const off = merger({ nbody: 0 }).d.gals[0];
    const far = circularSpeed(live, 6 * live.rd) / circularSpeed(off, 6 * live.rd);
    expect(far).toBeGreaterThan(0.9);
    expect(far).toBeLessThan(1.15);
  });

  it('follows the tree to a fraction of a galaxy radius, against the exact sum', () => {
    const a = merger({}, true);
    const b = merger({}, false);
    a.s.run();
    b.s.run();
    const r: number[] = [];
    for (let i = 0; i < a.d.total; i++)
      r.push(
        Math.hypot(
          (a.s.horizon[i * 4] ?? 0) - (b.s.horizon[i * 4] ?? 0),
          (a.s.horizon[i * 4 + 1] ?? 0) - (b.s.horizon[i * 4 + 1] ?? 0),
          (a.s.horizon[i * 4 + 2] ?? 0) - (b.s.horizon[i * 4 + 2] ?? 0),
        ),
      );
    r.sort((x, y) => x - y);
    const med = r[Math.floor(r.length / 2)] ?? 0;
    const ext: number[] = [];
    for (let i = 0; i < a.d.total; i++)
      ext.push(
        Math.hypot(
          a.s.horizon[i * 4] ?? 0,
          a.s.horizon[i * 4 + 1] ?? 0,
          a.s.horizon[i * 4 + 2] ?? 0,
        ),
      );
    ext.sort((x, y) => x - y);
    // a few percent of the system's extent after the whole (chaotic) run
    expect(med).toBeLessThan(0.08 * (ext[Math.floor(ext.length / 2)] ?? 1));
    expect(a.s.horizon.every(Number.isFinite)).toBe(true);
  });
});
