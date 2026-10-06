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
import { curves, edgeOnAlpha } from '../../src/model/curves';
import { CpuRenderer } from '../../src/fallback';
import { createInkBuffer, rasteriseCapsules } from '../../src/fallback/raster';
import { CpuStipple, lineLayers } from '../../src/fallback/stipple';
import { dustLanes } from '../../src/model/lanes';
import { markGroups } from '../../src/model/clumps';
import { buildScene, drawingsMeta } from '../../src/model/scene';
import { atlasFromBytes, type BuiltIndex } from '../../src/marks/atlas';
import type { VectorSheet } from '../../src/marks/vector';
import { cameraOf, incE, project, structureKey, viewDesc } from '../../src/view/camera';
import { v21Variation } from '../golden/compare/v21';
import { v21CurvePicks, v21DustPicks, v21Lines, v21RingKnots } from '../golden/compare/v21-curves';
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
  ['Disc, no arms s7 (outline)', presetParams('Disc, no arms', 7, M4)],
  ['Ringed s4242 (outline)', presetParams('Ringed', 4242, M4)],
  [
    'Grand design s7 with a tail',
    presetParams('Grand design', 7, { ...M4, tail: 0.6, outline: 0.5 }),
  ],
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

describe("with v21's dust choices (ADR 0018), the hatches are v21's", () => {
  for (const [name, P] of CASES)
    for (const zoom of [1, 2])
      it(`${name}, zoom ${String(zoom)}`, () => {
        const V = v21Variation(P, M);
        const field = packNoise(v21NoiseTables(ROOT, P.seed));
        const picks = v21DustPicks(ROOT, P, V, KINDS, penlines.n);
        const ours = dustLanes(P, V, penlines, P.incl, field, P.seed, picks);
        const theirs = v21Lines(ROOT, P, V, KINDS, zoom).lanes().strokes;
        const cam = cameraOf(P, zoom);
        expect(ours.hatches).toHaveLength(theirs.length);
        expect(ours.hatches.map((h) => h.tile)).toEqual(picks.tiles);
        let worst = 0;
        let worstAng = 0;
        ours.hatches.forEach((h, i) => {
          // the view tier's layout (src/fallback/kernels/ribbons.ts hatchFrame), in f64
          const q = project(h.a, cam);
          const q2 = project(h.b, cam);
          const a0 = Math.atan2(q2[1] - q[1], q2[0] - q[0]);
          const ang = a0 + h.dAng;
          const x = q[0] - Math.sin(a0) * h.offN * zoom + Math.cos(ang) * h.offF * zoom;
          const y =
            q[1] + Math.cos(a0) * h.offN * zoom + h.offY * zoom + Math.sin(ang) * h.offF * zoom;
          const t = theirs[i] ?? [0, 0, 0, 0];
          worst = Math.max(
            worst,
            Math.hypot(x - (t[0] ?? 0), y - (t[1] ?? 0)),
            Math.abs(h.len * zoom - (t[3] ?? 0)),
          );
          const dA = Math.abs(ang - (t[2] ?? 0)) % (2 * Math.PI);
          worstAng = Math.max(worstAng, Math.min(dA, 2 * Math.PI - dA));
        });
        expect(worst).toBeLessThan(1e-6);
        expect(worstAng).toBeLessThan(1e-9);
      });
});

describe('the dust choices are keyed by the placement key (ADR 0018)', () => {
  const P = presetParams('Dusty spiral', 4242, M4);
  const V = v21Variation(P, M);
  const field = packNoise(v21NoiseTables(ROOT, P.seed));
  it('a re-draw keeps which hatches exist and re-draws their numbers and pen lines', () => {
    const a = dustLanes(P, V, penlines, P.incl, field);
    const b = dustLanes(P, V, penlines, P.incl, field, P.seed + 7_919_000);
    expect(b.pts).toEqual(a.pts);
    const main = (l: typeof a) => l.hatches.filter((h) => h.offF === 0);
    expect(main(b).map((h) => h.a)).toEqual(main(a).map((h) => h.a));
    expect(main(b).map((h) => h.len)).not.toEqual(main(a).map((h) => h.len));
    expect(b.hatches.map((h) => h.tile)).not.toEqual(a.hatches.map((h) => h.tile));
  });
  it("a hatch's pen line does not depend on the hatches before it (review m2)", () => {
    const a = dustLanes(P, V, penlines, P.incl, field);
    // fewer hatches before the arms' (no ring lane), more patches on the arms
    const b = dustLanes({ ...P, dustScribble: P.dustScribble + 0.1 }, V, penlines, P.incl, field);
    const at = (l: typeof a) =>
      new Map(l.hatches.filter((h) => h.offF === 0).map((h) => [h.a.join(), h]));
    const A = at(a);
    let shared = 0;
    for (const [k, h] of at(b)) {
      const g = A.get(k);
      if (!g) continue;
      shared++;
      expect([h.tile, h.dAng, h.offN]).toEqual([g.tile, g.dAng, g.offN]);
    }
    expect(shared).toBeGreaterThan(20);
    expect(b.hatches.length).toBeGreaterThan(a.hatches.length);
  });
});

