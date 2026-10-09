/** The natural arm strokes (ADR 0082): `strokesAuto` 0 is v21's arms, 1 adds companion strokes. */
import { describe, expect, it } from 'vitest';
import { DEF } from '../../src/core/params';
import { presetParams } from '../../src/core/presets';
import { SCHEMA } from '../../src/core/schema';
import { buildScene } from '../../src/model/scene';
import { GoldenNode } from '../golden/compare/node';
import { ROOT } from './support/vectors';

// the meta with the strokes sheet, so that the line-work is in the scene
const META = new GoldenNode(ROOT).cpu.meta;

const roles = (over: object) =>
  buildScene(presetParams('Grand design', 7, over), META).ribbons.curves.map((c) => c.role);

describe('strokesAuto', () => {
  it('is off in the core, a model-tier choice', () => {
    expect(DEF.strokesAuto).toBe(0);
    expect(SCHEMA.strokesAuto).toMatchObject({ kind: 'choice', tier: 'model' });
  });

  it('adds nothing with 0, and companion strokes with 1', () => {
    expect(roles({ strokesAuto: 0 })).not.toContain('arm-fibre');
    const r = roles({ strokesAuto: 1 });
    expect(r.filter((x) => x === 'arm-fibre').length).toBeGreaterThan(8);
    expect(r.filter((x) => x === 'arm').length).toBe(
      roles({ strokesAuto: 0 }).filter((x) => x === 'arm').length,
    );
  });

  it('is thicker near the root than toward the tip, and deterministic', () => {
    const f = (o: object) =>
      buildScene(presetParams('Grand design', 7, o), META).ribbons.curves.filter(
        (c) => c.role === 'arm-fibre',
      );
    const a = f({ strokesAuto: 1 });
    expect(a).toEqual(f({ strokesAuto: 1 }));
    const radius = (c: { pts: number[][] }) =>
      Math.hypot(...(c.pts[Math.floor(c.pts.length / 2)] ?? [0, 0]).slice(0, 2));
    const inner = a.filter((c) => radius(c) < 0.9).map((c) => c.w);
    const outer = a.filter((c) => radius(c) > 1.4).map((c) => c.w);
    expect(Math.max(...inner)).toBeGreaterThan(Math.max(...outer));
  });
});
