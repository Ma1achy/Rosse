/**
 * v21's own part picks, for the golden comparison (ADR 0015 item 5, extended by ADR 0019).
 *
 * v21's `parts(r)` (app23.js:L987–1086) draws every choice of a drawn part (which envelope, whole
 * drawing, arms, bar, ring, nuclear spiral; spins, sizes, the trails' places, the bubbles, the
 * jet's angle, the streams' pen lines…) from one sequential stream, `mulberry32(P.seed · 57 + 3)`,
 * where the new engine uses its counter streams (ADR 0004). A drawn bar from one drawing and one
 * from another carry different ink, so, as with the hand and the strokes, the comparison draws
 * with v21's picks and only the dots differ.
 *
 * Two things here:
 * - `v21PartPicks`, a replay of `parts()`'s draws, line for line on v21's stream, giving the picks
 *   as data (`PartPicks`). The streams' marks draw from the same stream in between (L1076–1080),
 *   with a count that depends on the zoom, so the replay walks them too and the second stream's
 *   picks are v21's at that zoom.
 * - `v21PartsRows`, v21's own `parts()` and what it calls, cut out of app23.js by name and
 *   evaluated unchanged with `P`, `VAR`, `AT` and `VIEW`, as ./v21-curves.ts does for `curves()`.
 *   It is the oracle of tests/unit/parts.test.ts, which checks that the replay's picks, laid out
 *   by the engine's `vectorRows`, give v21's rows, warps and cores.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Params } from '../../../src/core/params';
import { lineParam, longestLine, type VectorLibrary } from '../../../src/marks/vector';
import {
  NO_PICKS,
  armPool,
  partGates,
  wholePool,
  wholeTypeOf,
  type PartPicks,
} from '../../../src/model/parts';
import type { DrawingsMeta, Variation } from '../../../src/model/variation';
import { gauss, mulberry32 } from './v21';

const indicesOf = (list: readonly string[] | undefined, want: string) => {
  const out: number[] = [];
  (list ?? []).forEach((k, i) => {
    if (k === want) out.push(i);
  });
  return out;
};

/** v21's picks for these parameters, variation (v21's own) and zoom, replayed from its stream. */
export function v21PartPicks(P: Params, V: Variation, meta: DrawingsMeta, zoom = 1): PartPicks {
  const lib: Partial<VectorLibrary> = meta.vectors ?? {};
  const r = mulberry32(P.seed * 57 + 3);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(r() * arr.length)] as T;
  const n = (a: keyof VectorLibrary) => lib[a]?.n ?? 0;
  const G = partGates(P, P.incl);
  const picks: PartPicks = {
    ...NO_PICKS,
    arms: [],
    arcs: [],
    trails: [],
    bubbles: [],
    streams: [],
  };
  const sc = 84 * zoom;

  if (G.env) {
    const want = P.bulge >= 0.99 || P.arms === 0 ? 'halo' : r() < 0.5 ? 'halo' : 'disc';
    let cand = indicesOf(lib.env?.kind, want);
    if (!cand.length) cand = [0];
    const tile = pick(cand);
    picks.env = { tile, spin: P.bulge >= 0.99 ? 0 : r() * 6.28 };
  }
  if (G.whole) {
    const types = lib.whole?.type ?? [];
    const tile = pick(wholePool(wholeTypeOf(P, P.incl), types));
    const wt = types[tile] ?? '';
    const flat = wt.startsWith('edge-on') || wt === 'smooth:elongated' || wt === 'smooth';
    picks.whole = { tile, spin: flat ? 0 : r() * 6.28 };
  }
  if (G.arms) {
    const pool = armPool(P, lib.arms?.meta ?? []);
    const ai = pick(pool);
    for (let k = 0; k < P.arms; k++) picks.arms.push(r() < 0.5 ? ai : pick(pool));
  }
  if (G.bar) {
    const ok: number[] = [];
    (lib.bars?.solid ?? []).forEach((s, i) => {
      if (!s) ok.push(i);
    });
    picks.bar = ok.length ? pick(ok) : 0;
  }
  if (G.ring) {
    const tile = Math.floor(r() * n('rings'));
    picks.ring = { tile, spin: r() * 6.28 };
  }
  if (G.core && P.nuclear) picks.nuclear = pick(indicesOf(meta.cores.kind, 'nuclear'));
  for (let i = 0; i < G.arcs; i++) {
    const u = r();
    const tile = Math.floor(r() * n('arcs'));
    picks.arcs.push({ tile, u, spin: r() * 6.28 });
  }
  if (G.shells) {
    const tile = Math.floor(r() * n('shells'));
    picks.shells = { tile, spin: r() * 6.28 };
  }
  if (G.tail) {
    const ang = r() * 6.28;
    picks.tail = { tile: Math.floor(r() * n('penlines')), ang };
  }
  if (G.trails) {
    const kinds = lib.trails?.kind ?? [];
    const long = indicesOf(kinds, 'trail');
    const cr = indicesOf(kinds, 'trail:cosmic-ray');
    if (P.trails > 0.4 && long.length) {
      const x = 400 + (r() - 0.5) * 300;
      const y = 400 + (r() - 0.5) * 300;
      const tile = pick(long);
      picks.trails.push({ tile, x, y, size: 900, rot: r() * 3.14 });
    }
    for (let q = 0; q < Math.round(P.trails * 3); q++)
      if (cr.length) {
        const x = 60 + r() * 680;
        const y = 60 + r() * 680;
        const tile = pick(cr);
        const size = 40 + 30 * r();
        picks.trails.push({ tile, x, y, size, rot: r() * 6.28 });
      }
  }
  // skyParts (L1046) and the hatching (L1047–1050) draw from other streams
  if (G.arrow && r() < 0.25 * P.field * (0.5 + P.arrow)) {
    const x = 60 + r() * 680;
    const y = 60 + r() * 680;
    const size = 40 + 30 * r();
    picks.arrow = { x, y, size, rot: r() * 6.28 };
  }
  if (G.bubbles) {
    const cpool = indicesOf(lib.rings?.kind, 'curve');
    V.clumps.forEach((_, i) => {
      if (r() > P.bubbles * 0.6) return;
      const tile = pick(cpool);
      picks.bubbles.push({ clump: i, tile, spin: r() * 6.28 });
    });
  }
  if (G.jet) {
    const ang = r() * 6.28;
    picks.jet = { ang, u: r() };
  }
  for (let q = 0; q < G.streams; q++) {
    const tile = Math.floor(r() * n('penlines'));
    const rec = lib.penlines?.vec[tile];
    const fl = rec ? longestLine(rec) : null;
    if (!fl) continue;
    const lp = lineParam(fl);
    const R0 = 2.0 + 1.2 * r();
    const span = 2.0 + 1.6 * r();
    const a0 = r() * 6.28;
    picks.streams.push({ tile, R0, span, a0 });
    // the marks along this stream draw from the same stream (L1076–1080)
    let prev: [number, number] | null = null;
    for (const pt of lp) {
      const ang = a0 + span * pt[0];
      const Rr = R0 * (1 - 0.25 * pt[0]) + pt[1] * 0.35;
      const X = 400 + Rr * Math.cos(ang) * sc;
      const Y = 400 + Rr * Math.sin(ang) * sc;
      if (prev) {
        const nn = Math.max(1, Math.round(Math.hypot(X - prev[0], Y - prev[1]) / 2.4));
        for (let m2 = 0; m2 < nn; m2++) {
          if (r() > 0.55 + 0.45 * P.streams) continue;
          r(); // the dot's drawing
          gauss(r);
          gauss(r);
          if (r() < 0.04) {
            r(); // the knot's drawing
            r(); // its size
            r(); // its turn
          } else r(); // the dot's turn
        }
      }
      prev = [X, Y];
    }
  }
  return picks;
}

