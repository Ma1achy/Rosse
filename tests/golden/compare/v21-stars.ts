/**
 * v21's own star and artefact choices, for the golden comparison (ADR 0018, 0031).
 *
 * v21's `starSprites` (app23.js:L399–439) draws everything from one sequential stream,
 * `mulberry32(P.seed · 911 + 17)`: which of the star drawings sits at each core, the spike
 * direction, where the fainter stars lie and how bright they are, the trail's angle and offset,
 * whether it has a second line, the ghost's place and radii, every cosmic-ray hit. The engine draws
 * the same choices from counter streams (src/model/stars.ts), so a comparison would differ by them,
 * a discrete random choice the thresholds were never calibrated on. As for the hand, the strokes
 * and the parts, the golden runner draws with v21's choices (`SceneOptions.starPicks`) and only the
 * marks differ.
 *
 * Nothing is ported: `starSprites` and what it calls are cut out of app23.js by name and evaluated
 * as written, with a few statements of record added at the places where it draws a choice (each
 * addition is checked to match the source exactly once, so an edit of the reference fails loudly).
 * The marks themselves are v21's, too: `v21StarMarks` returns its lists, so the tests can compare
 * their counts with the engine's kernels on the same picks (tests/unit/stars.test.ts).
 *
 * The overlays are run as `overlaySprites` runs them (L453–465): a foreground star with seed
 * `seed · 7 + 3`, an artefact with seed `seed · 11 + 5`, both with `P._ov` set; the scene
 * positions they are given (`scenePoint`) are the engine's (`ctx.place`), not replayed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Params } from '../../../src/core/params';
import type { CosmicPick, StarCtxPicks, StarPicks, StarPick } from '../../../src/model/stars';
import type { DrawingsMeta, Variation } from '../../../src/model/variation';
import { mulberry32 } from './v21';

/** What the instrumented `starSprites` records. */
interface Rec {
  stars: { x: number; y: number; B: number; full: boolean; spikeA: number }[];
  trail?: { ta: number; off: number; dbl: boolean };
  sep?: number;
  ghost?: { sa: number; k1: number; k0: number };
  cosmic: { hx: number; hy: number; ha: number; hl: number; knot: boolean }[];
}

/** v21's lists of a `starSprites` call (rows [x, y, tile, alpha, m0…m3], drawn stars with ps). */
export interface V21StarLists {
  old: number[][];
  disc: number[][];
  young: number[][];
  knots: number[][];
  stars: number[][];
  rstars: number[][];
}

type Eval = (
  P: Record<string, unknown>,
  VAR: Variation,
  AT: unknown,
  scale: number,
  OVG: number[] | null,
) => { out: V21StarLists; rec: Rec };

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

/** Replaces `from` by `to`, which must occur exactly once. */
function patch(text: string, from: string, to: string): string {
  const at = text.indexOf(from);
  if (at < 0 || text.indexOf(from, at + 1) >= 0)
    throw new Error(`starSprites: ${from.slice(0, 60)} does not occur exactly once`);
  return text.replace(from, () => to);
}

const NAMES = [
  'mulberry32',
  'gauss',
  'hash2',
  'vnoise',
  'dotSprite',
  'clamp',
  'Rm',
  'Sm',
  'mul',
  'chain',
  'simple',
];

function build(root: string): Eval {
  const src = readFileSync(join(root, 'assets/reference/rosse-source/app23.js'), 'utf8');
  let star = cut(src, 'starSprites');
  star = patch(
    star,
    'spikeA = r() * 0.4 - 0.2 + (VAR.spike || 0);',
    'spikeA = r() * 0.4 - 0.2 + (VAR.spike || 0); REC.stars.push({ x: x, y: y, B: B, full: full, spikeA: spikeA });',
  );
  star = patch(
    star,
    'half = U * 3.2, dbl = r() < 0.4;',
    'half = U * 3.2, dbl = r() < 0.4; REC.trail = { ta: ta, off: off / U, dbl: dbl };',
  );
  star = patch(star, 'dbl ? 7 + 5 * r() : null', 'dbl ? (REC.sep = 7 + 5 * r()) : null');
  star = patch(
    star,
    'R0 = R1 * (0.45 + 0.15 * r());',
    'R0 = R1 * (0.45 + 0.15 * r()); REC.ghost = { sa: sa2, k1: R1 / U, k0: R0 / R1 };',
  );
  star = patch(
    star,
    'hl = 3 + Math.pow(r(), 2) * 30;',
    'hl = 3 + Math.pow(r(), 2) * 30; REC.cosmic.push({ hx: hx, hy: hy, ha: ha, hl: hl, knot: false });',
  );
  star = patch(
    star,
    'if (r() < 0.15) knot(hx, hy, 3 + 2 * r());',
    'if (r() < 0.15) { REC.cosmic[REC.cosmic.length - 1].knot = true; knot(hx, hy, 3 + 2 * r()); }',
  );
  const body = `var P, AT, VAR, VIEW = { W: 800, cx: 400, cy: 400, scale: 84 };
    var PEN = { line: 2.4, dot: 1 }, OVT = null, OVG = null, REC;
    function inst(list, atlas, x, y, tile, alpha, M) { list.push([x, y, tile, alpha, M[0], M[1], M[2], M[3]]); }
    ${NAMES.map((n) => cut(src, n)).join('\n')}
    ${star}
    return function (p, v, at, scale, ovg) {
      P = p; VAR = v; AT = at; VIEW.scale = scale; VIEW.cx = 400; VIEW.cy = 400;
      PEN.line = P.pen; PEN.dot = 0.75 + 0.1 * P.pen; OVG = ovg; OVT = null;
      REC = { stars: [], cosmic: [] };
      var out = starSprites();
      return { out: out, rec: REC };
    };`;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return (new Function(body) as () => Eval)();
}

