/**
 * The lensed source follows the lens frame (ADR 0072): orbiting never moves it relative to the
 * lens, so the Einstein ring stays a ring. At the home pose the offsets are those of v21's
 * `srcNow` (app23.js:L450), the behaviour before the change.
 */
import { describe, expect, it } from 'vitest';
import { presetParams } from '../../src/core/presets';
import { lensHomeOf } from '../../src/core/home';
import { buildScene } from '../../src/model/scene';
import { describeLens, lensView, sourceDepth, sourceOffset } from '../../src/sim/lens';
import { cameraOf, srcNow } from '../../src/view/camera';
import { FULL_META } from './support/meta';

const NAMES = ['Lens: Einstein ring', 'Lens: double Einstein ring', 'Lens: galaxy cluster'];

describe('the lensed source under orbit', () => {
  for (const name of NAMES) {
    const P = presetParams(name, 7);
    const L = describeLens(P, FULL_META, buildScene);
    const home = lensHomeOf(P);
    const cam0 = cameraOf(P);

    it(`${name}: at the home pose the offsets equal srcNow's`, () => {
      const lv = lensView(L, cam0);
      L.sources.forEach((s, i) => {
        const old = srcNow(
          { incl: home.incl, az: home.az, w: home.w, pa: 0 },
          s.bx,
          s.by,
          s.depth,
          cam0,
        );
        expect(lv.bc[i]?.[0]).toBeCloseTo(old[0], 5);
        expect(lv.bc[i]?.[1]).toBeCloseTo(old[1], 5);
      });
    });

    for (const delta of [5, 15, 30])
      it(`${name}: orbiting ${String(delta)} deg leaves the lens output unchanged`, () => {
        const base = lensView(L, cam0);
        for (const [di, da] of [
          [delta, 0],
          [0, delta],
          [-delta, delta],
        ] as const) {
          const cam = { ...cam0, incl: cam0.incl + di, az: cam0.az + da };
          const lv = lensView(L, cam);
          expect(lv.bc).toEqual(base.bc);
          expect(lv.U).toBe(base.U);
        }
      });
  }

  it('the old model moved the source with the orbit (the bug this removes)', () => {
    const P = presetParams('Lens: Einstein ring', 7);
    const home = lensHomeOf(P);
    const cam = { ...cameraOf(P), incl: P.incl + 15 };
    const D = sourceDepth.main(P.lensR);
    const old = srcNow({ incl: home.incl, az: home.az, w: home.w, pa: 0 }, 0, 0, D, cam);
    expect(Math.hypot(old[0], old[1])).toBeGreaterThan(0.4 * P.lensR);
    expect(sourceOffset(0, 0)).toEqual([0, 0]);
  });
});
