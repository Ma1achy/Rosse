import { describe, expect, it } from 'vitest';
import { composite, createInkBuffer } from '../../src/fallback/raster';
import { SURFACES } from '../../src/render/surface';

/**
 * The composite keeps the surface under the ink for the next frame (M10). A frame drawn from the
 * kept surface must be the frame drawn from a fresh one, and a changed input must not reuse it.
 * (The kept surface was also checked equal, byte for byte, to the per-pixel composite it replaced,
 * for both surfaces at DPR 1 and 2.)
 */
const paperOf = (seed: number) => {
  const data = new Uint8Array(512 * 512 * 4);
  for (let i = 0; i < data.length; i++) data[i] = Math.imul(i + seed, 2654435761) >>> 24;
  return { width: 512, height: 512, data };
};

function frame(
  surface: 'paper' | 'chalk',
  paper: ReturnType<typeof paperOf>,
  dpr: number,
  fill: number,
) {
  const W = 120 * dpr;
  const ink = createInkBuffer(W, W);
  for (let i = 0; i < ink.data.length; i++) ink.data[i] = ((i * fill) % 997) / 997;
  const out = new Uint8ClampedArray(W * W * 4);
  composite(ink, { surface: SURFACES[surface], paper, dpr, plateCss: 120, plates: 'ink' }, out);
  return out;
}

describe('composite surface cache', () => {
  it('draws the same frame from the kept surface as from a fresh one', () => {
    const paper = paperOf(1);
    const first = frame('paper', paper, 1, 40503);
    const again = frame('paper', paper, 1, 40503);
    expect(Buffer.from(again).equals(Buffer.from(first))).toBe(true);
  });

  it('does not reuse a surface for another paper, surface or DPR', () => {
    const a = paperOf(1);
    const b = paperOf(2);
    const fa = frame('paper', a, 1, 7);
    const fb = frame('paper', b, 1, 7);
    expect(Buffer.from(fb).equals(Buffer.from(fa))).toBe(false);
    expect(Buffer.from(frame('chalk', a, 1, 7)).equals(Buffer.from(fa))).toBe(false);
    // back to the first paper: the first result again, however many others came between
    expect(Buffer.from(frame('paper', a, 1, 7)).equals(Buffer.from(fa))).toBe(true);
    expect(frame('paper', a, 2, 7).length).toBe(4 * 240 * 240);
  });
});
