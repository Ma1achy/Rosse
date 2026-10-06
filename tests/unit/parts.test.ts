/**
 * The vector drawings' scene description (src/marks/vector.ts, src/model/parts.ts,
 * src/model/vectors.ts) against v21's own `parts()`, cut out of app23.js and evaluated as written
 * (tests/golden/compare/v21-parts.ts): with v21's variation and v21's picks (replayed from v21's
 * parts stream), the engine must place the same drawings, with the same matrices, pen scales,
 * warps and cores, at every camera and zoom; the streams' marks must lie along the engine's
 * streams. Also the packing of the library.
 */
import { describe, expect, it } from 'vitest';
import type { Params } from '../../src/core/params';
import { presetParams } from '../../src/core/presets';
import { DRAWING_WORDS, VECTOR_ATLASES, densifyCount, packVectors } from '../../src/marks/vector';
import {
  coreInstances,
  describeParts,
  rewind,
  vectorRows,
  type VectorRow,
} from '../../src/model/parts';
import { cameraOf } from '../../src/view/camera';
import { v21Variation } from '../golden/compare/v21';
import { v21PartPicks, v21PartsRows } from '../golden/compare/v21-parts';
import { LIBRARY as lib, META, ROOT } from './support/vectors';

/** Every part on: the oddities, the sky's arrow, bubbles, a jet, streams. */
const ALL = {
  envelope: 1,
  whole: 1,
  nuclear: 1,
  lens: 0.7,
  shells: 0.5,
  tail: 0.5,
  trails: 0.8,
  field: 0.6,
  arrow: 1,
  bubbles: 1,
  jet: 1,
  streams: 1,
};

const PARTS_CASES: [string, Params][] = [
  ['Hand-drawn arms s7', presetParams('Hand-drawn arms', 7)],
  ['Hand-drawn arms s4242', presetParams('Hand-drawn arms', 4242)],
  ['Ringed s7', presetParams('Ringed', 7)],
  ['Barred spiral s4242', presetParams('Barred spiral', 4242)],
  ['Disc, no arms s7', presetParams('Disc, no arms', 7)],
  ['Edge-on with dust s4242', presetParams('Edge-on with dust', 4242, { whole: 1 })],
  ['Radio jet s7', presetParams('Radio jet', 7)],
  ['Stellar streams s4242', presetParams('Stellar streams', 4242)],
  ['Shell galaxy s7 (drawn shells)', presetParams('Shell galaxy', 7, { shellsOn: 0, shells: 1 })],
  ['Smooth, round s7 (whole, halo)', presetParams('Smooth, round', 7, { whole: 1, envelope: 1 })],
  ['Cigar-shaped s4242 (elongated)', presetParams('Cigar-shaped', 4242, { whole: 1 })],
  ['Grand design s11, every part', presetParams('Grand design', 11, ALL)],
  ['Flocculent s3, every part', presetParams('Flocculent', 3, { ...ALL, rewind: 0 })],
  ['Grand design s99, every part', presetParams('Grand design', 99, { ...ALL, pitch: 30 })],
  ['Grand design s23 (whole, rewound)', presetParams('Grand design', 23, { whole: 1 })],
  ['Loose, open arms s5 (whole, rewound)', presetParams('Loose, open arms', 5, { whole: 1 })],
  ['Barred spiral s8 (whole)', presetParams('Barred spiral', 8, { whole: 1 })],
];

const CAMERAS: [string, (P: Params) => Params, number][] = [
  ['home', (P) => P, 1],
  ['orbit', (P) => ({ ...P, az: (P.az || 0) + 35, incl: Math.min(180, P.incl + 20) }), 1],
  ['zoom 2', (P) => P, 2],
  ['far side', (P) => ({ ...P, incl: 140, winding: -1, pa: 75 }), 0.6],
];

const LISTS = ['arms', 'whole', 'env', 'rings', 'bars', 'arcs', 'shells', 'trails', 'penlines'];

describe('the vector library', () => {
  it('packs every drawing (ADR 0006)', () => {
    const p = packVectors(lib);
    expect([p.nDrawings, p.nSegs, p.nDots, p.nBlobs]).toEqual([429, 23431, 6038, 328]);
    // the range table covers every record, in sheet order
    let seg = 0;
    for (const a of VECTOR_ATLASES)
      lib[a].vec.forEach((r, i) => {
        const o = (p.first[a] + i) * DRAWING_WORDS;
        expect(p.table[o]).toBe(seg);
        const n = r.l.reduce((s, fl) => s + Math.max(0, fl.length / 2 - 1), 0);
        expect(p.table[o + 1]).toBe(n);
        seg += n;
        expect(p.table[o + 3]).toBe(r.d.length);
        expect(p.table[o + 5]).toBe(r.b.length);
      });
    // the densified prefix: every segment cut into ⌈length / 0.012⌉ pieces
    const s0 = p.table[p.first.whole * DRAWING_WORDS] ?? 0;
    const g = (k: number) => p.segs[s0 * 4 + k] ?? 0;
    expect((p.dens[s0 + 1] ?? 0) - (p.dens[s0] ?? 0)).toBe(densifyCount(g(0), g(1), g(2), g(3)));
    expect(p.dens[p.nSegs]).toBeGreaterThan(p.nSegs);
  });
});