// ---------------------------------------------------------------------------------------------
// The oracle: v21's own parts(), evaluated

/** v21's rows of one `parts()` call (section 15 of the reference notes), by list. */
export interface V21Parts {
  L: Record<string, number[][]>;
  /** the warps' functions, by row[9] */
  warps: { fn?: (x: number, y: number) => [number, number] }[];
  used: string[];
}

type V21PartsEval = (P: Params, VAR: Variation, AT: unknown, scale: number) => V21Parts;

let cached: V21PartsEval | null = null;

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
  'hash2',
  'vnoise',
  'dotSprite',
  'pick',
  'clamp',
  'Rm',
  'Sm',
  'mul',
  'chain',
  'ci',
  'paR',
  'azR',
  'discM',
  'armPhase',
  'project',
  'SM',
  'inst',
  'simple',
  'drawingFlip',
  'rewindFn',
  'longestLine',
  'lineParam',
  'incE',
  'parts',
];

/** The atlases as v21's `AT` holds them, for `parts()`. */
export function v21Atlases(meta: DrawingsMeta): Record<string, unknown> {
  const AT: Record<string, unknown> = {};
  for (const [k, sheet] of Object.entries(meta.vectors ?? {})) AT[k] = { ...sheet };
  AT.cores = { ...meta.cores, src: meta.cores.kind.map((_, i) => `core-${String(i)}`) };
  AT.dots = { src: meta.dots.src, size: meta.dots.size };
  AT.knots = { src: Array.from({ length: meta.knots.count }, (_, i) => `knot-${String(i)}`) };
  return AT;
}

/** v21's own `parts()` for these parameters and variation, at a zoom (hatching and sky off). */
export function v21PartsRows(
  root: string,
  P: Params,
  V: Variation,
  meta: DrawingsMeta,
  zoom = 1,
): V21Parts {
  if (!cached) {
    const src = readFileSync(join(root, 'assets/reference/rosse-source/app23.js'), 'utf8');
    const body = `var P, AT, VAR, VIEW = { W: 800, cx: 400, cy: 400, scale: 84 };
      var MODEL_SIGN = 1, PEN = { line: 2.4, dot: 1 }, USED, WARPS;
      function skyParts() {}
      function dustLanes() { return { strokes: [], pts: [] }; }
      ${NAMES.map((n) => cut(src, n)).join('\n')}
      return function (p, v, at, scale) {
        P = p; VAR = v; AT = at; VIEW.scale = scale; USED = new Set(); WARPS = [];
        PEN.line = P.pen; PEN.dot = 0.75 + 0.1 * P.pen;
        var L = parts(mulberry32(P.seed * 57 + 3));
        return { L: L, warps: WARPS, used: Array.from(USED) };
      };`;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    cached = (new Function(body) as () => V21PartsEval)();
  }
  return cached(P, V, v21Atlases(meta), 84 * zoom);
}
