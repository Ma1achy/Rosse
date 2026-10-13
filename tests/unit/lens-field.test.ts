/**
 * The deep field through the lens (`lensField`, ADR 0097): a background point is a source, its
 * primary image is where the lens puts it, and a shape there is stretched by A⁻¹.
 */
import { describe, expect, it } from 'vitest';
import { DEF } from '../../src/core/params';
import { presetParams } from '../../src/core/presets';
import { lensImage } from '../../src/fallback/kernels/sky';
import { deflection, lensModel, skyLens } from '../../src/sim/lens';
import { cameraOf, PLATE } from '../../src/view/camera';

const ring = (over: object = {}) => presetParams('Lens: Einstein ring', 7, over);

describe('lensField', () => {
  it('is off in the core, and a lens needs lensOn too', () => {
    expect(DEF.lensField).toBe(0);
    expect(skyLens(ring(), cameraOf(ring()))).toBeUndefined();
    expect(skyLens(ring({ lensField: 1, lensOn: 0 }), cameraOf(ring()))).toBeUndefined();
    expect(skyLens(ring({ lensField: 1 }), cameraOf(ring()))).toBeDefined();
  });

  it('solves the lens equation: the image maps back to the source', () => {
    const P = ring({ lensField: 1 });
    const cam = cameraOf(P);
    const L = skyLens(P, cam);
    if (!L) throw new Error('no lens');
    const M = lensModel(P, 1.3);
    for (const [px, py] of [
      [PLATE / 2 + 60, PLATE / 2 + 30],
      [PLATE / 2 - 140, PLATE / 2 + 90],
      [PLATE / 2 + 20, PLATE / 2 - 220],
    ] as const) {
      const im = lensImage(L, px, py);
      // undo the rotation to lens units, then β = θ − α(θ)
      const dx = (im.x - PLATE / 2) / L.scale;
      const dy = (im.y - PLATE / 2) / L.scale;
      const tx = dx * L.cos + dy * L.sin;
      const ty = -dx * L.sin + dy * L.cos;
      const a = deflection(M, tx, ty);
      const sx = ((px - PLATE / 2) / L.scale) * L.cos + ((py - PLATE / 2) / L.scale) * L.sin;
      const sy = -((px - PLATE / 2) / L.scale) * L.sin + ((py - PLATE / 2) / L.scale) * L.cos;
      expect(Math.hypot(tx - a[0] - sx, ty - a[1] - sy)).toBeLessThan(2e-3);
    }
  });

  it('moves a source out by its deflection and leaves a far one almost unsheared', () => {
    const P = ring({ lensField: 1 });
    const L = skyLens(P, cameraOf(P));
    if (!L) throw new Error('no lens');
    const far = lensImage(L, PLATE / 2 + 380, PLATE / 2);
    // outward, by about the deflection (constant for an isothermal lens)
    expect(far.x - PLATE / 2).toBeGreaterThan(380);
    const push = Math.hypot(far.x - PLATE / 2 - 380, far.y - PLATE / 2);
    expect(push).toBeGreaterThan(0.5 * 1.3 * P.lensR * L.scale);
    expect(push).toBeLessThan(1.5 * 1.3 * P.lensR * L.scale);
    // the far map is close to the identity
    expect(far.m[0]).toBeGreaterThan(0.7);
    expect(far.m[3]).toBeGreaterThan(0.7);
    expect(Math.abs(far.m[1]) + Math.abs(far.m[2])).toBeLessThan(0.3);
  });

  it('stretches a shape tangentially round the lens', () => {
    const P = ring({ lensField: 1 });
    const L = skyLens(P, cameraOf(P));
    if (!L) throw new Error('no lens');
    const s = lensImage(L, PLATE / 2 + 120, PLATE / 2);
    // the point sits on the +x axis: radial = x, tangential = y; a tangential stretch grows y
    const rad = Math.hypot(s.m[0], s.m[1]);
    const tan = Math.hypot(s.m[2], s.m[3]);
    expect(Math.abs(rad - tan)).toBeGreaterThan(0.05);
  });
});
