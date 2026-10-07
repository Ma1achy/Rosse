/**
 * Which of v21's SVG layers each placed-drawing capsule belongs to. The engine compacts the
 * placed drawings' capsules into one buffer (compute/vector-expand.wgsl, ADR 0019), so a capsule
 * does not say which drawing it came from. The slots do: every placed drawing owns the slots
 * `capFirst[i] .. capFirst[i + 1]`, and the compaction keeps the order and drops the slots whose
 * key is not 0 (a warped drawing's over-long segments). Replaying that gives each kept capsule its
 * drawing, and so its sheet: v21 sends the drawn stars (`sstars`) to `stars` and every other
 * placed drawing to `drawings`.
 */
import type { VectorRow } from '../../model/parts';
import { SVG_LAYERS } from './svg';

const DRAWINGS = SVG_LAYERS.indexOf('drawings');
const STARS = SVG_LAYERS.indexOf('stars');

/**
 * @param rows the placed drawings, in instance order
 * @param capFirst first capsule slot of each placed drawing (`VectorDesc.capFirst`)
 * @param nSlots the number of slots (`VectorDesc.nCapSlots`)
 * @param keys per slot, 0 where the capsule was kept (`capKeys` of the expansion)
 * @param nHatch the capsules before the placed ones in the export layer (the hatching's)
 * @returns per capsule of the export layer, the index into `SVG_LAYERS` (the hatching's are 0)
 */
export function capsuleRoles(
  rows: readonly Pick<VectorRow, 'atlas'>[],
  capFirst: readonly number[],
  nSlots: number,
  keys: ArrayLike<number>,
  nHatch: number,
): Uint8Array {
  const roles: number[] = new Array<number>(nHatch).fill(0);
  let inst = 0;
  for (let s = 0; s < nSlots; s++) {
    while (inst + 1 < capFirst.length && (capFirst[inst + 1] ?? Infinity) <= s) inst++;
    if (keys[s] !== 0) continue;
    roles.push(rows[inst]?.atlas === 'sstars' ? STARS : DRAWINGS);
  }
  return Uint8Array.from(roles);
}
