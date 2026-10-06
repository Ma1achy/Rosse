/**
 * The line-work's scene description (src/model/curves.ts, lanes.ts, clumps.ts, ribbons.ts) against
 * v21's own code, cut out of app23.js and evaluated as written (tests/golden/compare/v21-curves.ts):
 * with v21's variation, stroke choices and noise corners, the engine must lay out the same curves
 * and the same lane points. Also the lattice noise's statistics against v21's sin-hash noise
 * (deliberate divergence 5: other patterns, the same statistics), the packing, and the CPU
 * kernels' invariants (arc lengths, slots, taper).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NoiseSalt, packNoise, vnoise } from '../../src/core/noise';
import type { Params } from '../../src/core/params';
import { presetParams } from '../../src/core/presets';
import { ribbonModel, runRibbons } from '../../src/fallback/kernels/ribbons';
import { CURVE_STATE_WORDS, CurveFlag, ribUniform } from '../../src/model/ribbons';
import { curves } from '../../src/model/curves';
import { dustLanes } from '../../src/model/lanes';
import { markGroups } from '../../src/model/clumps';
import { buildScene, drawingsMeta } from '../../src/model/scene';
import { atlasFromBytes, type BuiltIndex } from '../../src/marks/atlas';
import type { VectorSheet } from '../../src/marks/vector';
import { cameraOf, incE, project, structureKey, viewDesc } from '../../src/view/camera';
import { v21Variation } from '../golden/compare/v21';
import { v21CurvePicks, v21Lines } from '../golden/compare/v21-curves';
import { v21NoiseTables } from '../golden/compare/v21-noise';

const ROOT = resolve(import.meta.dirname, '../..');
const BUILT = resolve(ROOT, 'assets-built');
const index = JSON.parse(readFileSync(resolve(BUILT, 'index.json'), 'utf8')) as BuiltIndex;
const atlas = (n: 'dots' | 'knots' | 'stars' | 'cores' | 'strokes') =>
  atlasFromBytes(
    n,
    index.atlases[n],
    new Uint8Array(readFileSync(resolve(BUILT, index.atlases[n].file))),
  );
const penlines = JSON.parse(
  readFileSync(resolve(BUILT, index.vectors.penlines?.file ?? ''), 'utf8'),
) as VectorSheet;
const M = drawingsMeta(
  {
    dots: atlas('dots'),
    knots: atlas('knots'),
    stars: atlas('stars'),
    cores: atlas('cores'),
    strokes: atlas('strokes'),
  },
  penlines,
);
const KINDS = M.strokes?.kind ?? [];

const M4 = { starMix: 0, field: 0, fgstars: 0, bubbles: 0 };
const CASES: [string, Params][] = [
  ['Grand design s7', presetParams('Grand design', 7, M4)],
  ['Grand design s4242', presetParams('Grand design', 4242, M4)],
  [
    'Barred spiral s7 (ribbon bar and ring)',
    presetParams('Barred spiral', 7, { ...M4, barStyle: 'ribbon', ringStyle: 'ribbon' }),
  ],
  ['Tightly wound s4242', presetParams('Tightly wound', 4242, M4)],
  ['Loose, open arms s7', presetParams('Loose, open arms', 7, M4)],
  ['Dusty spiral s4242', presetParams('Dusty spiral', 4242, M4)],
  ['Hand wobble s7', presetParams('Hand wobble', 7, M4)],
  ['Edge-on with dust s7 (incl 88)', presetParams('Edge-on with dust', 7)],
  ['Grand design s7 at incl 99', presetParams('Grand design', 7, { ...M4, incl: 99 })],
  ['Flocculent s4242', presetParams('Flocculent', 4242, M4)],
];

describe('curves against v21 (app23.js:L768–800)', () => {
  for (const [name, P] of CASES)
    it(name, () => {
      const V = v21Variation(P, M);
      const picks = v21CurvePicks(ROOT, P, V, KINDS);
      const field = packNoise(v21NoiseTables(ROOT, P.seed));
      const ours = curves(P, V, M.strokes, P.incl, picks, field);
      const theirs = v21Lines(ROOT, P, V, KINDS).curves;
      expect(ours.length).toBe(theirs.length);
      ours.forEach((c, i) => {
        const t = theirs[i];
        if (!t) throw new Error('missing');
        expect(c.k).toBe(t.k);
        expect(c.w).toBeCloseTo(t.w, 12);
        expect(c.pts.length).toBe(t.pts.length);
        // outline and tail angles are drawn from each engine's own stream
        if (c.role === 'outline' || c.role === 'tail') return;
        let worst = 0;
        c.pts.forEach((p, j) => {
          const q = t.pts[j] ?? [0, 0, 0];
          worst = Math.max(
            worst,
            Math.hypot(p[0] - (q[0] ?? 0), p[1] - (q[1] ?? 0), p[2] - (q[2] ?? 0)),
          );
        });
        expect(worst, `${c.role} ${String(i)}`).toBeLessThan(1e-9);
      });
    });
});

describe('dust lanes against v21 (app23.js:L944–985)', () => {
  for (const [name, P] of CASES)
    for (const zoom of [1, 2])
      it(`${name}, zoom ${String(zoom)}`, () => {
        const V = v21Variation(P, M);
        const field = packNoise(v21NoiseTables(ROOT, P.seed));
        const ours = dustLanes(P, V, penlines, P.incl, field);
        const theirs = v21Lines(ROOT, P, V, KINDS, zoom).lanes();
        const cam = cameraOf(P, zoom);
        // the same lane points: the same noise decides which exist
        expect(ours.pts.length).toBe(theirs.pts.length);
        let worst = 0;
        ours.pts.forEach((p, j) => {
          const q = project(p, cam);
          const t = theirs.pts[j] ?? [0, 0];
          worst = Math.max(worst, Math.hypot(q[0] - (t[0] ?? 0), q[1] - (t[1] ?? 0)));
        });
        expect(worst).toBeLessThan(1e-6);
        // away from edge-on, every lane point carries one hatch (plus the odd feather) in both
        if (incE(P.incl) <= 74) {
          expect(ours.hatches.filter((h) => h.offF === 0)).toHaveLength(ours.pts.length);
          expect(theirs.strokes.length).toBeGreaterThanOrEqual(theirs.pts.length);
        }
      });
});

describe('the lattice noise has v21 noise statistics (deliberate divergence 5)', () => {
  it('mean, spread and tail fractions', () => {
    const v21 = new Function(
      `${/\nfunction hash2\([^\n]*\n/.exec(readFileSync(resolve(ROOT, 'assets/reference/rosse-source/app23.js'), 'utf8'))?.[0] ?? ''}
       ${(/\nfunction vnoise\([^\n]*\n[^\n]*\n/.exec(readFileSync(resolve(ROOT, 'assets/reference/rosse-source/app23.js'), 'utf8')) ?? [''])[0]}
       return vnoise;`,
    )() as (x: number, y: number) => number;
    const a: number[] = [];
    const b: number[] = [];
    // about 30,000 lattice cells, so the sampling error of the mean is a few thousandths
    for (let i = 0; i < 300; i++)
      for (let j = 0; j < 300; j++) {
        const x = i * 0.61 + 0.11;
        const y = j * 0.53 + 0.07;
        a.push(vnoise(x, y, 7, NoiseSalt.flocc));
        b.push(v21(x + 7, y - 7));
      }
    const stats = (s: number[]) => {
      const m = s.reduce((p, q) => p + q, 0) / s.length;
      const sd = Math.sqrt(s.reduce((p, q) => p + (q - m) ** 2, 0) / s.length);
      const tail = [0.3, 0.45, 0.6, 0.75].map((t) => s.filter((x) => x > t).length / s.length);
      return { m, sd, tail };
    };
    const A = stats(a);
    const B = stats(b);
    expect(Math.abs(A.m - B.m)).toBeLessThan(0.01);
    expect(Math.abs(A.sd - B.sd)).toBeLessThan(0.01);
    A.tail.forEach((t, k) => {
      expect(Math.abs(t - (B.tail[k] ?? 0))).toBeLessThan(0.015);
    });
  });

  it('a table of v21 corners reproduces v21 noise', () => {
    const src = readFileSync(resolve(ROOT, 'assets/reference/rosse-source/app23.js'), 'utf8');
    const v21 = new Function(
      `${/\nfunction hash2\([^\n]*\n/.exec(src)?.[0] ?? ''}${(/\nfunction vnoise\([^\n]*\n[^\n]*\n/.exec(src) ?? [''])[0]}return vnoise;`,
    )() as (x: number, y: number) => number;
    const field = packNoise(v21NoiseTables(ROOT, 4242));
    let worst = 0;
    for (let i = 0; i < 400; i++) {
      const x = (i % 20) * 1.7 + 0.3;
      const y = Math.floor(i / 20) * 1.3 - 9.9;
      // armProfile's flocculence: v21 adds the seed to y
      worst = Math.max(
        worst,
        Math.abs(vnoise(x, y, 4242, NoiseSalt.flocc, field) - v21(x, y + 4242)),
      );
    }
    expect(worst).toBeLessThan(1e-6);
  });
});

describe('ring knots and clumps (app23.js:L282–297)', () => {
  it('as many groups and marks as v21 describes', () => {
    const P = presetParams('Barred spiral', 7, M4);
    const V = v21Variation(P, M);
    const g = markGroups(P, V);
    const rings = g.filter((x) => x.kind === 0);
    expect(rings).toHaveLength(Math.round(6 + 10 * P.ring));
    rings.forEach((r) => {
      expect(r.count).toBeGreaterThanOrEqual(5);
      expect(r.count).toBeLessThanOrEqual(12);
      expect(r.rstars).toBe(1);
    });
    const clumps = g.filter((x) => x.kind === 1);
    expect(clumps.map((c) => c.count)).toEqual(V.clumps.map((c) => c.n));
    // no drawn stars in clumps with starMix 0
    expect(clumps.every((c) => c.rstars === 0)).toBe(true);
  });
});

describe('the ribbon kernels (CPU)', () => {
  it('arc lengths grow, slots are contiguous, pieces fit their slots', () => {
    for (const [, P] of CASES) {
      const scene = buildScene(P, M);
      const cam = cameraOf(P, 2);
      const R = scene.ribbons;
      const G = scene.galaxy;
      const rib = ribUniform(R, cam, P, G.g.n_dot_pool);
      const rv = runRibbons(ribbonModel(R, G.pool, G.dotBase), viewDesc(cam, 0, 1, 1), rib);
      const cu = new Uint32Array(R.curveBuf);
      let base = 0;
      for (let c = 0; c < R.nCurves; c++) {
        const first = cu[c * 12] ?? 0;
        const n = cu[c * 12 + 1] ?? 0;
        for (let j = 1; j < n; j++)
          expect(rv.arc[first + j] ?? 0).toBeGreaterThanOrEqual(rv.arc[first + j - 1] ?? 0);
        const so = c * CURVE_STATE_WORDS;
        expect(rv.stateU[so + 4]).toBe(base);
        if ((cu[c * 12 + 3] ?? 0) & CurveFlag.pieces) {
          const reps = rv.stateU[so + 3] ?? 0;
          expect(reps).toBeLessThanOrEqual(cu[c * 12 + 10] ?? 0);
          base += reps * (cu[c * 12 + 9] ?? 0);
        }
      }
      expect(rv.nPieces).toBe(base);
      expect(rv.nPieces).toBeLessThanOrEqual(R.pieceCap);
    }
  });

  it('the line-work is model-tier data keyed by the structure signature only (ADR 0017)', () => {
    // inclinations with the same structureKey give identical buffers; the thresholds the
    // line-work reads (incE > 72, > 74, <= 74, > 80: L201, L207, L950, L960, L965, L788) are
    // all structure predicates
    const bytes = (b: ArrayBuffer | ArrayBufferView) =>
      Buffer.from(b instanceof ArrayBuffer ? b : b.buffer).toString('base64');
    const sig = (incl: number) => {
      const P = presetParams('Edge-on with dust', 7, { incl, dustLines: 0.6, ring: 0.3 });
      const R = buildScene(P, M).ribbons;
      return [bytes(R.points3), bytes(R.curveBuf), bytes(R.hatchBuf), bytes(R.carve)].join('|');
    };
    const pairs: [number, number][] = [
      [81, 99],
      [85, 89.5],
      [75, 77.5],
      [73, 73.9],
      [20, 60],
      [120, 160],
    ];
    for (const [a, b] of pairs) {
      const same =
        structureKey({ incl: a, kind: 'auto', bulge: 0.3, bulgeFlat: 0.8 }) ===
        structureKey({ incl: b, kind: 'auto', bulge: 0.3, bulgeFlat: 0.8 });
      expect(same, `${String(a)} ${String(b)}`).toBe(true);
      expect(sig(a), `${String(a)} ${String(b)}`).toBe(sig(b));
    }
    // and across a threshold the structure changes
    expect(sig(73)).not.toBe(sig(75));
    expect(sig(79)).not.toBe(sig(81));
  });

  it('the edge-on stroke takes its alpha from the raw inclination (v21 parity, L788)', () => {
    const at = (incl: number) => {
      const P = presetParams('Edge-on with dust', 7, { incl });
      const R = buildScene(P, M).ribbons;
      return ribUniform(R, cameraOf(P), P, 1).edge_alpha;
    };
    // 81° and 99° fall in one incE bucket, but v21's alpha is 0.5 and 1.5 × lines
    expect(at(81)).toBeCloseTo((0.5 * (81 - 72)) / 18, 5);
    expect(at(99)).toBeCloseTo((0.5 * (99 - 72)) / 18, 5);
  });
});
