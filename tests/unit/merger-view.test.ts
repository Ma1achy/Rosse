/**
 * The merger's marks and tides on the CPU engine against v21's own `mergerSprites()` (cut out of
 * app23.js and evaluated as written, tests/golden/compare/v21-merger.ts), from identical starts: the
 * engine's initial conditions go through v21's integrator, so both see the same stars to f32. Checked:
 * the framing (`MS.sc`), the classes of the marks (v21's lists against the engine's classes, before the
 * thinning of render()), the 49 × 49 tidal grids of both galaxies, and the screen map of `mWarp`.
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Params } from '../../src/core/params';
import { presetParams } from '../../src/core/presets';
import { CpuMerger } from '../../src/fallback/merger';
import { CpuMergerStars } from '../../src/fallback/kernels/merger';
import { runMergerSprites } from '../../src/fallback/kernels/merger-sprites';
import { TIDE_GN, TIDE_GV } from '../../src/fallback/kernels/tide';
import { mergerViewUniform } from '../../src/model/merger';
import { Cls } from '../../src/model/classes';
import { GoldenNode } from '../golden/compare/node';
import { v21MergerView } from '../golden/compare/v21-merger';

const ROOT = resolve(import.meta.dirname, '../..');

const CASES: [string, Params, number][] = [
  ['the Mice, home', presetParams('Merger: the Mice', 7, { starMix: 0.6 }), 1],
  [
    'long tails, orbit and zoom 1.5',
    presetParams('Merger: long tails', 4242, { az: 35, incl: 75 }),
    1.5,
  ],
  ['spiral meets elliptical', presetParams('Merger: spiral meets elliptical', 7), 1],
  ['dry (two ellipticals)', presetParams('Merger: dry (two ellipticals)', 7), 1],
  ['the Mice at mTime 0.5', presetParams('Merger: the Mice', 4242, { mTime: 0.5 }), 1],
  ['the Mice at mTime 1.5', presetParams('Merger: the Mice', 7, { mTime: 1.5 }), 1],
];

const node = new GoldenNode(ROOT);

describe('mergerSprites against v21, from the same starts', () => {
  for (const [name, P, zoom] of CASES)
    it(name, () => {
      const opts = node.referenceOptions(P, zoom).merger;
      const m = new CpuMerger(P, node.cpu.meta, opts);
      const D = m.scene.desc;
      // the engine's starts in v21's layout
      const s0 = new CpuMergerStars(D);
      s0.init();
      const X = new Float32Array(D.total * 3);
      const V = new Float32Array(D.total * 3);
      const R0 = new Float32Array(D.total);
      const DX = new Float32Array(D.total);
      const DY = new Float32Array(D.total);
      for (let i = 0; i < D.total; i++)
        for (let k = 0; k < 3; k++) {
          X[i * 3 + k] = s0.xs[i * 4 + k] as number;
          V[i * 3 + k] = s0.vs[i * 4 + k] as number;
        }
      for (let i = 0; i < D.total; i++) {
        DX[i] = s0.ic[i * 4] as number;
        DY[i] = s0.ic[i * 4 + 1] as number;
        R0[i] = s0.ic[i * 4 + 2] as number;
      }
      const v = m.scene.variation;
      const view = v21MergerView(
        ROOT,
        P,
        {
          dotPool: v.dotPool,
          knotPool: v.knotPool,
          spike: v.spike,
          dotSizes: Array.from(node.cpu.meta.dots.size),
          nStarTiles: node.cpu.meta.stars.count,
        },
        zoom,
        { X, V, R0, DX, DY },
      );
      // the engine at the same view, without the thinning
      const cv = m.view(zoom);
      const fr = cv.framing;
      expect(fr.sc / view.sc, 'the framing, MS.sc').toBeCloseTo(1, 3);
      expect(fr.scale / view.scale, 'MS.scale').toBeCloseTo(1, 3);
      const mv = mergerViewUniform(m.scene, fr, zoom);
      mv.keep_dots = 1;
      mv.keep_knots = 1;
      mv.keep_rstars = 1;
      const cur = m.stars.blend(fr.sel);
      const marks = runMergerSprites(mv, cur, m.stars.ic, m.scene.pool, m.scene.dotBase);
      const count = (c: number) => marks.classes.reduce((a, k) => a + (k === c ? 1 : 0), 0);
      const mine = {
        dots: count(Cls.disc) + count(Cls.young),
        young: count(Cls.young),
        knots: count(Cls.knot),
        stars: count(Cls.star),
        rstars: count(Cls.rstar),
      };
      const theirs = {
        dots: view.disc.length + view.young.length,
        young: view.young.length,
        knots: view.knots.length,
        stars: view.stars.length,
        rstars: view.rstars.length,
      };
      console.log(
        `${name}: engine ${JSON.stringify(mine)} | v21 ${JSON.stringify(theirs)} (v21's lists include bulge dots in old: ${String(0)})`,
      );
      // dots and young: the same stars, a few ± Poisson (the draws differ)
      // knots come in clusters of 5 to 11 (a knot of new stars in a tail), so their count's variance
      // is about 8 times Poisson's; drawn stars come singly, or with a cluster's bright one
      const sig = (a: number, b: number, cluster = 1) =>
        4 * Math.sqrt(cluster * (a + b + 1)) + 0.002 * (a + b);
      for (const k of ['dots', 'young', 'knots', 'stars', 'rstars'] as const)
        expect(Math.abs(mine[k] - theirs[k]), k).toBeLessThanOrEqual(
          sig(mine[k], theirs[k], k === 'knots' ? 8 : 1),
        );

      // the tidal grids: the engine's, from its own star table, against v21's `tidal` at every vertex
      m.tide.buildGrid();
      for (const g of [0, 1] as const) {
        const grid = view.grid(g);
        let near = 0;
        let worst = 0;
        let total = 0;
        for (let gy = 0; gy < TIDE_GV; gy++)
          for (let gx = 0; gx < TIDE_GV; gx++) {
            const o = (gy * TIDE_GV + gx) * 2;
            const mine2 = m.tide.nn(g, gx / TIDE_GN - 0.5, gy / TIDE_GN - 0.5);
            const d = Math.hypot(
              mine2[0] - (grid[o] as number),
              mine2[1] - (grid[o + 1] as number),
            );
            total++;
            if (d < 0.5) near++;
            worst = Math.max(worst, d);
          }
        console.log(
          `${name}: galaxy ${String(g)}: ${((100 * near) / total).toFixed(1)}% of the grid within 0.5 px of v21's (worst ${worst.toFixed(1)} px)`,
        );
        // a vertex may take another neighbour where two stars are all but tied
        expect(near / total).toBeGreaterThan(0.97);
      }
      // mWarp's map on drawing coordinates, both mirrors
      let ok = 0;
      let n = 0;
      for (const g of [0, 1] as const)
        for (const flip of [false, true])
          for (let k = 0; k < 200; k++) {
            const x = Math.sin(k * 12.9898) * 0.5;
            const y = Math.cos(k * 78.233) * 0.5;
            const a = view.tidal(g, flip, x, y);
            const b = m.tide.nn(g, flip ? -x : x, y);
            n++;
            if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.5) ok++;
          }
      expect(ok / n, 'the screen map of mWarp').toBeGreaterThan(0.97);
    });
});
