/**
 * v21's own noise field, for the golden comparison (ADR 0015 item 5, extended in M4).
 *
 * v21's `vnoise` (app23.js:L74) interpolates `hash2` corners (L73) with the same smoothstep as the
 * new engine's lattice noise (src/core/noise.ts, deliberate divergence 5); only the corner values
 * differ. The new engine's are a counter hash keyed by the seed; v21's are `fract(sin(127.1 x +
 * 311.7 y) · 43758.5453)` with the seed added to the coordinates. So for the same seed the two
 * engines draw flocculence, patchiness, the lanes' gaps and the hand wobble in different places:
 * the same statistics (tests/unit/noise.test.ts), another pattern. Like the variation and the
 * strokes, the comparison draws with v21's: these tables give, for each use (salt) of the noise,
 * v21's corner at each lattice point of a window, in the engine's own coordinates. Where v21 adds
 * the seed (or a multiple) to a coordinate, the engine keys its lattice by the seed instead, so the
 * table shifts the lattice by v21's integer offset; the fractional part of the offset is in the
 * engine's coordinates already (src/model/lanes.ts `frac`).
 *
 * `hash2` is cut out of app23.js and evaluated as written (in f64, then rounded to f32 as every
 * corner of the engine is).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NoiseSalt, type NoiseTable } from '../../../src/core/noise';

let hash2: ((x: number, y: number) => number) | null = null;

/** Per salt: the lattice window (x0, y0, w, h) and v21's integer offset for a seed. */
const WINDOWS: {
  salt: number;
  x0: number;
  y0: number;
  w: number;
  h: number;
  shift: (s: number) => [number, number];
}[] = [
  // armProfile: vnoise(R·2.2 + 11, (θ − armPhase(R, 0))·1.6 + seed) (L141)
  { salt: NoiseSalt.flocc, x0: -8, y0: -96, w: 80, h: 128, shift: (s) => [0, s] },
  // disc: vnoise(x·1.4 + seed, y·1.4 − seed) (L250); irr: the same at 1.3 (L256)
  { salt: NoiseSalt.patchy, x0: -32, y0: -32, w: 64, h: 64, shift: (s) => [s, -s] },
  { salt: NoiseSalt.irr, x0: -32, y0: -32, w: 64, h: 64, shift: (s) => [s, -s] },
  // the clumpy ring: vnoise(cos θ·2.2 + seed, sin θ·2.2) (L244)
  { salt: NoiseSalt.ring, x0: -4, y0: -4, w: 8, h: 8, shift: (s) => [s, 0] },
  // flocculent arm ribbons: vnoise(j·0.08 + 7k, seed) (L780)
  { salt: NoiseSalt.floccArm, x0: -2, y0: -1, w: 64, h: 4, shift: (s) => [0, s] },
  // lanes: edge-on vnoise(1.9x + 0.1 seed, 3.1 row), ring vnoise(2.6 cos + 11, 2.6 sin + 0.01 seed),
  // arms vnoise(2.1R + 5.3k, 0.01 seed + 7) (L952, L960, L969)
  {
    salt: NoiseSalt.laneEdge,
    x0: -8,
    y0: -1,
    w: 16,
    h: 10,
    shift: (s) => [Math.floor(s * 0.1), 0],
  },
  // y = 2.6 sin θ + frac(0.01 seed) reaches 3.6, whose upper corners are at 4: rows −4..4
  { salt: NoiseSalt.laneRing, x0: 7, y0: -4, w: 10, h: 9, shift: (s) => [0, Math.floor(s * 0.01)] },
  { salt: NoiseSalt.laneArm, x0: -2, y0: 6, w: 42, h: 4, shift: (s) => [0, Math.floor(s * 0.01)] },
  // the wobble: vnoise(0.011x + 3.1, 0.011y + 7.7) and (+ 11.3, − 2.9), no seed (L163)
  { salt: NoiseSalt.wobbleX, x0: -32, y0: -32, w: 80, h: 80, shift: () => [0, 0] },
  { salt: NoiseSalt.wobbleY, x0: -32, y0: -32, w: 80, h: 80, shift: () => [0, 0] },
];

/** v21's corners for a seed, as noise tables. */
export function v21NoiseTables(root: string, seed: number): NoiseTable[] {
  if (!hash2) {
    const src = readFileSync(join(root, 'assets/reference/rosse-source/app23.js'), 'utf8');
    const m = /\nfunction hash2\([^\n]*\n/.exec(src);
    if (!m) throw new Error('hash2 not found in app23.js');
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    hash2 = (new Function(`${m[0]}\nreturn hash2;`) as () => (x: number, y: number) => number)();
  }
  const h = hash2;
  return WINDOWS.map((W) => {
    const [dx, dy] = W.shift(seed);
    const values = new Float32Array(W.w * W.h);
    for (let j = 0; j < W.h; j++)
      for (let i = 0; i < W.w; i++) values[j * W.w + i] = h(W.x0 + i + dx, W.y0 + j + dy);
    return { salt: W.salt, x0: W.x0, y0: W.y0, w: W.w, h: W.h, values };
  });
}
