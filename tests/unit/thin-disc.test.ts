/** The thin disc (ADR 0083): `thinAuto` 0 is v21's exponential disc, 1 a thinner one with a stopped tail. */
import { describe, expect, it } from 'vitest';
import { DEF } from '../../src/core/params';
import { presetParams } from '../../src/core/presets';
import { SCHEMA } from '../../src/core/schema';
import { runStipple } from '../../src/fallback/kernels/stipple';
import { GalaxyFlag } from '../../src/model/galaxy';
import { buildScene } from '../../src/model/scene';
import { META } from './support/vectors';

const heights = (thinAuto: number) => {
  const P = presetParams('Disc, no arms', 7, {
    thinAuto,
    bulge: 0,
    halo: 0,
    stars: 30000,
    field: 0,
  });
  const s = runStipple(buildScene(P, META).galaxy);
  const z: number[] = [];
  for (let i = 0; i < s.n; i++)
    if (s.u32[i * 8 + 3] && Math.hypot(s.f32[i * 8] ?? 0, s.f32[i * 8 + 1] ?? 0) < 2.5)
      z.push(Math.abs(s.f32[i * 8 + 2] ?? 0));
  return z.sort((a, b) => a - b);
};
const q = (z: number[], p: number) => z[Math.floor(p * z.length)] ?? 0;

describe('thinAuto', () => {
  it('is off in the core, and sets the flag only when on', () => {
    expect(DEF.thinAuto).toBe(0);
    expect(SCHEMA.thinAuto).toMatchObject({ kind: 'choice', tier: 'model' });
    const f = (t: number) =>
      buildScene(presetParams('Grand design', 7, { thinAuto: t }), META).galaxy.g.flags;
    expect(f(0) & GalaxyFlag.thinDisc).toBe(0);
    expect(f(1) & GalaxyFlag.thinDisc).not.toBe(0);
  });

  it('packs far more of the disc into the plane, and keeps a few wanderers off it', () => {
    const a = heights(0);
    const b = heights(1);
    const within = (z: number[], h: number) => z.filter((x) => x < h).length / z.length;
    expect(q(b, 0.5)).toBeLessThan(0.6 * q(a, 0.5));
    expect(within(b, 0.04)).toBeGreaterThan(within(a, 0.04) + 0.15);
    expect(within(b, 0.3)).toBeLessThan(1);
    expect(q(b, 0.995)).toBeGreaterThan(0.1);
  });

  it('leaves a round galaxy without a ring at the bulge cut: the stipple thins out, not piles up', () => {
    const P = presetParams('Smooth, round', 7, {
      thinAuto: 1,
      bulgeAuto: 1,
      stars: 30000,
      field: 0,
    });
    const G = buildScene(P, META).galaxy;
    const s = runStipple(G);
    const r: number[] = [];
    for (let i = 0; i < s.n; i++)
      if (s.u32[i * 8 + 3]) r.push(Math.hypot(s.f32[i * 8] ?? 0, s.f32[i * 8 + 1] ?? 0));
    const top = Math.max(...r);
    const shell = (lo: number, hi: number) => r.filter((x) => x > lo * top && x <= hi * top).length;
    // the outermost tenth of the radius holds fewer stars than the tenth inside it
    expect(shell(0.9, 1)).toBeLessThan(shell(0.8, 0.9));
  });
});
