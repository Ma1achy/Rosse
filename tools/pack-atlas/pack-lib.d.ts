export interface Level {
  data: Uint8Array;
  width: number;
  height: number;
}
export function mipCount(w: number, h: number): number;
export function cutCells(
  rgba: Uint8Array,
  sheetWidth: number,
  grid: { cellWidth: number; cellHeight: number; cols: number; n: number },
): Uint8Array;
export function downsample(src: Uint8Array, w: number, h: number, layers: number): Level;
export function mipChain(level0: Uint8Array, w: number, h: number, layers: number): Level[];
