/**
 * Natural cosmic rays (ADR 0078): `cosmicAuto` 0 is v21's hits (70 to 130, in a box of 5.2 galaxy
 * units round the star); 1 draws 40 to 70, anywhere on the 800 px plate.
 */
import { describe, expect, it } from 'vitest';
import { DEF, type Params } from '../../src/core/params';
import { presetParams } from '../../src/core/presets';
import { SCHEMA, sanitise } from '../../src/core/schema';
import { describeStars } from '../../src/model/stars';
import { makeVariation } from '../../src/model/variation';
import { META } from './support/vectors';

const hitsOf = (P: Params) => {
  const D = describeStars(P, makeVariation(P, META), META);
  return D?.ctxs.find((c) => c.artefact === 'cosmic')?.picks.cosmic ?? [];
};
const rays = (seed: number, over: Partial<Params> = {}) =>
  presetParams('Artefact: cosmic rays', seed, over);

describe('cosmicAuto is off in the core', () => {
  it('is a model-tier on/off choice that defaults to 0, in the schema', () => {
    expect(DEF.cosmicAuto).toBe(0);
    expect(SCHEMA.cosmicAuto).toMatchObject({ kind: 'choice', tier: 'model', control: true });
    expect(() => sanitise({ ...DEF, cosmicAuto: 1 })).not.toThrow();
  });
});

describe('the cosmic-ray hits', () => {
  it('are v21’s with 0: 70 to 130, none beyond 2.6 units from the centre', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const h = hitsOf(rays(seed));
      expect(h.length).toBeGreaterThanOrEqual(70);
      expect(h.length).toBeLessThan(131);
      for (const k of h) expect(Math.max(Math.abs(k.ux), Math.abs(k.uy))).toBeLessThanOrEqual(2.61);
    }
  });

  it('are 40 to 70 spread over the whole plate with 1', () => {
    let far = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const h = hitsOf(rays(seed, { cosmicAuto: 1 }));
      expect(h.length).toBeGreaterThanOrEqual(40);
      expect(h.length).toBeLessThan(71);
      for (const k of h) {
        // 800 px at 84 px a unit: ±4.76 units reaches the plate's edge
        expect(Math.max(Math.abs(k.ux), Math.abs(k.uy))).toBeLessThanOrEqual(4.77);
        if (Math.max(Math.abs(k.ux), Math.abs(k.uy)) > 2.6) far++;
      }
    }
    // most of a uniform spread over ±4.76 lies outside ±2.6
    expect(far).toBeGreaterThan(40 * 40 * 0.5);
  });

  it('are the same hits in length and angle, only placed and counted differently', () => {
    const a = hitsOf(rays(7));
    const b = hitsOf(rays(7, { cosmicAuto: 1 }));
    // the same counter draws for the first hit, so its length, angle and knot agree
    expect(b[0]?.hl).toBe(a[0]?.hl);
    expect(b[0]?.ha).toBe(a[0]?.ha);
    expect(b[0]?.knot).toBe(a[0]?.knot);
  });

  it('are deterministic', () => {
    const P = rays(7, { cosmicAuto: 1 });
    expect(hitsOf(P)).toEqual(hitsOf(P));
  });
});
