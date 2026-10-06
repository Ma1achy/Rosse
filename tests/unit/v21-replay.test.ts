/**
 * The new engine against v21's own code, run offline:
 * - the arm density: our `armProfile` (src/fallback/kernels/stipple.ts, the twin of stipple.wgsl)
 *   against v21's `armPhase`, `wrapPi` and `armProfile`, taken verbatim from app23.js:L127–144
 *   and evaluated here, over an R × θ grid, with the same variation;
 * - the variation replay of tests/golden/compare/v21.ts against the hands the capture tool
 *   recorded from v21's page (`__GEN.var().pool`, the first 400 tiles).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NoiseSalt, vnoise } from '../../src/core/noise';
import type { Params } from '../../src/core/params';
import { presetParams } from '../../src/core/presets';
import { armProfile } from '../../src/fallback/kernels/stipple';
import { buildScene } from '../../src/model/scene';
import type { DrawingsMeta } from '../../src/model/variation';
import { mulberry32, v21Variation } from '../golden/compare/v21';

const ROOT = resolve(import.meta.dirname, '../..');
const SOURCE = readFileSync(resolve(ROOT, 'assets/reference/rosse-source/app23.js'), 'utf8');

function meta(): DrawingsMeta {
  const idx = JSON.parse(readFileSync(resolve(ROOT, 'assets-built/index.json'), 'utf8')) as {
    atlases: Record<string, { layers: number; meta: Record<string, unknown[]> }>;
  };
  const get = (n: string) => {
    const x = idx.atlases[n];
    if (!x) throw new Error(n);
    return x;
  };
  return {
    dots: { src: get('dots').meta.src as string[], size: get('dots').meta.size as number[] },
    knots: { count: get('knots').layers },
    stars: { count: get('stars').layers },
    cores: { kind: get('cores').meta.kind as string[], style: get('cores').meta.style as string[] },
  };
}
const M = meta();

/** One function of app23.js, verbatim, from its `function name(` to its closing line. */
function v21Source(name: string): string {
  const start = SOURCE.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not in app23.js`);
  // these functions end at the first line that is exactly "}" or end on their own line
  const line = SOURCE.indexOf('\n', start);
  const first = SOURCE.slice(start, line);
  if (
    first.trim().endsWith('}') &&
    (first.match(/{/g) ?? []).length === (first.match(/}/g) ?? []).length
  )
    return first;
  const end = SOURCE.indexOf('\n}\n', start);
  return SOURCE.slice(start, end + 2);
}

type V21Arms = { armProfile: (R: number, th: number) => number };

function v21Arms(P: Params, VAR: unknown): V21Arms {
  const src = ['clamp', 'armPhase', 'wrapPi', 'armProfile'].map(v21Source).join('\n');
  // v21's flocculence noise is a sin hash (`vnoise`, app23.js:L74), which ADR 0004 replaces with
  // lattice noise; v21's code is given ours, called as v21 calls it (its y is offset by the seed)
  const noise = (x: number, y: number) => vnoise(x, y - P.seed, P.seed, NoiseSalt.flocc);
  // the source is checked in and fixed; evaluating it is the point of the test
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const make = new Function('P', 'VAR', 'vnoise', `${src}\nreturn { armProfile };`) as (
    p: Params,
    v: unknown,
    n: typeof noise,
  ) => V21Arms;
  return make(P, VAR, noise);
}

describe('armProfile against v21 (app23.js:L127–144)', () => {
  const configs: [string, Params][] = [
    ['Grand design s7', presetParams('Grand design', 7)],
    ['Barred spiral s4242', presetParams('Barred spiral', 4242)],
    ['Flocculent s7', presetParams('Flocculent', 7)],
    ['Tightly wound s4242', presetParams('Tightly wound', 4242)],
    ['Loose, open arms s7', presetParams('Loose, open arms', 7)],
    ['Hand-drawn arms s99', presetParams('Hand-drawn arms', 99)],
    ['six arms, wide, s3', presetParams('Grand design', 3, { arms: 6, armWidth: 0.7, pitch: 30 })],
  ];
  for (const [name, P] of configs)
    it(name, () => {
      const variation = v21Variation(P, M);
      const G = buildScene(P, M, { variation }).galaxy;
      const ref = v21Arms(P, variation);
      let worst = 0;
      let peak = 0;
      for (let i = 0; i < 48; i++)
        for (let j = 0; j < 90; j++) {
          const R = Math.fround(0.03 + i * 0.07);
          const th = Math.fround((j / 90) * 2 * Math.PI);
          const want = ref.armProfile(R, th);
          peak = Math.max(peak, want);
          worst = Math.max(worst, Math.abs(armProfile(G, R, th) - want));
        }
      expect(peak).toBeGreaterThan(0.5);
      // f32 against f64: measured at most 6.4e-6 over these grids

      expect(worst).toBeLessThan(5e-5);
    });
});

describe("v21's variation, replayed offline", () => {
  it('uses v21’s mulberry32', () => {
    // the first draws of mulberry32(7 · 7919 + 13), computed by v21's own definition
    const src = /function mulberry32\(a\) \{[^\n]*\}/.exec(SOURCE)?.[0];
    if (!src) throw new Error('mulberry32 not found');
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
    const ref = new Function(`${src}\nreturn mulberry32;`)() as (a: number) => () => number;
    const a = ref(7 * 7919 + 13);
    const b = mulberry32(7 * 7919 + 13);
    for (let i = 0; i < 100; i++) expect(b()).toBe(a());
  });

  it('gives the hands the capture tool recorded from v21', () => {
    const dir = resolve(ROOT, 'tests/golden/reference');
    let checked = 0;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && x !== 'manifest.json')) {
      const rec = JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as {
        params: Params;
        hand?: number[];
      };
      if (!rec.hand) continue;
      const pool = v21Variation(rec.params, M).dotPool;
      expect(pool.slice(0, 400), f).toEqual(rec.hand);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(12);
  });
});
