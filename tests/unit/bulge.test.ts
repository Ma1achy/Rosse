/**
 * The natural bulge (ADR 0076): `bulgeAuto` 0 is v21's Hernquist bulge, whatever the galaxy; 1
 * draws it from a deprojected Sérsic law whose index follows the galaxy, keeping its size.
 */
import { describe, expect, it } from 'vitest';
import { DEF, type Params } from '../../src/core/params';
import { PRESET_NAMES, presetParams } from '../../src/core/presets';
import { SCHEMA, sanitise } from '../../src/core/schema';
import { runStipple } from '../../src/fallback/kernels/stipple';
import { bulgeIndex, bulgeIsSersic, psB, psSlope } from '../../src/model/bulge';
import { GalaxyFlag } from '../../src/model/galaxy';
import { buildScene } from '../../src/model/scene';
import { META } from './support/vectors';

/** a galaxy that is all bulge: every sample but a sliver is a bulge sample */
const pureBulge = (over: Partial<Params>) =>
  presetParams('Smooth, round', 7, {
    bulge: 0.999,
    sersicN: 0,
    arms: 0,
    halo: 0,
    bar: 0,
    ring: 0,
    stars: 40000,
    field: 0,
    fgstars: 0,
    ...over,
  });

/** the sorted 3D radii of a galaxy's samples, in units of the bulge's Hernquist scale */
function radii(P: Params): number[] {
  const s = runStipple(buildScene(P, META).galaxy);
  const a = 0.22 * P.bulgeSize;
  const r: number[] = [];
  for (let i = 0; i < s.n; i++)
    if (s.u32[i * 8 + 3])
      r.push(Math.hypot(s.f32[i * 8] ?? 0, s.f32[i * 8 + 1] ?? 0, s.f32[i * 8 + 2] ?? 0) / a);
  return r.sort((x, y) => x - y);
}
const quantile = (r: number[], q: number) => r[Math.floor(q * r.length)] ?? 0;

describe('bulgeAuto is off in the core', () => {
  it('is a model-tier on/off choice that defaults to 0, in the schema', () => {
    expect(DEF.bulgeAuto).toBe(0);
    expect(SCHEMA.bulgeAuto).toMatchObject({ kind: 'choice', tier: 'model', control: true });
    expect(() => sanitise({ ...DEF, bulgeAuto: 1 })).not.toThrow();
  });

  it('sets no Sérsic-bulge flag with 0, for every preset', () => {
    for (const n of PRESET_NAMES) {
      const P = presetParams(n, 7);
      expect(bulgeIsSersic(P), n).toBe(false);
      expect(buildScene(P, META).galaxy.g.flags & GalaxyFlag.bulgeSersic, n).toBe(0);
    }
  });

  it('sets it with 1 for a bulge, and not for a smooth galaxy, which has its own law', () => {
    const grand = presetParams('Grand design', 7, { bulgeAuto: 1 });
    expect(buildScene(grand, META).galaxy.g.flags & GalaxyFlag.bulgeSersic).not.toBe(0);
    const smooth = presetParams('Smooth, round', 7, { bulgeAuto: 1, bulge: 1, sersicN: 4 });
    expect(buildScene(smooth, META).galaxy.g.flags & GalaxyFlag.bulgeSersic).toBe(0);
  });
});

describe('the Sérsic index', () => {
  it('is shallow for a small or flat bulge and de Vaucouleurs-like for a big round one', () => {
    const at = (bulge: number, flat: number) =>
      bulgeIndex(presetParams('Grand design', 7, { bulge, bulgeFlat: flat, sersicN: 0 }));
    expect(at(0.05, 0.3)).toBeLessThan(1.5);
    expect(at(0.9, 1)).toBeGreaterThan(3.5);
    expect(at(0.9, 1)).toBeLessThanOrEqual(4);
    expect(at(0.5, 0.4)).toBeLessThan(at(0.5, 0.95));
    expect(at(0.2, 0.8)).toBeLessThan(at(0.7, 0.8));
  });

  it('is the explicit sersicN when one is set, within the sane range', () => {
    const P = (n: number) => presetParams('Grand design', 7, { sersicN: n });
    expect(bulgeIndex(P(2.5))).toBe(2.5);
    expect(bulgeIndex(P(50))).toBe(6);
  });

  it('has the Prugniel–Simien slope and b', () => {
    expect(psSlope(4)).toBeCloseTo(0.851, 3);
    expect(psB(4)).toBeCloseTo(7.668, 2);
  });
});

