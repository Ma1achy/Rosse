/**
 * Line-work in 3D (ADR 0081): `lineWorld` 0 is v21's inclination-bucketed line-work; 1 builds it
 * once, in the disc's frame, with the dust lane as real ring arcs, so the camera only looks at it.
 */
import { describe, expect, it } from 'vitest';
import { DEF, type Params } from '../../src/core/params';
import { presetParams } from '../../src/core/presets';
import { SCHEMA, sanitise } from '../../src/core/schema';
import { CpuStippleTiers } from '../../src/fallback/stipple';
import { buildScene } from '../../src/model/scene';
import { structureKey } from '../../src/view/camera';
import { ROOT } from './support/vectors';
import { GoldenNode } from '../golden/compare/node';

// the meta with the strokes sheet and the pen lines, so that the line-work is in the scene
const META = new GoldenNode(ROOT).cpu.meta;

const spiral = (over: Partial<Params> = {}) =>
  presetParams('Grand design', 7, { field: 0, fgstars: 0, dustAuto: 1, ...over });

describe('lineWorld is off in the core', () => {
  it('is a model-tier on/off choice that defaults to 0, in the schema', () => {
    expect(DEF.lineWorld).toBe(0);
    expect(SCHEMA.lineWorld).toMatchObject({ kind: 'choice', tier: 'model', control: true });
    expect(() => sanitise({ ...DEF, lineWorld: 1 })).not.toThrow();
  });

  it('draws no lane ring with 0, and the edge-on stroke past 80°', () => {
    const R = buildScene(spiral({ incl: 88 }), META).ribbons;
    expect(R.curves.some((c) => c.role === 'lane-ring')).toBe(false);
    expect(R.curves.some((c) => c.role === 'edge-on')).toBe(true);
  });
});

describe('the structure does not depend on the camera', () => {
  it('has one structure key at every inclination', () => {
    const keys = new Set<string>();
    for (const incl of [0, 20, 45, 60, 71, 73, 75, 79, 81, 88, 90, 110, 150, 180])
      keys.add(structureKey({ ...spiral(), incl, lineWorld: 1 }));
    expect(keys.size).toBe(1);
    // and v21's does change
    const v21 = new Set<string>();
    for (const incl of [0, 60, 73, 75, 81, 88]) v21.add(structureKey({ ...spiral(), incl }));
    expect(v21.size).toBeGreaterThan(2);
  });

  it('builds the same line-work at every inclination: no screen-space stroke, no bucket', () => {
    const at = (incl: number) => buildScene(spiral({ incl, lineWorld: 1 }), META).ribbons;
    const a = at(0);
    for (const incl of [30, 73, 75, 85, 90, 120]) {
      const b = at(incl);
      expect(b.curves.length).toBe(a.curves.length);
      expect(b.curves.map((c) => c.role)).toEqual(a.curves.map((c) => c.role));
      expect(b.curves.some((c) => c.screen)).toBe(false);
      expect(b.lanes.screenPts).toBe(false);
      expect(b.lanes.screenLines).toBe(false);
      expect(b.nHatch).toBe(a.nHatch);
    }
  });

  it('does not rebuild the model when the camera tilts through v21’s buckets', () => {
    const eng = new CpuStippleTiers(META);
    const P = spiral({ lineWorld: 1, incl: 40 });
    eng.frame(P, 1);
    for (const incl of [60, 73, 76, 82, 88, 90]) {
      const { work } = eng.frame({ ...P, incl }, 1);
      expect(work, `incl ${String(incl)}`).toEqual({ model: false, view: true });
    }
  });
});

describe('the 3D dust lane', () => {
  const rings = (P: Params) =>
    buildScene(P, META).ribbons.curves.filter((c) => c.role === 'lane-ring');

  it('is a few tapered arcs in the disc plane, for a dusty disc', () => {
    const r = rings(spiral({ lineWorld: 1 }));
    expect(r.length).toBeGreaterThanOrEqual(4);
    for (const c of r) {
      expect(c.taper).toBe(true);
      expect(c.screen).toBeUndefined();
      expect(c.edgeAlpha).toBe(false);
      for (const p of c.pts) {
        expect(Math.abs(p[2])).toBeLessThan(0.02);
        expect(Math.hypot(p[0], p[1])).toBeGreaterThan(0.3);
        expect(Math.hypot(p[0], p[1])).toBeLessThan(1.6);
      }
    }
  });

  it('is there for an edge-on spiral, and not for a dust-free galaxy or an elliptical', () => {
    expect(rings(spiral({ lineWorld: 1, incl: 90 })).length).toBeGreaterThan(0);
    expect(rings(spiral({ lineWorld: 1, dustAuto: 0, dust: 0 }))).toHaveLength(0);
    expect(rings(presetParams('Smooth, round', 7, { lineWorld: 1, dustAuto: 1 }))).toHaveLength(0);
  });

  it('is deterministic, and does not move with the camera', () => {
    const a = rings(spiral({ lineWorld: 1, incl: 0 }));
    const b = rings(spiral({ lineWorld: 1, incl: 87 }));
    expect(b.map((c) => c.pts)).toEqual(a.map((c) => c.pts));
  });
});
