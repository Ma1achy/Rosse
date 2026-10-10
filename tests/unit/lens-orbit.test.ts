/**
 * The lensed source under orbit. By default it is v21's: fixed in 3D behind the lens (`srcNow`,
 * app23.js:L450), so orbiting slides it across the lens and the images change. With `lensLock`
 * (ADR 0072) it follows the lens frame, so a ring stays a ring. At the home pose both agree.
 */
import { describe, expect, it } from 'vitest';
import { presetParams } from '../../src/core/presets';
import { lensHomeOf } from '../../src/core/home';
import { buildScene } from '../../src/model/scene';
import { describeLens, lensView } from '../../src/sim/lens';
import { cameraOf, srcNow } from '../../src/view/camera';
import { FULL_META } from './support/meta';

const NAMES = ['Lens: Einstein ring', 'Lens: double Einstein ring', 'Lens: galaxy cluster'];

describe('the lensed source under orbit', () => {
  for (const name of NAMES) {
    const P = presetParams(name, 7);
    const L = describeLens(P, FULL_META, buildScene);
    const Ll = describeLens({ ...P, lensLock: 1 }, FULL_META, buildScene);
    const home = lensHomeOf(P);
    const cam0 = cameraOf(P);
    const src = (i: number) => L.sources[i] as (typeof L.sources)[number];

    it(`${name}: at the home pose the offsets are srcNow's, locked or not`, () => {
      const lv = lensView(L, cam0);
      const lk = lensView(Ll, cam0);
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
        expect(lk.bc[i]?.[0]).toBeCloseTo(old[0], 5);
        expect(lk.bc[i]?.[1]).toBeCloseTo(old[1], 5);
      });
    });

    it(`${name}: an eased lens slides a third as far as v21's`, () => {
      const e = describeLens({ ...P, lensLock: 2 }, FULL_META, buildScene);
      const cam = { ...cam0, incl: cam0.incl + 15 };
      const a = lensView(L, cam).bc[0] ?? [0, 0];
      const b = lensView(e, cam).bc[0] ?? [0, 0];
      const s0 = src(0);
      expect(b[0] - s0.bx).toBeCloseTo(0.35 * (a[0] - s0.bx), 4);
      expect(b[1] - s0.by).toBeCloseTo(0.35 * (a[1] - s0.by), 4);
    });

    it(`${name}: orbiting moves the source across the lens, unless it is locked`, () => {
      const base = lensView(L, cam0);
      const cam = { ...cam0, incl: cam0.incl + 15 };
      const moved = lensView(L, cam);
      const d = Math.hypot(
        (moved.bc[0]?.[0] ?? 0) - (base.bc[0]?.[0] ?? 0),
        (moved.bc[0]?.[1] ?? 0) - (base.bc[0]?.[1] ?? 0),
      );
      expect(d, 'the source slides').toBeGreaterThan(0.1 * P.lensR);
      expect(src(0).depth).toBeGreaterThan(0);
      expect(lensView(Ll, cam).bc).toEqual(lensView(Ll, cam0).bc);
    });
  }
});