describe('the bulge samples', () => {
  it('keep the bulge its size: the median radius is within 30% of the Hernquist one', () => {
    for (const flat of [0.4, 0.95]) {
      const h = quantile(radii(pureBulge({ bulgeFlat: flat, bulgeAuto: 0 })), 0.5);
      const s = quantile(radii(pureBulge({ bulgeFlat: flat, bulgeAuto: 1 })), 0.5);
      expect(s / h, `flat ${String(flat)}`).toBeGreaterThan(0.85);
      expect(s / h, `flat ${String(flat)}`).toBeLessThan(1.3);
    }
  });

  it('are more centrally concentrated and longer-tailed at a higher index', () => {
    const lo = radii(pureBulge({ bulgeAuto: 1, sersicN: 1, bulgeFlat: 0.9, bulge: 0.9 }));
    const hi = radii(pureBulge({ bulgeAuto: 1, sersicN: 4, bulgeFlat: 0.9, bulge: 0.9 }));
    // the same half-mass radius, a steeper centre and a longer tail
    expect(quantile(hi, 0.1)).toBeLessThan(quantile(lo, 0.1));
    expect(quantile(hi, 0.99)).toBeGreaterThan(quantile(lo, 0.99));
  });

  it('never run past the cut of 20 scale lengths', () => {
    const r = radii(pureBulge({ bulgeAuto: 1, sersicN: 6, bulgeFlat: 1, bulge: 0.9 }));
    // the cut binds the bulge; the other tenth of the samples is the disc's
    expect(quantile(r, 0.8)).toBeLessThanOrEqual(20.001);
  });

  it('are deterministic', () => {
    const P = pureBulge({ bulgeAuto: 1 });
    expect(radii(P)).toEqual(radii(P));
  });
});

describe('the peanut of a barred bulge', () => {
  const flag = (P: Params) => buildScene(P, META).galaxy.g.flags & GalaxyFlag.bulgePeanut;

  it('is set for a barred galaxy with the natural bulge, and only then', () => {
    const barred = presetParams('Barred spiral', 7, { bulgeAuto: 1 });
    expect(barred.bar).toBeGreaterThan(0.05);
    expect(flag(barred)).not.toBe(0);
    expect(flag({ ...barred, bulgeAuto: 0 })).toBe(0);
    expect(flag({ ...barred, bar: 0 })).toBe(0);
    expect(flag(presetParams('Grand design', 7, { bulgeAuto: 1, bar: 0 }))).toBe(0);
  });

  it('makes the bulge taller either side of the centre than at it, and longer along the bar', () => {
    const base = pureBulge({ bulgeAuto: 1, bulge: 0.9, bulgeFlat: 0.8, bar: 0.6, barLen: 0.5 });
    const stats = (P: Params) => {
      const s = runStipple(buildScene(P, META).galaxy);
      let zc = 0;
      let nc = 0;
      let zo = 0;
      let no = 0;
      let xmax = 0;
      for (let i = 0; i < s.n; i++) {
        if (!s.u32[i * 8 + 3]) continue;
        const x = Math.abs(s.f32[i * 8] ?? 0);
        const z = Math.abs(s.f32[i * 8 + 2] ?? 0);
        if (x < 0.08) ((zc += z), nc++);
        else if (x > 0.2 && x < 0.3) ((zo += z), no++);
        xmax = Math.max(xmax, x);
      }
      return { ratio: zo / no / (zc / nc), xmax };
    };
    const plain = stats({ ...base, bar: 0 });
    const peanut = stats(base);
    // the height at the arm of the bar, against the centre's, grows
    expect(peanut.ratio).toBeGreaterThan(plain.ratio * 1.15);
  });
});