/** v21's own `starSprites` for these parameters, as the lists it draws and the choices it made. */
export function v21StarMarks(
  root: string,
  P: Record<string, unknown>,
  V: Variation,
  meta: DrawingsMeta,
  zoom = 1,
): { out: V21StarLists; rec: Rec } {
  cached ??= build(root);
  const sheet = meta.vectors?.sstars;
  const AT = {
    sstars: { kind: sheet?.kind ?? [], n: sheet?.n ?? 0 },
    dots: { src: meta.dots.src, size: meta.dots.size },
    knots: { count: meta.knots.count },
  };
  // a stand-in for the overlay ghost's star in the scene (the engine places it; here it only has
  // to be somewhere): the replay records the ghost's other choices from the stream
  return cached(P, V, AT, 84 * zoom, [400 + 120, 400 - 80]);
}

/** The picks of one context from a record: the stars, and the artefact's choices. */
function ctxPicks(rec: Rec, out: V21StarLists, U: number): StarCtxPicks {
  const stars: StarPick[] = rec.stars.map((s, i) => ({
    ux: (s.x - 400) / U,
    uy: (s.y - 400) / U,
    B: s.B,
    full: s.full,
    spikeA: s.spikeA,
    tile: out.rstars[i]?.[2] ?? 0,
  }));
  const picks: StarCtxPicks = { stars };
  if (rec.trail) picks.trail = { ...rec.trail, sep: rec.sep ?? 0 };
  if (rec.ghost) picks.ghost = rec.ghost;
  if (rec.cosmic.length)
    picks.cosmic = rec.cosmic.map(
      (c): CosmicPick => ({
        ux: (c.hx - 400) / U,
        uy: (c.hy - 400) / U,
        ha: c.ha,
        hl: c.hl,
        knot: c.knot,
      }),
    );
  return picks;
}

/** v21's choices for these parameters: the subject, and the overlays as `overlaySprites` runs them. */
export function v21StarPicks(
  root: string,
  P: Params,
  V: Variation,
  meta: DrawingsMeta,
  zoom = 1,
): StarPicks {
  const U = 84 * zoom;
  const picks: StarPicks = {};
  const base = { ...P } as unknown as Record<string, unknown>;
  if (P.subject === 'star' || P.subject === 'artefact') {
    const r = v21StarMarks(root, base, V, meta, zoom);
    picks.subject = ctxPicks(r.rec, r.out, U);
  }
  if (P.ovStar > 0.02) {
    const r = v21StarMarks(
      root,
      { ...base, subject: 'star', starBright: P.ovStar, seed: P.seed * 7 + 3, _ov: 1 },
      V,
      meta,
      zoom,
    );
    picks.ovStar = ctxPicks(r.rec, r.out, U);
  }
  if (P.ovArtefact && P.ovArtefact !== 'none') {
    const r = v21StarMarks(
      root,
      {
        ...base,
        subject: 'artefact',
        artefact: P.ovArtefact,
        starBright: 0.8,
        seed: P.seed * 11 + 5,
        _ov: 1,
      },
      V,
      meta,
      zoom,
    );
    picks.ovArt = ctxPicks(r.rec, r.out, U);
    // the ghost's star in the scene: the third draw of `mulberry32(seed · 977 + 3)` (L460–462)
    const rt = mulberry32(P.seed * 977 + 3);
    rt();
    rt();
    picks.ovGhostAngle = rt() * 6.2832;
  }
  return picks;
}