function rowsOf(L: Record<string, number[][]>): (number[] & { list: string })[] {
  const out: (number[] & { list: string })[] = [];
  // the order v21 expands them in (render(), L1287): MAGNIFIED
  for (const k of [...LISTS, 'companions', 'misc'])
    for (const r of L[k] ?? []) out.push(Object.assign(r.slice(), { list: k }));
  return out;
}

const close = (a: number, b: number, tol = 1e-6) =>
  Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

describe("the parts against v21's own parts()", () => {
  for (const [name, P0] of PARTS_CASES)
    for (const [cam, view, zoom] of CAMERAS)
      it(`${name}, ${cam}`, () => {
        const P = view(P0);
        const V = v21Variation(P, META);
        const picks = v21PartPicks(P, V, META, zoom);
        const v21 = v21PartsRows(ROOT, P, V, META, zoom);
        const parts = describeParts(P, V, META, P.incl, picks);
        const ours: VectorRow[] = vectorRows(P, V, META, parts, cameraOf(P, zoom));
        const theirs = rowsOf(v21.L);
        expect(ours.map((r) => `${r.atlas} ${String(r.tile)}`)).toEqual(
          theirs.map((r) => `${r.list} ${String(r[2])}`),
        );
        ours.forEach((r, i) => {
          const t = theirs[i] ?? [];
          const what = `${r.atlas} row ${String(i)}`;
          expect(close(r.x, t[0] ?? NaN), `${what} x`).toBe(true);
          expect(close(r.y, t[1] ?? NaN), `${what} y`).toBe(true);
          expect(r.alpha, `${what} alpha`).toBe(t[3]);
          for (let k = 0; k < 4; k++) expect(close(r.m[k] ?? 0, t[4 + k] ?? NaN), what).toBe(true);
          expect(r.ps, `${what} pen scale`).toBe(t[8] ?? 1);
          const wid = t[9];
          expect(!!r.warp, `${what} warp`).toBe(wid !== undefined);
          if (r.warp && wid !== undefined) {
            const fn = v21.warps[wid]?.fn;
            for (const [x, y] of [
              [0.3, -0.2],
              [-0.01, 0.005],
              [0.05, 0.4],
              [-0.45, -0.1],
            ] as [number, number][]) {
              const a = rewind(x, y, r.warp.dk, r.warp.flip);
              const b = fn?.(x, y) ?? [NaN, NaN];
              expect(close(a[0], b[0], 1e-9) && close(a[1], b[1], 1e-9), `${what} warp`).toBe(true);
            }
          }
        });
        // the core and the nuclear spiral
        const cores = coreInstances(P, META, cameraOf(P, zoom), null, picks.nuclear);
        const vc = v21.L.cores ?? [];
        expect(cores.length).toBe(vc.length);
        cores.forEach((c, i) => {
          const t = vc[i] ?? [];
          expect(c.layer).toBe(t[2]);
          expect(close(c.x, t[0] ?? NaN) && close(c.y, t[1] ?? NaN)).toBe(true);
          for (let k = 0; k < 4; k++) expect(close(c.m[k] ?? 0, t[4 + k] ?? NaN)).toBe(true);
        });
        // the streams: every v21 mark within 4.5 σ (6.3 px) of the engine's stream at this zoom,
        // so the replay's picks (and the marks' draws between them) are v21's
        const sc = 84 * zoom;
        const lines = parts.streams.map((pts) => pts.map(([x, y]) => [400 + x * sc, 400 + y * sc]));
        const marks = [...(v21.L.sdots ?? []), ...(v21.L.sknots ?? [])];
        expect(marks.length > 0).toBe(lines.length > 0);
        for (const m of marks) {
          let best = Infinity;
          for (const pl of lines)
            for (let j = 1; j < pl.length; j++) {
              const [ax = 0, ay = 0] = pl[j - 1] ?? [];
              const [bx = 0, by = 0] = pl[j] ?? [];
              const dx = bx - ax;
              const dy = by - ay;
              const t = Math.max(
                0,
                Math.min(
                  1,
                  (((m[0] ?? 0) - ax) * dx + ((m[1] ?? 0) - ay) * dy) / (dx * dx + dy * dy || 1),
                ),
              );
              best = Math.min(
                best,
                Math.hypot((m[0] ?? 0) - ax - t * dx, (m[1] ?? 0) - ay - t * dy),
              );
            }
          expect(best).toBeLessThan(6.3);
        }
      });
});