/** v21's own `vnoise` (app23.js:L73–75), cut out and evaluated as written. */
function v21Vnoise(): (x: number, y: number) => number {
  const src = readFileSync(resolve(ROOT, 'assets/reference/rosse-source/app23.js'), 'utf8');
  const hash2 = /\nfunction hash2\([^\n]*\n/.exec(src)?.[0] ?? '';
  const vnoise = /\nfunction vnoise\([^\n]*\n[^\n]*\n/.exec(src)?.[0] ?? '';
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const make = new Function(`${hash2}${vnoise}return vnoise;`) as () => (
    x: number,
    y: number,
  ) => number;
  return make();
}

describe('the lattice noise has v21 noise statistics (deliberate divergence 5)', () => {
  it('mean, spread and tail fractions', () => {
    const v21 = v21Vnoise();
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
    const v21 = v21Vnoise();
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

  it("v21's clusters (ADR 0018) are placed as given; the placement key re-draws the engine's", () => {
    const P = presetParams('Barred spiral', 7, M4);
    const V = v21Variation(P, M);
    const picks = v21RingKnots(ROOT, P, V);
    expect(picks).toHaveLength(Math.round(6 + 10 * P.ring));
    const g = markGroups(P, V, P.seed, picks).filter((x) => x.kind === 0);
    g.forEach((x, i) => {
      const p = picks[i];
      if (!p) throw new Error('missing');
      expect(x.count).toBe(p.count);
      expect(x.c[0]).toBeCloseTo(p.R * Math.cos(p.t), 12);
      expect(x.c[1]).toBeCloseTo(p.R * Math.sin(p.t), 12);
    });
    // the replay is v21's own block, not a port of it: its centres are where v21's block puts its
    // stars, one per cluster (the capture's `rstars` counts them: 9 for Barred spiral)
    expect(picks).toHaveLength(9);
    expect(picks.every((c) => c.count >= 5 && c.count <= 12)).toBe(true);
    const own = markGroups(P, V).filter((x) => x.kind === 0);
    const again = markGroups(P, V, P.seed + 7_919_000).filter((x) => x.kind === 0);
    expect(again.map((x) => x.c)).not.toEqual(own.map((x) => x.c));
  });

  it("a cluster's marks follow v21's distribution (the loop's bound drawn at every turn)", () => {
    // P(count = c) = (c − 4)/8 · Π_{j<c} (1 − (j − 4)/8), for c = 5..12
    const expected = new Map<number, number>();
    let alive = 1;
    for (let c = 5; c <= 12; c++) {
      const stop = (c - 4) / 8;
      expected.set(c, alive * stop);
      alive *= 1 - stop;
    }
    const seen = new Map<number, number>();
    let n = 0;
    const P0 = presetParams('Barred spiral', 7, M4);
    const V = v21Variation(P0, M);
    for (let seed = 1; seed <= 400; seed++)
      for (const x of markGroups({ ...P0, seed }, V).filter((y) => y.kind === 0)) {
        seen.set(x.count, (seen.get(x.count) ?? 0) + 1);
        n++;
      }
    for (const [c, p] of expected) {
      const got = (seen.get(c) ?? 0) / n;
      // binomial sampling error over about 6,000 clusters is under 0.007
      expect(Math.abs(got - p), `count ${String(c)}`).toBeLessThan(0.02);
    }
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

describe('the edge-on stroke past 90° (review m1)', () => {
  it('inks at most 1 on the raster, as v21 does through its RGBA8 canvas', () => {
    const P = presetParams('Edge-on with dust', 7, { lines: 1, incl: 99 });
    expect(edgeOnAlpha(P.lines, P.incl)).toBeGreaterThan(1);
    const scene = buildScene(P, M);
    const st = new CpuStipple(scene);
    const v = st.view(cameraOf(P));
    const r = new CpuRenderer(
      { plateCss: 800, dpr: 1 },
      { width: 1, height: 1, data: new Uint8Array(4) },
    );
    for (const n of ['dots', 'knots', 'stars', 'cores', 'strokes'] as const) r.addAtlas(atlas(n));
    r.addAtlas(
      atlasFromBytes(
        'pieces',
        index.atlases.pieces,
        new Uint8Array(readFileSync(resolve(BUILT, index.atlases.pieces.file))),
      ),
    );
    r.setLayers(lineLayers(v.ribbons, st.lines));
    r.drawInk();
    let max = 0;
    let inked = 0;
    for (let i = 3; i < r.ink.data.length; i += 4) {
      const a = r.ink.data[i] ?? 0;
      max = Math.max(max, a);
      if (a > 0) inked++;
    }
    expect(inked).toBeGreaterThan(1000);
    expect(max).toBeLessThanOrEqual(1);
  });
});

describe('pen lines are unioned per sample (ADR 0019, QA D2)', () => {
  const ink = (caps: number[][]) => {
    const t = createInkBuffer(64, 64);
    const buf = new Float32Array(caps.length * 8);
    caps.forEach((c, i) => {
      buf.set([c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, c[3] ?? 0, c[4] ?? 0, 1, 0, 0], i * 8);
    });
    rasteriseCapsules(t, buf, caps.length, { pxPerUnit: 1, gain: 1 });
    let s = 0;
    for (let i = 3; i < t.data.length; i += 4) s += t.data[i] ?? 0;
    return s;
  };
  const w = 0.456;
  it("one segment inks v21's quad: its area, extended by 0.9 w at both ends", () => {
    // slanted, so that the four samples' quantisation averages out along it (an axis-aligned
    // line of this width covers all four samples of one row of pixels, as in v21)
    const slant = Math.hypot(40, 10.8);
    expect(ink([[10.2, 20.3, 50.2, 31.1, w]]) / (2 * w * (slant + 1.8 * w))).toBeCloseTo(1, 1);
  });
  it('a segment drawn twice, or overlapping its neighbour, inks no more than the union', () => {
    const one = ink([[10.2, 20.3, 50.2, 31.1, w]]);
    expect(
      ink([
        [10.2, 20.3, 50.2, 31.1, w],
        [10.2, 20.3, 50.2, 31.1, w],
      ]),
    ).toBe(one);
    // a polyline cut into 1-px pieces inks as much as one quad: the overlaps at its joins count once
    const pieces: number[][] = [];
    for (let x = 10; x < 50; x++) pieces.push([x + 0.2, 20.5, x + 1.2, 20.5, w]);
    const whole = ink([[10.2, 20.5, 50.2, 20.5, w]]);
    expect(Math.abs(ink(pieces) / whole - 1)).toBeLessThan(0.03);
  });
});

describe('the lane cull thins the stipple near the lanes (QA D3: the metric sees this only in part)', () => {
  it('a lane radius of 0 keeps every disc sample the cull would have removed', () => {
    const P = presetParams('Dusty spiral', 7, M4);
    const scene = buildScene(P, M);
    expect(scene.ribbons.laneR).toBeGreaterThan(3);
    const cam = cameraOf(P);
    const count = (laneR: number) => {
      const st = new CpuStipple({ ...scene, ribbons: { ...scene.ribbons, laneR } });
      return st.view(cam).perClass.reduce((a, b) => a + b, 0);
    };
    const full = count(scene.ribbons.laneR);
    const none = count(0);
    // p = 0.7 of the disc samples within about 4 px of a lane point: 61 of about 11,000 marks
    // here, half a per cent, far below any ink gate; this test is what guards the cull
    expect(none - full).toBeGreaterThan(30);
    expect(none - full).toBeLessThan(400);
  });
});
