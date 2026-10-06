/**
 * How one pass of the plates prints one layer: the reference's `uInk`, `uGain` and `uOff`
 * (app23.js:L1093–1136). Batches keep their instance data and make one set of uniforms per style
 * the first time it is drawn, so a change of plates costs a few uniform buffers (ADR 0010).
 */
import type { Rgb } from './palette';

export interface PassStyle {
  /** the ink colour, multiplied into the premultiplied output; (1, 1, 1) is the key ink */
  ink: Rgb;
  /** multiplies the layer's gain */
  gain: number;
  /** the plate offset, plate units */
  off: readonly [number, number];
}

/** The `ink` plate's one pass: the key ink as white (the composite colours it), no offset. */
export const KEY_STYLE: PassStyle = { ink: [1, 1, 1], gain: 1, off: [0, 0] };

export function styleKey(s: PassStyle): string {
  return `${s.ink.join(',')}|${String(s.gain)}|${s.off.join(',')}`;
}

/** A batch's own options (target size, scale, layer gain) laid under a pass's style. */
export function withStyle<
  O extends {
    gain: number;
    ink?: readonly [number, number, number];
    off?: readonly [number, number];
  },
>(opts: O, style: PassStyle): O {
  return { ...opts, gain: opts.gain * style.gain, ink: style.ink, off: style.off };
}
