import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  chosenSnapshotStep,
  coreTrack,
  futureSnapshotStep,
  initialCore,
  mergerParamsOf,
  snapSelect,
  snapshotBudget,
  starCounts,
  unionFrame,
  type MergerParams,
} from '../../src/sim/merger';

/** v21's own `simulateMerger` core tracks (tools/merger-vectors.mjs, run in Chromium). */
interface Case {
  name: string;
  P: MergerParams;
  t0: number;
  N: [number, number];
  C0: number[][];
  Cc: number[][];
  frames: number;
  futFrames: number;
  cframes: number[][][];
  cfut: number[][][];
  horizon: number;
}
const vectors = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../vectors/merger.json'), 'utf8'),
) as { cases: Case[] };

/** The largest |a − b| / max(1, |b|) between two flat lists. */
function worst(a: ArrayLike<number>, b: ArrayLike<number>): number {
  expect(a.length).toBe(b.length);
  let m = 0;
  for (let i = 0; i < a.length; i++)
    m = Math.max(
      m,
      Math.abs((a[i] as number) - (b[i] as number)) / Math.max(1, Math.abs(b[i] as number)),
    );
  return m;
}

/** Positions and velocities of both cores, the layout of `CorePhase.snaps`. */
const flat = (fr: number[][][]) => fr.flatMap((s) => s.flat());

describe('the core track against v21 (f64)', () => {
  let overall = 0;
  for (const c of vectors.cases) {
    it(c.name, () => {
      const p = mergerParamsOf(c.P);
      const t = coreTrack(p);
      expect(t.t0).toBe(c.t0);
      expect(starCounts(p).n).toEqual(c.N);
      // the start
      expect(worst(initialCore(p, 0), c.C0[0] as number[])).toBe(0);
      expect(worst(initialCore(p, 1), c.C0[1] as number[])).toBe(0);
      // the same snapshots, in the same number
      expect(t.chosen.nSnaps).toBe(c.frames);
      expect(t.future.nSnaps).toBe(c.futFrames);
      expect(t.horizon).toBe(c.horizon);
      const w1 = worst(t.chosen.snaps, flat(c.cframes));
      const w2 = worst(t.future.snaps, flat(c.cfut));
      const w3 = worst([...t.C[0], ...t.C[1]], c.Cc.flat());
      overall = Math.max(overall, w1, w2, w3);
      // v21's own function and this one run the same operations in the same order
      expect(Math.max(w1, w2, w3)).toBeLessThanOrEqual(1e-13);
      // the chosen moment is the last timeline snapshot; the horizon's end the last of the future
      expect(Array.from(t.chosen.snaps.subarray(-12))).toEqual(c.Cc.flat());
      expect(Array.from(t.future.snaps.subarray(-12))).toEqual([...t.Cend[0], ...t.Cend[1]]);
    });
  }
  it('reports the worst deviation', () => {
    console.log(`core track vs v21: worst relative deviation ${overall.toExponential(2)}`);
    expect(overall).toBeLessThanOrEqual(1e-13);
  });
});

describe('the step plan', () => {
  it('keeps one kick position per step, and snapshots at v21’s steps', () => {
    const c = vectors.cases[0] as Case;
    const t = coreTrack(mergerParamsOf(c.P));
    expect(t.chosen.pos.length).toBe((t.chosen.steps + 1) * 6);
    expect(t.future.pos.length).toBe((t.future.steps + 1) * 6);
    // the snapshot taken before drift st holds the positions after st drifts (kick index st)
    for (const s of [1, 5, t.chosen.nSnaps - 2]) {
      const st = chosenSnapshotStep(t.chosen, s);
      const a = Array.from(t.chosen.snaps.subarray(s * 12, s * 12 + 3));
      expect(a).toEqual(Array.from(t.chosen.pos.subarray(st * 6, st * 6 + 3)));
    }
    for (const s of [0, 3]) {
      const st = futureSnapshotStep(t.future, s);
      const a = Array.from(t.future.snaps.subarray(s * 12, s * 12 + 3));
      expect(a).toEqual(Array.from(t.future.pos.subarray(st * 6, st * 6 + 3)));
    }
    // the future starts from the chosen moment's positions
    expect(Array.from(t.future.pos.subarray(0, 6))).toEqual(
      Array.from(t.chosen.pos.subarray(t.chosen.steps * 6, t.chosen.steps * 6 + 6)),
    );
  });

  it('the Mice: 105 timeline snapshots, 84 for the future (reference notes 11.1)', () => {
    const c = vectors.cases[0] as Case;
    const t = coreTrack(mergerParamsOf(c.P));
    expect([t.chosen.nSnaps, t.future.nSnaps]).toEqual([105, 84]);
  });

  it('mTime selects snapshots as snapAt does', () => {
    const t = coreTrack(mergerParamsOf((vectors.cases[0] as Case).P));
    const n = t.chosen.nSnaps;
    expect(snapSelect(t, 1)).toMatchObject({ exact: true, i0: n - 1, a: 0 });
    expect(snapSelect(t, 1.0005)).toMatchObject({ exact: true });
    const half = snapSelect(t, 0.5);
    expect(half.phase).toBe('timeline');
    expect(half.i0).toBe(Math.floor(0.5 * (n - 1)));
    expect(half.a).toBeCloseTo(0.5 * (n - 1) - half.i0, 12);
    const late = snapSelect(t, 1.5);
    expect(late.phase).toBe('future');
    expect(late.i0).toBe(Math.floor(0.5 * (t.future.nSnaps - 1)));
    // the start and the end of the timeline
    expect(snapSelect(t, 0)).toMatchObject({ phase: 'timeline', i0: 0, a: 0 });
    expect(snapSelect(t, 2)).toMatchObject({ phase: 'future', i0: t.future.nSnaps - 1 });
  });

  it('the union frame holds both cores at every snapshot', () => {
    const t = coreTrack(mergerParamsOf((vectors.cases[1] as Case).P));
    const u = unionFrame(t);
    for (let s = 0; s < t.chosen.nSnaps; s++)
      for (let g = 0; g < 2; g++) {
        const o = s * 12 + g * 6;
        const d = Math.hypot(
          (t.chosen.snaps[o] as number) - u.c[0],
          (t.chosen.snaps[o + 1] as number) - u.c[1],
          (t.chosen.snaps[o + 2] as number) - u.c[2],
        );
        expect(d + 1.25 * Math.sqrt(t.M[g] as number)).toBeLessThanOrEqual(u.r + 1e-12);
      }
  });
});

describe('the snapshot budget', () => {
  const t = coreTrack(mergerParamsOf((vectors.cases[12] as Case).P));
  it('keeps v21’s own spacing at the defaults (11,000 stars, horizon 2)', () => {
    const mice = coreTrack(mergerParamsOf((vectors.cases[0] as Case).P));
    const b = snapshotBudget(9679, mice);
    expect(b.stride).toEqual([1, 1]);
    expect(b.n1).toBe(104);
    expect(b.n2).toBe(83);
    expect(b.bytes).toBe((104 + 83) * 9679 * 8);
  });
  it('coarsens the future first when 30,000 stars and a horizon of 30 would not fit', () => {
    const b = snapshotBudget(30000, t);
    expect(b.bytes).toBeLessThanOrEqual(64 * 1024 * 1024);
    expect(b.stride[1]).toBeGreaterThan(1);
    expect(b.n1).toBe(t.chosen.nSnaps - 1);
  });
});
