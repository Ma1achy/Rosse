/**
 * The GIF's frame sources: the merger timeline and the quasar flare (v21: app23.js:L1722).
 *
 * Both are the same animation in v21: the timeline parameter `mTime` runs from 0 to the chosen end,
 * and each frame is a render at that `mTime`. For a merger it moves the two galaxies along their
 * orbit and through their tides (M8: a view-tier change only, ADR 0010: the snapshots are kept);
 * for a lensed quasar (`lensOn`, `lensSource: 'quasar'`) it moves the flare through the lensed
 * images in turn (M9). `timelineSource` takes the parameters and a function that draws them, so
 * the page passes whichever engine it is running, and the tests pass both.
 */
import type { Params } from '../../core/params';
import type { GifSource } from './record';

/** True where v21's play button and GIF export apply: a merger, or a lensed quasar. */
export function isTimeline(P: Pick<Params, 'merger' | 'lensOn' | 'lensSource'>): boolean {
  return !!P.merger || (!!P.lensOn && P.lensSource === 'quasar');
}

/**
 * A source whose frame at time t is `draw({ ...params, mTime: t })`.
 * @param draw returns the ink as premultiplied RGBA8 at `width × height`
 */
export function timelineSource(
  width: number,
  height: number,
  params: Params,
  draw: (P: Params) => Promise<Uint8ClampedArray> | Uint8ClampedArray,
): GifSource {
  if (!isTimeline(params)) throw new Error('the GIF animates a merger or a lensed quasar only');
  return { width, height, frame: async (t) => draw({ ...params, mTime: t }) };
}
