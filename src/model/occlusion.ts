/**
 * The occluder depth grid (ADR 0074): what is nearer than a star, in the screen, so that the star's
 * marks can be left out where something nearer is drawn (a stippled gap, as a draftsman leaves).
 * v21 draws the star last over everything (app23.js:L1281, scene() L1289–1301); this departs
 * from it on purpose.
 *
 * The grid is one u32 per cell over the plate (`OCC_GRID` × `OCC_GRID`), holding the largest
 * `quantZ` of the occluder marks that fall in the cell (their halo too): 0 is "nothing here". The
 * writers are compute/project.wgsl (CPU: src/fallback/kernels/project.ts), one `atomicMax` per
 * mark and cell; the reader is compute/star-marks.wgsl (CPU: src/fallback/kernels/star-marks.ts).
 * A max of integers is commutative, so the grid does not depend on the order the invocations
 * run in, and the CPU engine's plain max gives the same grid. `gridCell` and `quantZ` are
 * written once here and mirrored in src/shaders/common/occlusion.wgsl (tests/unit/occlusion.test.ts
 * checks the constants against it and the two on a table of vectors).
 *
 * **The z convention** (src/view/camera.ts, `rotFwd`, `toView`, `scenePoint`): the view frame is
 * x right, y down the plate, z TOWARDS THE VIEWER, so a LARGER z is NEARER the camera. (The deep
 * field's `perspective(depth) = CAM / (CAM − depth)` grows with depth, and `srcNow` puts a source
 * behind the lens at −D.) `quantZ` keeps that order, so the nearest occluder is the largest key.
 */
import { PLATE } from '../view/camera';

const f = Math.fround;

/** Cells along one side of the grid over the plate. */
export const OCC_GRID = 400;
/** Cells per plate unit, rounded to f32 (800 / 400 = 2 units a cell, a mark's own size): the multiplier of `gridCell`. */
export const OCC_INV = f(OCC_GRID / PLATE);
/** A mark also stamps the cells this many cells away on each side (1: its 3 × 3 block). */
export const OCC_HALO = 1;
/** View-space z is clamped to ± this, in galaxy units, before it is quantised. */
export const OCC_Z_RANGE = 64;
/** Keys per unit of z (a power of two: exact in f32). */
export const OCC_Z_SCALE = 2048;
/** An occluder must be nearer than the star by more than this many keys (0.05 units). */
export const OCC_EPS = 102;
/** The z of a mark that nothing occludes (an artefact, a screen-fixed mark): the nearest there is. */
export const OCC_NEVER_Z = OCC_Z_RANGE;
/** The key of "nothing here". */
export const OCC_NONE = 0;
/** Words of the grid. */
export const OCC_CELLS = OCC_GRID * OCC_GRID;

/** The key of a view-space z (larger z, nearer, larger key; at least 1, so that 0 means nothing). */
export function quantZ(z: number): number {
  const c = Math.min(Math.max(z, -OCC_Z_RANGE), OCC_Z_RANGE);
  return Math.floor(f(f(c + OCC_Z_RANGE) * OCC_Z_SCALE)) + 1;
}

/** The cell of a plate position, row-major, or −1 off the plate. */
export function gridCell(x: number, y: number): number {
  if (!(x >= 0 && x < PLATE && y >= 0 && y < PLATE)) return -1;
  const cx = Math.min(Math.floor(f(f(x) * OCC_INV)), OCC_GRID - 1);
  const cy = Math.min(Math.floor(f(f(y) * OCC_INV)), OCC_GRID - 1);
  return cy * OCC_GRID + cx;
}

/** Stamps key `k` into `cell` and the cells of its halo (a max). */
export function stampOccluder(grid: Uint32Array, cell: number, k: number): void {
  if (cell < 0) return;
  const cx = cell % OCC_GRID;
  const cy = (cell - cx) / OCC_GRID;
  for (let dy = -OCC_HALO; dy <= OCC_HALO; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= OCC_GRID) continue;
    for (let dx = -OCC_HALO; dx <= OCC_HALO; dx++) {
      const x = cx + dx;
      if (x < 0 || x >= OCC_GRID) continue;
      const i = y * OCC_GRID + x;
      if ((grid[i] ?? 0) < k) grid[i] = k;
    }
  }
}

/** Is something nearer than a star of key `starKey` drawn in `cell`? */
export function occluded(grid: Uint32Array, cell: number, starKey: number): boolean {
  return cell >= 0 && (grid[cell] ?? 0) > starKey + OCC_EPS;
}
