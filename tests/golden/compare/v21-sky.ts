/**
 * v21's own sky, for the golden comparison (ADR 0018, 0031).
 *
 * v21's `buildSky` (app23.js:L867–877) draws the catalogue of background galaxies and foreground
 * stars from one sequential stream (`mulberry32(P.seed · 1013 + 71)`, 11 numbers per galaxy) and
 * `skyParts` (L878–920) the companions from another (`mulberry32(P.seed · 331 + 17)`); the engine
 * draws them from its counter streams (src/model/sky.ts). Which galaxies are where, with which
 * drawing, size and tilt, is a discrete random choice the comparison would otherwise carry, so the
 * golden runner draws with v21's catalogue and only the dots differ, as it does for the variation,
 * the strokes, the parts and the stars (ADR 0015, 0018).
 *
 * Nothing is ported: `buildSky`, `skyParts` and what they call are cut out of app23.js by name and
 * evaluated as written. `v21Sky` returns the catalogue (as the engine's `SkyCatalogue`) and, for
 * tests/unit/sky.test.ts, the lists `skyParts` makes for a view: the deep field's drawings (rows
 * of `L.bg`), their dots, the foreground stars and the companions in front or behind.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Params } from '../../../src/core/params';
import type { BgGalaxy, CompanionPick, FgStar, SkyCatalogue } from '../../../src/model/sky';
import { SKY_SHEETS } from '../../../src/model/sky';
import type { DrawingsMeta, Variation } from '../../../src/model/variation';

/** v21's lists of a `skyParts` call. */
export interface V21SkyLists {
  /** drawings behind: { k: sheet, row: [x, y, tile, alpha, m0…m3, ps] } */
  bg: { k: string; row: number[] }[];
  front: { k: string; row: number[] }[];
  /** the dots of the deep field: rows [x, y, tile, alpha, m0…m3] */
  bgdots: number[][];
  fgstars: number[][];
}

type Eval = (
  P: Record<string, unknown>,
  VAR: Variation,
  AT: unknown,
  view: { scale: number; az: number; pa: number },
) => { sky: { bg: Record<string, unknown>[]; fg: Record<string, unknown>[] }; L: V21SkyLists };

let cached: Eval | null = null;

function cut(src: string, name: string): string {
  const start = src.indexOf(`\nfunction ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found in app23.js`);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(start + 1, i + 1);
}

const NAMES = [
  'mulberry32',
  'gauss',
  'clamp',
  'pick',
  'dotSprite',
  'Rm',
  'Sm',
  'mul',
  'chain',
  'simple',
  'azR',
  'paR',
  'unit3',
  'toView',
  'toScreen',
  'basis',
  'orient',
  'buildSky',
  'skyParts',
];

function build(root: string): Eval {
  const src = readFileSync(join(root, 'assets/reference/rosse-source/app23.js'), 'utf8');
  const body = `var P, AT, VAR, VIEW = { W: 800, cx: 400, cy: 400, scale: 84 }, USED = new Set();
    var SKY = { key: null }, CAM = 30, RMIN = 40, RMAX = 240, R_FG = 42, ZOOM = 1;
    var PEN = { line: 2.4, dot: 1 };
    function inst(list, atlas, x, y, tile, alpha, M) { list.push([x, y, tile, alpha, M[0], M[1], M[2], M[3]]); }
    ${NAMES.map((n) => cut(src, n)).join('\n')}
    return function (p, v, at, view) {
      P = p; VAR = v; AT = at; VIEW.scale = view.scale; SKY = { key: null }; USED = new Set();
      PEN.line = P.pen; PEN.dot = 0.75 + 0.1 * P.pen;
      var L = { fgstars: [] }; skyParts(L, null);
      return { sky: SKY, L: L };
    };`;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return (new Function(body) as () => Eval)();
}

/** The atlases v21's sky reads: the drawings' counts and sources, the dots' sizes. */
function atlases(meta: DrawingsMeta, fgTiles: number) {
  const AT: Record<string, unknown> = {};
  for (const k of SKY_SHEETS) {
    const n = meta.vectors?.[k]?.n ?? 0;
    AT[k] = { n, src: Array.from({ length: n }, (_, i) => `${k}-${String(i)}`) };
  }
  AT.fgstars = { n: fgTiles };
  AT.dots = { src: meta.dots.src, size: meta.dots.size };
  return AT;
}

/** v21's sky for these parameters and variation: the catalogue, and what `skyParts` makes of it. */
export function v21Sky(
  root: string,
  P: Params,
  V: Variation,
  meta: DrawingsMeta,
  fgTiles: number,
  zoom = 1,
): { catalogue: SkyCatalogue; L: V21SkyLists } {
  cached ??= build(root);
  const out = cached(
    { ...P },
    V,
    atlases(meta, fgTiles),
    { scale: 84 * zoom, az: P.az, pa: P.pa },
  );
  // the items v21 picks from, in its order: [sheet, tile] → the engine's index into its item list
  const first: Record<string, number> = {};
  let n = 0;
  for (const k of SKY_SHEETS) {
    first[k] = n;
    n += meta.vectors?.[k]?.n ?? 0;
  }
  const itemOf = (it: [string, number]) => (first[it[0]] ?? 0) + it[1];
  const bg: BgGalaxy[] = out.sky.bg.map((o) => ({
    w: o.w as [number, number, number],
    n: o.n as [number, number, number],
    item: itemOf(o.it as [string, number]),
    rad: o.rad as number,
    spin: o.spin as number,
    na: o.na as number,
    bulge: o.bulge as number,
  }));
  const fg: FgStar[] = out.sky.fg.map((o) => ({
    w: o.w as [number, number, number],
    tile: o.t as number,
    size: o.size as number,
    rot: o.rot as number,
  }));
  return { catalogue: { bg, fg, companions: [] }, L: out.L };
}

/**
 * v21's companions (`skyParts`, app23.js:L913–919), replayed from `mulberry32(P.seed · 331 + 17)`:
 * the same numbers in the same order, one companion at a time.
 */
export function v21Companions(
  P: Params,
  nTiles: number,
  mulberry32: (seed: number) => () => number,
): CompanionPick[] {
  const rc = mulberry32(P.seed * 331 + 17);
  const unit3 = (): [number, number, number] => {
    const z = 2 * rc() - 1;
    const t = rc() * 6.28318;
    const q = Math.sqrt(1 - z * z);
    return [q * Math.cos(t), q * Math.sin(t), z];
  };
  const out: CompanionPick[] = [];
  // the loop's bound is not redrawn: Math.round(1 + 3 · companions) is evaluated at each test but
  // draws nothing
  for (let c = 0; c < Math.round(1 + 3 * P.companions); c++) {
    const u = unit3();
    const rad = 3.4 + 1.2 * rc();
    const n = unit3();
    const tile = Math.floor(rc() * nTiles);
    const scale = 0.8 + 0.8 * rc();
    const spin = rc() * 6.28;
    out.push({ w: [u[0] * rad, u[1] * rad, u[2] * rad * 0.7], n, tile, scale, spin });
  }
  return out;
}
