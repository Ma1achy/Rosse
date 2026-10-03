/**
 * An orientation and cell-mapping check shared by the CPU unit test (tests/unit/raster.test.ts)
 * and the GPU test (tests/gpu/one-mark.ts): a synthetic 16 × 16 cell holding an "L" (a bar down
 * the left, a foot along the bottom; texel rows run top to bottom), drawn 32 units wide, once
 * upright and once with the reference's `simple(32, π/2)` (a quarter turn, clockwise on the
 * plate, whose y axis points down). The probes name pixels that must be inked and pixels that
 * must be empty, worked out by hand from the reference's matrix convention (app23.js:L89, L173):
 * a corner (cx, cy) goes to (m0 cx + m2 cy, m1 cx + m3 cy).
 */
import { mipChain } from '../../tools/pack-atlas/pack-lib.js';
import type { AtlasData } from '../../src/marks/atlas';
import { simple, type Instance } from '../../src/marks/instance';

export function lAtlas(): AtlasData {
  const w = 16;
  const top = new Uint8Array(w * w);
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) {
      const bar = x >= 1 && x <= 4 && y >= 1 && y <= 14;
      const foot = y >= 11 && y <= 14 && x >= 1 && x <= 14;
      if (bar || foot) top[y * w + x] = 255;
    }
  const levels = mipChain(top, w, w, 1).map((l) => ({
    width: l.width,
    height: l.height,
    data: new Uint8Array(l.data),
  }));
  return { name: 'dots', layers: 1, repeatU: false, edge: [0.12, 0.55], meta: {}, levels };
}

/** Upright at (32, 32), turned at (96, 32): 32 units across, 2 px per texel at 1 px per unit. */
export const L_INSTANCES: Instance[] = [
  { x: 32, y: 32, layer: 0, alpha: 1, m: simple(32, 0) },
  { x: 96, y: 32, layer: 0, alpha: 1, m: simple(32, Math.PI / 2) },
];

/** [x, y, inked] at 1 px per unit (pixel indices; centres at +0.5). */
export const L_PROBES: [number, number, boolean][] = [
  // upright: quad spans 16..48; bar at x 18..25, y 18..45; foot at y 38..45, x 18..45
  [20, 20, true], // top of the bar
  [20, 44, true], // bottom of the bar
  [40, 42, true], // the foot's right end
  [40, 22, false], // top right is empty
  [34, 30, false], // middle is empty
  // turned a quarter clockwise about (96, 32): offset (dx, dy) goes to (-dy, dx)
  [108, 20, true], // the bar is now along the top: (20, 20) → (108, 20)
  [84, 20, true], // (20, 44) → (84, 20)
  [86, 40, true], // the foot is now down the left: (40, 42) → (86, 40)
  [106, 40, false], // (40, 22) → (106, 40): bottom right is empty
  [84, 44, true], // the corner of the L: (44, 44) → (84, 44)
];

/** Coverage above this counts as inked; exactly 0 as empty. */
export const L_INKED = 0.9;
