/**
 * The weak lensing of the deep field round a cluster (app23.js:L1273–1278), the hook the M7 deep
 * field calls (src/sim/lens.ts `weakLensing`), against v21's own lines, cut out of app23.js and
 * evaluated as written with v21's own deflection at strength 1.3.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { presetParams } from '../../src/core/presets';
import { lensModel, weakLensing } from '../../src/sim/lens';
import { PLATE, viewScale, type Camera } from '../../src/view/camera';
import { v21LensOracle } from '../golden/compare/v21-lens';
import { ROOT } from './support/meta';

const SRC = readFileSync(resolve(ROOT, 'assets/reference/rosse-source/app23.js'), 'utf8');
const START = SRC.indexOf('var a0 = WM.alpha(x, y)');
const END_TOKEN = 'S22 = sw2 * (M11 * sw2 + M12 * cw2) + cw2 * (M21 * sw2 + M22 * cw2);';
const END = SRC.indexOf(END_TOKEN, START) + END_TOKEN.length;
// v21's block as a function: its `return` (a row it leaves alone) gives undefined
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const v21Block = new Function(
  'WM',
  'cw2',
  'sw2',
  'x',
  'y',
  'h',
  `${SRC.slice(START, END)}; return [S11, S12, S21, S22];`,
) as (
  WM: { alpha(x: number, y: number): [number, number] },
  cw2: number,
  sw2: number,
  x: number,
  y: number,
  h: number,
) => [number, number, number, number] | undefined;

describe('weak lensing of the deep field (app23.js:L1273–1278)', () => {
  const P = presetParams('Lens: galaxy cluster', 7);
  const oracle = v21LensOracle(ROOT);
  const theirs = oracle.model(P, 1.3);
  const mine = lensModel(P, 1.3, { halos: theirs.halos.filter((h) => h.member) });

  for (const zoom of [1, 2]) {
    for (const pa of [0, 20, 130]) {
      it(`pa ${String(pa)}°, zoom ${String(zoom)}`, () => {
        const cam: Camera = { incl: 88, az: 0, pa, winding: 1, zoom };
        const U = viewScale(zoom);
        const paR = (pa * Math.PI) / 180;
        let compared = 0;
        let skipped = 0;
        for (let i = 0; i < 300; i++) {
          const X = ((i * 97) % 800) + 0.3;
          const Y = ((i * 211) % 800) + 0.7;
          const dx = (X - PLATE / 2) / U;
          const dy = (Y - PLATE / 2) / U;
          const x = dx * Math.cos(paR) + dy * Math.sin(paR);
          const y = -dx * Math.sin(paR) + dy * Math.cos(paR);
          const t = v21Block(theirs, Math.cos(paR), Math.sin(paR), x, y, 0.01);
          const m = weakLensing(mine, X, Y, cam);
          if (!t) {
            expect(m).toBeNull();
            skipped++;
            continue;
          }
          expect(m).not.toBeNull();
          const [S11, S12, S21, S22] = t;
          // ours is column-major
          const want = [S11, S21, S12, S22];
          m?.forEach((v, k) => {
            expect(v).toBeCloseTo(want[k] ?? 0, 10);
          });
          compared++;
        }
        expect(compared + skipped).toBe(300);
        expect(compared).toBeGreaterThan(50);
      });
    }
  }
});
