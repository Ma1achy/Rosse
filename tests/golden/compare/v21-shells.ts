/**
 * v21's own shells, for the tests and the golden comparison: `shellSprites` and `shellArcs`
 * (app23.js:L711–760) cut out of app23.js and evaluated as written (as ./v21-merger.ts), with
 * v21's globals around them. `ext` replaces the satellite's initial conditions with the engine's, so
 * that the two integrators can be compared from the same start.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Params } from '../../../src/core/params';
import type { ShellArc } from '../../../src/sim/shells';

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

export interface V21Shells {
  /** the satellite's final positions, 3 per star */
  X: Float32Array;
  arcs: ShellArc[];
  /** the `old` dots: [x, y, tile, alpha, m0…m3] */
  dots: number[][];
  /** `shellArcs()`: the curves' radius, sides and stroke rows */
  curves: { pts2d: number[][]; w: number; k: number; a: number }[];
}

interface Oracle {
  run(P: Record<string, unknown>, ext: { X: Float32Array; V: Float32Array } | null): V21Shells;
  ic(P: Record<string, unknown>): { X: Float32Array; V: Float32Array };
}

let cached: Oracle | null = null;

function oracle(root: string): Oracle {
  if (cached) return cached;
  const src = readFileSync(join(root, 'assets/reference/rosse-source/app23.js'), 'utf8');
  const sh = cut(src, 'shellSprites');
  const marker = 'var dt = 0.02, steps = Math.ceil(P.shellTime / dt);';
  if (!sh.includes(marker)) throw new Error('shellSprites no longer contains its integrator');
  const withExt = sh.replace(marker, `if (EXT) { X.set(EXT.X); V.set(EXT.V); } ${marker}`);
  const icOnly = sh
    .replace('function shellSprites', 'function shellIC')
    .replace(marker, `return { X: X.slice(), V: V.slice() }; ${marker}`);
  const body = `var P, VAR, VIEW = { W: 800, cx: 400, cy: 400, scale: 84 }, RMAX = 240, EXT = null, PEN = { line: 2.4, dot: 1 };
    var SCACHE = { key: null, res: null }, AT = { dots: { size: [] }, strokes: { kind: [] } };
    function inst(list, atlas, x, y, tile, alpha, M) { list.push([x, y, tile, alpha, M[0], M[1], M[2], M[3]]); }
    function strokeIndex(kind, r) { var ks = AT.strokes.kind, pool = []; for (var k = 0; k < ks.length; k++) if (ks[k] === kind) pool.push(k); if (!pool.length) for (var k2 = 0; k2 < ks.length; k2++) pool.push(k2); return pool[Math.floor(r() * pool.length)]; }
    ${['clamp', 'mulberry32', 'gauss', 'Rm', 'Sm', 'mul', 'chain', 'dotSprite', 'simple'].map((n) => cut(src, n)).join('\n')}
    ${withExt}
    ${icOnly}
    ${cut(src, 'shellArcs')}
    return {
      run: function (p, ext) {
        P = p; EXT = ext; SCACHE = { key: null, res: null };
        VAR = { dotPool: p.__pool }; AT.dots.size = p.__size; AT.strokes.kind = p.__kinds; PEN.line = p.pen; PEN.dot = 0.75 + 0.1 * p.pen;
        var out = { old: [] }; shellSprites(out);
        return { X: SCACHE.res, arcs: SCACHE.arcs, dots: out.old, curves: shellArcs() };
      },
      ic: function (p) { P = p; EXT = null; SCACHE = { key: null, res: null }; return shellIC({ old: [] }); },
    };`;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  cached = (new Function(body) as () => Oracle)();
  return cached;
}

/** What the oracle needs besides the parameters: the hand and the drawings' sizes and stroke kinds. */
export interface V21Hand {
  dotPool: number[];
  dotSizes: number[];
  strokeKinds: string[];
}

function params(P: Params, h: V21Hand): Record<string, unknown> {
  return { ...P, __pool: h.dotPool, __size: h.dotSizes, __kinds: h.strokeKinds };
}

/** v21's shells for these parameters, optionally from outside initial conditions. */
export function v21ShellsRun(
  root: string,
  P: Params,
  hand: V21Hand,
  ext: { X: Float32Array; V: Float32Array } | null = null,
): V21Shells {
  const r = oracle(root).run(params(P, hand), ext);
  // the arcs as v21 holds them
  return {
    ...r,
    arcs: (r.arcs as unknown as { R: number; side: 1 | -1; open: number }[]).map((a) => ({
      R: a.R,
      side: a.side,
      open: a.open,
    })),
  };
}

/** v21's initial conditions of the satellite (3 words per star). */
export function v21ShellIC(root: string, P: Params, hand: V21Hand) {
  return oracle(root).ic(params(P, hand));
}
