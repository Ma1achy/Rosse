/**
 * The M1 scene: one dot at the centre of the plate, sized as the reference's `dotSprite` gives
 * at pen 2.4, and (for the page) a few more marks around it from the dots, knots, stars and
 * cores sheets. Used by the page (src/main.ts) and by the one-mark render test (tests/gpu/).
 * It stands in for the model until M2.
 */
import { randF32, randU32 } from '../core/rng';
import { Stream } from '../core/streams';
import { simple, type Instance } from '../marks/instance';
import { dotSprite, penWeights } from '../model/variation';
import type { SpriteLayer } from './layers';

export { dotSprite, penWeights };

export const PLATE_UNITS = 800;

/** One dot, cell 0, at the centre: the one-mark test. */
export function oneMark(dotSizes: readonly number[], pen = 2.4): SpriteLayer[] {
  const size = dotSprite(dotSizes[0] ?? 4, penWeights(pen).dot);
  return [
    {
      kind: 'sprites',
      atlas: 'dots',
      gain: 1,
      instances: [{ x: 400, y: 400, layer: 0, alpha: 1, m: simple(size, 0) }],
    },
  ];
}

/** A few more marks around the centre dot, for the page and a broader render test. */
export function sampleScene(
  dotSizes: readonly number[],
  counts: { dots: number; knots: number; stars: number; cores: number; pieces: number },
  seed = 7,
  pen = 2.4,
): SpriteLayer[] {
  const { dot } = penWeights(pen);
  const r = (i: number, d: number) => randF32(seed, Stream.test, i, d);
  const pick = (i: number, n: number) => randU32(seed, Stream.test, i, 9) % n;
  const ring = (
    n: number,
    radius: number,
    i0: number,
    cells: number,
    size: (i: number, layer: number) => number,
  ) =>
    Array.from({ length: n }, (_, k): Instance => {
      const i = i0 + k;
      const a = (k / n) * 2 * Math.PI + 0.3 * r(i, 0);
      const rad = radius * (0.85 + 0.3 * r(i, 1));
      const layer = pick(i, cells);
      return {
        x: 400 + Math.cos(a) * rad,
        y: 400 + Math.sin(a) * rad,
        layer,
        alpha: 1,
        m: simple(size(i, layer), r(i, 2) * 6.28),
      };
    });
  const dots = ring(24, 46, 100, counts.dots, (_, t) => dotSprite(dotSizes[t] ?? 4, dot));
  const knots = ring(8, 110, 200, counts.knots, (i) => (5 + 6 * r(i, 3)) * dot);
  const stars = ring(5, 190, 300, counts.stars, (i) => (9 + 9 * Math.pow(r(i, 3), 2.4)) * dot * 2);
  // pieces span all 638 cells, so the texture-array split (256 layers per array) is exercised
  const pieces = ring(12, 260, 500, counts.pieces, (i) => (8 + 6 * r(i, 3)) * dot);
  const cores: Instance[] = [
    { x: 400, y: 640, layer: pick(400, counts.cores), alpha: 1, m: simple(70, 0) },
  ];
  return [
    { kind: 'sprites', atlas: 'pieces', gain: 1, instances: pieces },
    { kind: 'sprites', atlas: 'cores', gain: 1, instances: cores },
    ...oneMark(dotSizes, pen),
    { kind: 'sprites', atlas: 'dots', gain: 1, instances: dots },
    { kind: 'sprites', atlas: 'knots', gain: 1, instances: knots },
    { kind: 'sprites', atlas: 'stars', gain: 1, instances: stars },
  ];
}
