/**
 * The sky (src/model/sky.ts, src/fallback/kernels/sky.ts) against v21's own `buildSky` and
 * `skyParts` (app23.js:L867–920), cut out of the reference and evaluated as written
 * (tests/golden/compare/v21-sky.ts): with v21's catalogue, the engine culls the same galaxies and
 * foreground stars, makes the same number of dots, and lays the same drawings with the same
 * matrices (the plane's tilt, the shear round a mass, the copies of an arms drawing) at the same
 * places, at several cameras and zooms. The companions are placed as v21 places them. The
 * engine's own catalogue has v21's distributions. The view tier's dispatch bound holds the
 * visible galaxies.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Params } from '../../src/core/params';
import { presetParams } from '../../src/core/presets';
import { CpuStipple } from '../../src/fallback/stipple';
import { skyBound, skyInputs } from '../../src/fallback/kernels/sky';
import { buildScene } from '../../src/model/scene';
import { SKY_NP_MAX, describeSky, ownCatalogue, skyCounts } from '../../src/model/sky';
import { packedLibrary } from '../../src/model/vectors';
import { describeParts, vectorRows } from '../../src/model/parts';
import { cameraOf, viewDesc } from '../../src/view/camera';
import { v21Variation } from '../golden/compare/v21';
import { mulberry32 } from '../golden/compare/v21';
import { v21Companions, v21Sky } from '../golden/compare/v21-sky';
import { META, ROOT, sameMoments } from './support/vectors';
import { makeVariation } from '../../src/model/variation';
import { packNoise } from '../../src/core/noise';

const FG_TILES = (
  JSON.parse(readFileSync(resolve(ROOT, 'assets-built/index.json'), 'utf8')) as {
    atlases: { fgstars: { layers: number } };
  }
).atlases.fgstars.layers;
const META_FG = { ...META, fgstars: { count: FG_TILES } };

const CASES: [string, Params][] = [
  ['Deep field s7 (massive)', presetParams('Deep field', 7)],
  ['Grand design s7, field 1', presetParams('Grand design', 7, { field: 1, fgstars: 0.8 })],
  ['Star: bright s4242', presetParams('Star: bright, with spikes', 4242)],
  // (the harness's `inst` does not wobble; the wobble itself is tested with the stipple's marks)
  ['Hand wobble s11, field 0.6', presetParams('Hand wobble', 11, { field: 0.6, distort: 0 })],
  ['Smooth, round s3, field 1', presetParams('Smooth, round', 3, { field: 1 })],
];

function cameras(P: Params): [string, Params, number][] {
  return [
    ['home', P, 1],
    ['orbit', { ...P, az: P.az + 35, incl: Math.min(180, P.incl + 20) }, 1],
    ['zoom 0.4', P, 0.4],
    ['zoom 2.5', P, 2.5],
  ];
}

describe("the deep field and the foreground stars: v21's own, on v21's catalogue", () => {
  for (const [name, P0] of CASES)
    for (const [cam, P, zoom] of cameras(P0))
      it(`${name}, ${cam}`, () => {
        const V = v21Variation(P, META_FG);
        const v21 = v21Sky(ROOT, P, V, META_FG, FG_TILES, zoom);
        const scene = buildScene(P, META_FG, { variation: V, sky: v21.catalogue });
        const view = new CpuStipple(scene).view(cameraOf(P, zoom));
        const sky = view.sky;
        if (!sky) throw new Error('no sky');
        // the dots of the deep field: np each, no rejection
        expect(sky.nDots, 'dots').toBe(v21.L.bgdots.length);
        // the galaxies' drawings: the same rows
        // (a deep-field galaxy may be drawn from the `companions` sheet; no companions are asked
        // for here, so every row of the lists is a galaxy's)
        const v21Rows = [...v21.L.bg, ...v21.L.front];
        expect(sky.nRows, 'drawings').toBe(v21Rows.length);
        const lib = scene.vectors.lib;
        const mine = new Float32Array(sky.rows);
        const mineU = new Uint32Array(sky.rows);
        const rows: { x: number; y: number; m: number[]; drawing: number }[] = [];
        for (let k = 0; k < sky.nRows; k++) {
          const o = k * 24;
          rows.push({
            x: mine[o + 4] ?? 0,
            y: mine[o + 5] ?? 0,
            m: [mine[o] ?? 0, mine[o + 1] ?? 0, mine[o + 2] ?? 0, mine[o + 3] ?? 0],
            drawing: mineU[o + 16] ?? 0,
          });
        }
        const theirs = v21Rows
          .map((o) => ({
            x: o.row[0] ?? 0,
            y: o.row[1] ?? 0,
            m: [o.row[4] ?? 0, o.row[5] ?? 0, o.row[6] ?? 0, o.row[7] ?? 0],
            drawing: lib.first[o.k as 'whole' | 'env' | 'arms'] + (o.row[2] ?? 0),
            ps: o.row[8] ?? 0,
          }))
          .sort((a, b) => a.x - b.x || a.y - b.y);
        rows.sort((a, b) => a.x - b.x || a.y - b.y);
        const worst = { pos: 0, mat: 0 };
        for (let i = 0; i < rows.length; i++) {
          const a = rows[i];
          const b = theirs[i];
          if (!a || !b) continue;
          expect(a.drawing, `row ${String(i)} drawing`).toBe(b.drawing);
          expect(b.ps).toBeCloseTo(0.42, 5);
          worst.pos = Math.max(worst.pos, Math.hypot(a.x - b.x, a.y - b.y));
          const scale = Math.hypot(b.m[0] ?? 0, b.m[1] ?? 0, b.m[2] ?? 0, b.m[3] ?? 0) || 1;
          for (let j = 0; j < 4; j++)
            worst.mat = Math.max(worst.mat, Math.abs((a.m[j] ?? 0) - (b.m[j] ?? 0)) / scale);
        }
        expect(worst.pos, 'row positions').toBeLessThan(0.01);
        expect(worst.mat, 'row matrices (relative)').toBeLessThan(2e-4);
        // the foreground stars
        expect(sky.nFg, 'foreground stars').toBe(v21.L.fgstars.length);
        const fg = (list: ArrayLike<number>, n: number, stride: number) =>
          Array.from(
            { length: n },
            (_, i) => [list[i * stride] ?? 0, list[i * stride + 1] ?? 0] as [number, number],
          ).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const a = fg(sky.fg, sky.nFg, 8);
        const b = fg(v21.L.fgstars.flat(), v21.L.fgstars.length, 8);
        for (let i = 0; i < a.length; i++) {
          expect(Math.abs((a[i]?.[0] ?? 0) - (b[i]?.[0] ?? 0))).toBeLessThan(0.01);
          expect(Math.abs((a[i]?.[1] ?? 0) - (b[i]?.[1] ?? 0))).toBeLessThan(0.01);
        }
        // the dispatch bound holds the visible galaxies, with a margin
        const X = skyInputs(
          scene.sky ?? (undefined as never),
          {
            V: viewDesc(cameraOf(P, zoom), 0, 0, 0),
            key: 0,
            wobble: 0,
            nDotPool: scene.galaxy.g.n_dot_pool,
            massive: false,
          },
          scene.galaxy.pool,
          scene.galaxy.dotBase,
          packNoise(),
        );
        expect(skyBound(X)).toBeGreaterThanOrEqual(Math.min(sky.visible.length, X.S.visCap));
        expect(sky.visible.every((v) => v.np <= SKY_NP_MAX)).toBe(true);
      });
});

describe("the companions: placed as v21's skyParts places them", () => {
  it('the same drawings at the same places, with the same matrices', () => {
    for (const zoom of [1, 2]) {
      const P = presetParams('Grand design', 7, { companions: 1, field: 0, fgstars: 0 });
      const V = v21Variation(P, META_FG);
      const v21 = v21Sky(ROOT, P, V, META_FG, FG_TILES, zoom);
      const picks = v21Companions(P, META_FG.vectors?.companions?.n ?? 0, mulberry32);
      const theirs = [...v21.L.bg, ...v21.L.front]
        .filter((o) => o.k === 'companions')
        .sort((a, b) => (a.row[0] ?? 0) - (b.row[0] ?? 0));
      expect(picks.length).toBe(theirs.length);
      const parts = describeParts(P, V, META_FG, P.incl);
      const rows = vectorRows(P, V, META_FG, parts, cameraOf(P, zoom), picks)
        .filter((r) => r.atlas === 'companions')
        .sort((a, b) => a.x - b.x);
      expect(rows.length).toBe(theirs.length);
      rows.forEach((r, i) => {
        const t = theirs[i]?.row ?? [];
        expect(r.x).toBeCloseTo(t[0] ?? 0, 6);
        expect(r.y).toBeCloseTo(t[1] ?? 0, 6);
        expect(r.tile).toBe(t[2]);
        for (let j = 0; j < 4; j++) expect(r.m[j]).toBeCloseTo(t[4 + j] ?? 0, 6);
      });
    }
  });
});

describe("the engine's own catalogue has v21's distributions", () => {
  it('galaxies and foreground stars over 300 seeds', { timeout: 300_000 }, () => {
    const own = {
      x: [] as number[],
      rad: [] as number[],
      item: [] as number[],
      na: [] as number[],
      bulge: [] as number[],
      spin: [] as number[],
      R: [] as number[],
      fgX: [] as number[],
      fgR: [] as number[],
      fgSize: [] as number[],
    };
    const ref = {
      x: [] as number[],
      rad: [] as number[],
      item: [] as number[],
      na: [] as number[],
      bulge: [] as number[],
      spin: [] as number[],
      R: [] as number[],
      fgX: [] as number[],
      fgR: [] as number[],
      fgSize: [] as number[],
    };
    const fill = (t: typeof own, c: ReturnType<typeof ownCatalogue>) => {
      for (const g of c.bg) {
        t.x.push(g.w[0]);
        t.R.push(Math.hypot(g.w[0], g.w[1], g.w[2]));
        t.rad.push(g.rad);
        t.item.push(g.item / 231);
        t.na.push(g.na);
        t.bulge.push(g.bulge);
        t.spin.push(g.spin);
      }
      for (const s of c.fg) {
        t.fgX.push(s.w[0]);
        t.fgR.push(Math.hypot(s.w[0], s.w[1], s.w[2]));
        t.fgSize.push(s.size);
      }
    };
    for (let s = 1; s <= 300; s++) {
      const P = presetParams('Deep field', s, { field: 0.1, fgstars: 0.3 });
      const nItems =
        describeSky(P, META_FG, packedLibrary(META_FG.vectors), FG_TILES, s)?.items.length ?? 1;
      fill(own, ownCatalogue(P, nItems, { fgstars: FG_TILES, companions: 10 }, s));
      fill(ref, v21Sky(ROOT, P, makeVariation(P, META_FG), META_FG, FG_TILES).catalogue);
    }
    for (const k of ['x', 'R', 'rad', 'na', 'bulge', 'spin', 'fgX', 'fgR', 'fgSize'] as const)
      sameMoments(`catalogue ${k}`, own[k], ref[k]);
    expect(skyCounts(presetParams('Deep field', 7)).bg).toBe(1793);
  });
});
