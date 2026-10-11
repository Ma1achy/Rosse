/** The disc dims a star behind it (ADR 0086): strongly, face-on too, and not in front or far out. */
import { describe, expect, it } from 'vitest';
import { DEF } from '../../src/core/params';
import { SCHEMA } from '../../src/core/schema';
import { DISC_KEEP_FLOOR, DISC_TAU, discTau } from '../../src/model/stars';

const toViewer = (cosI: number): [number, number, number] => [Math.sqrt(1 - cosI * cosI), 0, cosI];

describe('occlAuto', () => {
  it('is a model-tier choice, off in the core', () => {
    expect(DEF.occlAuto).toBe(0);
    expect(SCHEMA.occlAuto).toMatchObject({ kind: 'choice', tier: 'model' });
  });
});

describe('the disc in front of a star', () => {
  it('is zero for a star in front of the disc, however placed', () => {
    expect(discTau([0.3, 0, 0.6], toViewer(0.8))).toBe(0);
    expect(discTau([0.3, 0, -0.6], toViewer(-0.8))).toBe(0);
  });

  it('is heavy behind the inner disc even face-on, and lighter through the outskirts', () => {
    const inner = discTau([0.2, 0, -0.5], toViewer(0.99));
    const outer = discTau([2.4, 0, -0.5], toViewer(0.99));
    expect(Math.exp(-inner)).toBeLessThan(0.25);
    expect(outer).toBeLessThan(inner / 3);
    expect(outer).toBeGreaterThan(0);
    expect(DISC_TAU).toBeGreaterThan(1);
  });

  it('grows at a shallow angle, and is symmetric seen from below', () => {
    const steep = discTau([-1.5, 0, -0.5], toViewer(0.9));
    const shallow = discTau([-1.5, 0, -0.5], toViewer(0.3));
    expect(shallow).toBeGreaterThan(steep);
    expect(discTau([-1.5, 0, 0.5], toViewer(-0.9))).toBeCloseTo(steep, 6);
  });

  it('is zero far beyond the disc, and is bounded, so a star is faint and never wiped out', () => {
    expect(discTau([4, 0, -0.5], toViewer(0.9))).toBe(0);
    expect(discTau([0, 0, -0.01], toViewer(0.13))).toBeLessThanOrEqual(7);
    expect(DISC_KEEP_FLOOR).toBeGreaterThan(0);
  });

  it('fades in across the plane, not as a step', () => {
    const above = discTau([0.3, 0, 0.05], toViewer(0.7));
    const inside = discTau([0.3, 0, 0], toViewer(0.7));
    const below = discTau([0.3, 0, -0.05], toViewer(0.7));
    expect(inside).toBeGreaterThan(above);
    expect(below).toBeGreaterThan(inside);
  });
});

describe('the satellites of a star', () => {
  it('spread twice as deep with the natural occlusion, so some lie behind the disc', async () => {
    const { satelliteDepth } = await import('../../src/model/stars');
    const s = { B: 0.5 } as Parameters<typeof satelliteDepth>[0];
    expect(satelliteDepth(s, 2)).toBeCloseTo(2 * satelliteDepth(s), 5);
    expect(satelliteDepth({ B: 0.05 } as Parameters<typeof satelliteDepth>[0], 2)).toBeLessThan(0);
  });
});
