/**
 * Natural star spread (ADR 0077): `starsAuto` 0 is v21's drawn stars, whatever the galaxy; 1 makes
 * the arms' share of the stars (and of the bright ones) rise smoothly with the arm profile, and the
 * outer fall-off a taper, not two steps and a cut at R = 2.7.
 */
import { describe, expect, it } from 'vitest';
import { DEF, type Params } from '../../src/core/params';
import { PRESET_NAMES, presetParams } from '../../src/core/presets';
import { SCHEMA, sanitise } from '../../src/core/schema';
import { runStipple } from '../../src/fallback/kernels/stipple';
import { Cls, SampleFlag } from '../../src/model/classes';
import { GalaxyFlag } from '../../src/model/galaxy';
import { buildScene } from '../../src/model/scene';
import { META } from './support/vectors';

const flag = (P: Params) => buildScene(P, META).galaxy.g.flags & GalaxyFlag.starsSmooth;

/** the drawn stars (`rstar`) of a galaxy: radius in the disc plane, and whether bright */
function stars(P: Params): { R: number; bright: boolean }[] {
  const s = runStipple(buildScene(P, META).galaxy);
  const out: { R: number; bright: boolean }[] = [];
  for (let i = 0; i < s.n; i++) {
    const c = s.u32[i * 8 + 3] ?? 0;
    if ((c & 0xff) !== Cls.rstar) continue;
    out.push({
      R: Math.hypot(s.f32[i * 8] ?? 0, s.f32[i * 8 + 1] ?? 0),
      bright: (c & SampleFlag.bright) !== 0,
    });
  }
  return out;
}

const spiral = (over: Partial<Params> = {}) =>
  presetParams('Grand design', 7, { stars: 60000, starMix: 1, field: 0, fgstars: 0, ...over });

describe('starsAuto is off in the core', () => {
  it('is a model-tier on/off choice that defaults to 0, in the schema', () => {
    expect(DEF.starsAuto).toBe(0);
    expect(SCHEMA.starsAuto).toMatchObject({ kind: 'choice', tier: 'model', control: true });
    expect(() => sanitise({ ...DEF, starsAuto: 1 })).not.toThrow();
  });

  it('sets no flag with 0, for every preset, and sets it with 1', () => {
    for (const n of PRESET_NAMES) expect(flag(presetParams(n, 7)), n).toBe(0);
    expect(flag(spiral({ starsAuto: 1 }))).not.toBe(0);
  });
});

describe('the drawn stars', () => {
  it('are cut at R = 2.7 with 0, and taper out to 3 with 1', () => {
    const off = stars(spiral());
    const on = stars(spiral({ starsAuto: 1 }));
    const beyond = (s: { R: number }[]) => s.filter((x) => x.R >= 2.7 && x.R < 3.05).length;
    expect(beyond(off)).toBe(0);
    expect(beyond(on)).toBeGreaterThan(0);
    expect(on.filter((x) => x.R >= 3.05).length).toBe(0);
  });

  it('thin smoothly between R = 1.7 and 2.5 rather than step at 2.1', () => {
    const on = stars(spiral({ starsAuto: 1 }));
    const off = stars(spiral());
    // the share of the drawn stars in the first and the last part of the taper
    const share = (s: { R: number }[], a: number, b: number) =>
      s.filter((x) => x.R >= a && x.R < b).length;
    // with 0 the weight is 1 up to 2.1: the 1.7-2.1 band is not thinned. With 1 it already is
    const bandOn = share(on, 1.9, 2.1) / Math.max(1, share(on, 1.5, 1.7));
    const bandOff = share(off, 1.9, 2.1) / Math.max(1, share(off, 1.5, 1.7));
    expect(bandOn).toBeLessThan(bandOff);
  });

  it('are the same stars with a galaxy that has no arms and no ring, inside R = 1.7', () => {
    // a plain disc: the weights agree (0.85 either way) where the taper has not begun
    const P = spiral({ arms: 0, bar: 0, ring: 0, bulge: 0.05 });
    const inner = (s: { R: number }[]) => s.filter((x) => x.R < 1.2).length;
    const a = inner(stars(P));
    const b = inner(stars({ ...P, starsAuto: 1 }));
    expect(Math.abs(a - b)).toBeLessThan(Math.max(8, 0.05 * a));
  });

  it('are deterministic', () => {
    const P = spiral({ starsAuto: 1 });
    expect(stars(P)).toEqual(stars(P));
  });
});
