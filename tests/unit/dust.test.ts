/**
 * Natural dust (ADR 0075): `dustAuto` 0 is v21's dust, whatever the galaxy; 1 gives a disc galaxy
 * a thin dust layer, none to an elliptical, with an explicit larger `dust` winning. The value is
 * what the galaxy uniform, the edge-on lane and the whole-drawing type read.
 */
import { describe, expect, it } from 'vitest';
import { DEF } from '../../src/core/params';
import { PRESET_NAMES, presetParams } from '../../src/core/presets';
import { SCHEMA, sanitise } from '../../src/core/schema';
import { dustTau } from '../../src/fallback/kernels/project';
import {
  DUST_BULGE_SHARE,
  DUST_LENTICULAR,
  DUST_SPIRAL,
  effectiveDust,
  naturalDust,
} from '../../src/model/dust';
import { wholeTypeOf } from '../../src/model/parts';
import { buildScene } from '../../src/model/scene';
import { mergerGalaxyParams } from '../../src/sim/merger';
import { buildQuery, parseUrlState } from '../../src/ui/urlstate';
import { META } from './support/vectors';

const NO_SKY = { field: 0, fgstars: 0, companions: 0 };
const SPIRALS = [
  'Grand design',
  'Barred spiral',
  'Flocculent',
  'Tightly wound',
  'Loose, open arms',
];
const SMOOTH = ['Smooth, round', 'Cigar-shaped'];
const auto = (name: string, over: object = {}) =>
  presetParams(name, 7, { dustAuto: 1, ...NO_SKY, ...over });

describe('dustAuto is off in the core', () => {
  it('is a model-tier on/off choice that defaults to 0, in the schema', () => {
    expect(DEF.dustAuto).toBe(0);
    expect(SCHEMA.dustAuto).toMatchObject({ kind: 'choice', tier: 'model', control: true });
    expect(() => sanitise({ ...DEF, dustAuto: 1 })).not.toThrow();
  });

  it('changes nothing with 0: the effective dust is P.dust for every preset', () => {
    for (const n of PRESET_NAMES) {
      const P = presetParams(n, 7);
      expect(P.dustAuto, n).toBe(0);
      expect(effectiveDust(P), n).toBe(P.dust);
    }
  });

  it('makes the same scene with 0 as without the key', () => {
    const P = presetParams('Grand design', 7, NO_SKY);
    const a = buildScene(P, META).galaxy.g.dust;
    expect(a).toBe(0);
    expect(buildScene({ ...P, dustAuto: 0, dust: 0.7 }, META).galaxy.g.dust).toBe(Math.fround(0.7));
  });
});

describe('naturalDust', () => {
  it('is none for the smooth galaxies, a star and an artefact', () => {
    for (const n of SMOOTH) expect(effectiveDust(auto(n)), n).toBe(0);
    expect(naturalDust(auto('Grand design', { subject: 'star' }))).toBe(0);
    expect(naturalDust(auto('Grand design', { bulge: 1 }))).toBe(0);
    expect(naturalDust(auto('Grand design', { sersicN: 4 }))).toBe(0);
  });

  it('is modest for the discs: a face-on centre optical depth of about 0.3', () => {
    for (const n of SPIRALS) {
      const d = effectiveDust(auto(n));
      expect(d, n).toBeGreaterThan(0.2);
      expect(d, n).toBeLessThan(0.4);
      // a point behind the whole slab, along the line of sight face-on
      const tau = Math.max(dustTau(0, 0, -0.2, 1, d), dustTau(0, 0, 0.2, 1, d));
      expect(tau, n).toBeGreaterThan(0.2);
      expect(tau, n).toBeLessThan(0.45);
    }
  });

  it('shrinks with the bulge, halves for a disc with no arms, and is least in an irregular', () => {
    const spiral = naturalDust(auto('Grand design', { bulge: 0.2 }));
    expect(spiral).toBeCloseTo(DUST_SPIRAL * (1 - DUST_BULGE_SHARE * 0.2), 10);
    expect(naturalDust(auto('Grand design', { bulge: 0.6 }))).toBeLessThan(spiral);
    expect(naturalDust(auto('Grand design', { arms: 0, bulge: 0.2 }))).toBeCloseTo(
      DUST_LENTICULAR * 0.9,
      10,
    );
    expect(naturalDust(auto('Grand design', { irr: 1 }))).toBeLessThan(spiral);
  });

  it('is a floor: an explicit larger dust wins, a smaller one is raised', () => {
    const nat = naturalDust(auto('Grand design'));
    expect(effectiveDust(auto('Grand design', { dust: 0.85 }))).toBe(0.85);
    expect(effectiveDust(auto('Grand design', { dust: 0.05 }))).toBe(nat);
    expect(effectiveDust(auto('Edge-on with dust'))).toBe(0.85);
  });

  it('does not read the camera', () => {
    const a = naturalDust(auto('Grand design', { incl: 10 }));
    expect(naturalDust(auto('Grand design', { incl: 88, az: 40, pa: 100 }))).toBe(a);
  });

  it('is each merging galaxy’s own: an elliptical has none', () => {
    const P = auto('Merger: spiral meets elliptical');
    const one = { ...P, ...mergerGalaxyParams(P, 0) };
    const two = { ...P, ...mergerGalaxyParams(P, 1) };
    expect(effectiveDust(one)).toBeGreaterThan(0.2);
    expect(effectiveDust(two)).toBe(0);
    expect(one.dustAuto).toBe(1);
  });
});

describe('the edge-on lane', () => {
  const edge = auto('Grand design', { incl: 88 });

  it('reaches the galaxy uniform, over the carving conditions (app23.js:L227–228)', () => {
    const g = buildScene(edge, META).galaxy.g;
    expect(g.dust).toBeGreaterThan(0.3);
    expect(g.dust).toBe(Math.fround(effectiveDust(edge)));
    expect(buildScene({ ...edge, dustAuto: 0 }, META).galaxy.g.dust).toBe(0);
  });

  it('types the whole drawing and the midplane stroke as a dust lane', () => {
    expect(wholeTypeOf(edge, 88)).toBe('edge-on:dust-lane');
    expect(wholeTypeOf({ ...edge, dustAuto: 0 }, 88)).not.toBe('edge-on:dust-lane');
  });

  it('a spiral with a large bulge, or an elliptical, has no lane', () => {
    expect(wholeTypeOf(auto('Grand design', { incl: 88, bulge: 0.6 }), 88)).not.toBe(
      'edge-on:dust-lane',
    );
    expect(buildScene(auto('Smooth, round', { incl: 88 }), META).galaxy.g.dust).toBe(0);
  });
});

describe('the address', () => {
  const features = { stars: true, merger: true, lens: true };

  it('writes dustAuto only when it differs from the page’s base, and reads it back', () => {
    const base = presetParams('Grand design', 7, { dustAuto: 1 });
    const same = buildQuery(
      { preset: 'Grand design', base, P: base, zoom: 1, surface: 'paper' },
      new URLSearchParams(),
    );
    expect(same.has('dustAuto')).toBe(false);
    const off = buildQuery(
      { preset: 'Grand design', base, P: { ...base, dustAuto: 0 }, zoom: 1, surface: 'paper' },
      new URLSearchParams(),
    );
    expect(off.get('dustAuto')).toBe('0');
    expect(parseUrlState(off, features).overrides).toEqual({ dustAuto: 0 });
    // v21's drawing: the base with the override laid on it has no natural dust
    const P = { ...base, ...parseUrlState(off, features).overrides };
    expect(effectiveDust(P)).toBe(P.dust);
  });
});
